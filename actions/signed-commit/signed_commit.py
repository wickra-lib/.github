"""Commit through the GitHub API so that GitHub signs the commit.

A `git push` from a workflow produces an unsigned commit: the runner has no
signing key. A commit created through the Git database API (blobs, a tree, a
commit, then a ref update) by a GitHub App -- the workflow's GITHUB_TOKEN
belongs to the github-actions app, an installation token to its own app -- is
signed by GitHub and shows as Verified. That is the only difference this
script makes; what gets committed is decided by the calling workflow.

Two modes:

  changes  Commit what the working tree changed under PATHS relative to the
           checked-out HEAD (new, modified and deleted files) onto the
           current head of BRANCH. If the branch moved since the checkout,
           the files are applied on top of the new head, which is what the
           old `git pull --rebase && git push` did for these bots.
  tree     Replace the whole tree of BRANCH in REPOSITORY with the contents of
           SOURCE (a release mirror). An identical tree makes no commit.

With TAG set, a lightweight tag of that name is created on the resulting
commit; an existing tag is accepted only if it already points there.

Every commit this creates is read back and must be verified; anything else
fails the step, so an unsigned commit can never pass silently.
"""
import base64
import json
import os
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = os.environ.get("GITHUB_API_URL", "https://api.github.com")
TOKEN = os.environ["SC_TOKEN"]
REPO = os.environ["SC_REPOSITORY"]
BRANCH = os.environ["SC_BRANCH"]
MESSAGE = os.environ["SC_MESSAGE"]
MODE = os.environ.get("SC_MODE", "changes")
PATHS = os.environ.get("SC_PATHS", ".").split()
SOURCE = os.environ.get("SC_SOURCE", "")
TAG = os.environ.get("SC_TAG", "")


class ApiError(Exception):
    def __init__(self, status, body):
        super().__init__(f"HTTP {status}: {body[:500]}")
        self.status = status


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(6):
        req = urllib.request.Request(
            API + path,
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {TOKEN}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "wickra-signed-commit",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as err:
            text = err.read().decode("utf-8", "replace")
            # Server-side hiccups and rate limits are retried; a 4xx is an answer.
            if err.code in (429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(10 * (attempt + 1))
                continue
            raise ApiError(err.code, text) from None
        except (urllib.error.URLError, TimeoutError):
            if attempt < 5:
                time.sleep(10 * (attempt + 1))
                continue
            raise
    raise RuntimeError("unreachable")


def output(name, value):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(f"{name}={value}\n")


_blobs = {}


def blob(path):
    """Create (once) the blob for a file and return its tree entry."""
    if os.path.islink(path):
        mode, content = "120000", os.readlink(path).encode()
    else:
        st = os.stat(path)
        mode = "100755" if st.st_mode & stat.S_IXUSR else "100644"
        with open(path, "rb") as fh:
            content = fh.read()
    key = (mode, content)
    if key not in _blobs:
        _blobs[key] = api("POST", f"/repos/{REPO}/git/blobs",
                          {"content": base64.b64encode(content).decode(), "encoding": "base64"})["sha"]
    return {"mode": mode, "type": "blob", "sha": _blobs[key]}


def head_of(branch):
    try:
        return api("GET", f"/repos/{REPO}/git/ref/heads/{branch}")["object"]["sha"]
    except ApiError as err:
        if err.status in (404, 409):  # no such branch / empty repository
            return None
        raise


def tree_of(commit):
    return api("GET", f"/repos/{REPO}/git/commits/{commit}")["tree"]["sha"]


def move_branch(head, commit):
    if head is None:
        api("POST", f"/repos/{REPO}/git/refs", {"ref": f"refs/heads/{BRANCH}", "sha": commit})
    else:
        api("PATCH", f"/repos/{REPO}/git/refs/heads/{BRANCH}", {"sha": commit, "force": False})


def working_changes():
    """(written, deleted) paths under PATHS relative to the checked-out HEAD."""
    raw = subprocess.run(
        ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", *PATHS],
        capture_output=True, check=True,
    ).stdout.decode("utf-8")
    fields = raw.split("\0")
    written, deleted = set(), set()
    i = 0
    while i < len(fields):
        entry = fields[i]
        i += 1
        if not entry:
            continue
        code, path = entry[:2], entry[3:]
        if "R" in code or "C" in code:
            old = fields[i]
            i += 1
            if "R" in code:
                deleted.add(old)
        if os.path.lexists(path):
            written.add(path)
        else:
            deleted.add(path)
    return sorted(written), sorted(deleted)


def commit_changes():
    written, deleted = working_changes()
    if not written and not deleted:
        print("nothing changed under", " ".join(PATHS))
        return None, False
    for path in written:
        print("write ", path)
    for path in deleted:
        print("delete", path)
    entries = [dict(path=p, **blob(p)) for p in written]
    for attempt in range(5):
        head = head_of(BRANCH)
        base = tree_of(head)
        tree = api("POST", f"/repos/{REPO}/git/trees", {
            "base_tree": base,
            "tree": entries + [{"path": p, "mode": "100644", "type": "blob", "sha": None} for p in deleted],
        })["sha"]
        if tree == base:
            print("the branch already holds these contents; no commit")
            return head, False
        commit = api("POST", f"/repos/{REPO}/git/commits",
                     {"message": MESSAGE, "tree": tree, "parents": [head]})["sha"]
        try:
            move_branch(head, commit)
            return commit, True
        except ApiError as err:
            # Another writer moved the branch between reading and updating it.
            if err.status == 422 and attempt < 4:
                time.sleep(5)
                continue
            raise
    raise RuntimeError("could not update the branch")


def commit_tree():
    if not os.path.isdir(SOURCE):
        sys.exit(f"source directory {SOURCE!r} does not exist")
    entries = []
    for root, dirs, files in os.walk(SOURCE):
        dirs[:] = sorted(d for d in dirs if d != ".git")
        for name in sorted(files):
            full = os.path.join(root, name)
            rel = os.path.relpath(full, SOURCE).replace(os.sep, "/")
            entries.append(dict(path=rel, **blob(full)))
    if not entries:
        sys.exit(f"source directory {SOURCE!r} is empty")
    tree = api("POST", f"/repos/{REPO}/git/trees", {"tree": entries})["sha"]
    head = head_of(BRANCH)
    if head is not None and tree_of(head) == tree:
        print(f"{REPO}@{BRANCH} already holds this tree; no commit")
        return head, False
    parents = [head] if head else []
    commit = api("POST", f"/repos/{REPO}/git/commits",
                 {"message": MESSAGE, "tree": tree, "parents": parents})["sha"]
    move_branch(head, commit)
    return commit, True


def tag(commit):
    try:
        api("POST", f"/repos/{REPO}/git/refs", {"ref": f"refs/tags/{TAG}", "sha": commit})
        print(f"tagged {TAG} -> {commit}")
    except ApiError as err:
        if err.status != 422:
            raise
        existing = api("GET", f"/repos/{REPO}/git/ref/tags/{TAG}")["object"]["sha"]
        if existing != commit:
            sys.exit(f"tag {TAG} already exists on {existing}, not on {commit}")
        print(f"tag {TAG} already points at {commit}")


def main():
    if MODE == "changes":
        commit, created = commit_changes()
    elif MODE == "tree":
        commit, created = commit_tree()
    else:
        sys.exit(f"unknown mode {MODE!r}")
    if commit is None:
        output("changed", "false")
        return
    if created:
        # Only a commit made here is checked: an unchanged branch keeps
        # whatever head it had, which this run did not write.
        verification = api("GET", f"/repos/{REPO}/commits/{commit}")["commit"]["verification"]
        if not verification["verified"]:
            sys.exit(f"commit {commit} is not verified ({verification['reason']})")
        print(f"{REPO}@{BRANCH} -> {commit} (verified)")
    if TAG:
        tag(commit)
    output("sha", commit)
    output("changed", "true" if created else "false")


if __name__ == "__main__":
    main()
