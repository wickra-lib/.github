"""Follow the family: move every wickra-* crate a repository depends on to the
newest release it may take, and propose that as a pull request.

What "may take" means follows the requirement the repository declares:

  caret ("1.0")       the newest release compatible with it -- what
                      `cargo update` would pick.
  exact ("=0.1.9")    the newest release of the same minor line (0.x) or the
                      same major (1.x and later). The pin is rewritten in every
                      tracked Cargo.toml that carries it, so a workspace, its
                      fuzz crate and a separate guest move together.

Nothing crosses a breaking line: a new major (or a new 0.x minor) is left for
a person, exactly as before. Only crates published to crates.io under the
wickra prefix are considered; path dependencies inside the repository are not.

The change is committed through actions/signed-commit with the wickra-lib-bot
installation token, so the commit is signed and, unlike a GITHUB_TOKEN write,
starts the pull request's CI. With AUTOMERGE the pull request is set to
squash-merge itself once the required checks pass, with the pull request's
own title and body as the message; otherwise it is labelled `manual`.

Environment: FF_TOKEN, FF_LOCKS (space-separated directories holding a tracked
Cargo.lock, default "."), FF_AUTOMERGE (true/false), FF_DRY_RUN (true: change
the working tree and report, push nothing).
"""
import json
import os
import re
import subprocess
import sys
import time
import tomllib
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = os.environ.get("GITHUB_API_URL", "https://api.github.com")
REPO = os.environ.get("GITHUB_REPOSITORY", "")
TOKEN = os.environ.get("FF_TOKEN", "")
LOCKS = os.environ.get("FF_LOCKS", ".").split()
AUTOMERGE = os.environ.get("FF_AUTOMERGE", "true") == "true"
DRY_RUN = os.environ.get("FF_DRY_RUN", "false") == "true"
PREFIX = "wickra"


def run(*cmd, cwd=None):
    out = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if out.returncode:
        sys.exit(f"{' '.join(cmd)} failed in {cwd or '.'}:\n{out.stderr}")
    return out.stdout + out.stderr


def http_json(url, headers=None, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(6):
        req = urllib.request.Request(url, data=data, method=method, headers={
            "User-Agent": "wickra-follow-family (https://github.com/wickra-lib)", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as err:
            text = err.read().decode("utf-8", "replace")
            if err.code in (429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(10 * (attempt + 1))
                continue
            raise RuntimeError(f"{method} {url}: HTTP {err.code}: {text[:400]}") from None
        except (urllib.error.URLError, TimeoutError):
            if attempt < 5:
                time.sleep(10 * (attempt + 1))
                continue
            raise
    raise RuntimeError("unreachable")


def gh(method, path, body=None):
    return http_json(API + path, method=method, body=body, headers={
        "Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"})


def graphql(query, **variables):
    out = http_json(API + "/graphql", method="POST", body={"query": query, "variables": variables},
                    headers={"Authorization": f"Bearer {TOKEN}"})
    if out.get("errors"):
        raise RuntimeError(f"GraphQL: {out['errors']}")
    return out["data"]


# --------------------------------------------------------------- versions
def vtuple(v):
    core = v.split("+")[0]
    if "-" in core:
        return None  # pre-releases are never a target
    try:
        return tuple(int(x) for x in core.split("."))
    except ValueError:
        return None


_published = {}


def published(name):
    if name not in _published:
        data = http_json(f"https://crates.io/api/v1/crates/{name}/versions")
        _published[name] = sorted(
            (t for t in (vtuple(v["num"]) for v in data["versions"] if not v["yanked"]) if t))
    return _published[name]


def same_line(a, b):
    """True when b may replace a without crossing a breaking boundary."""
    if a[0] > 0:
        return b[0] == a[0]
    if a[1] > 0:
        return b[:2] == a[:2]
    return b[:3] == a[:3]


def fmt(t):
    return ".".join(map(str, t))


# --------------------------------------------------------------- manifests
def tracked(pattern):
    return [p for p in run("git", "ls-files", pattern).split("\n") if p]


def declarations():
    """{crate: [(manifest, requirement)]} for every wickra-* registry dependency."""
    found = {}
    for manifest in tracked("*Cargo.toml"):
        doc = tomllib.loads(Path(manifest).read_text(encoding="utf-8"))
        tables = [doc.get(k, {}) for k in ("dependencies", "dev-dependencies", "build-dependencies")]
        for target in doc.get("target", {}).values():
            tables += [target.get(k, {}) for k in ("dependencies", "dev-dependencies", "build-dependencies")]
        tables.append(doc.get("workspace", {}).get("dependencies", {}))
        for table in tables:
            for key, spec in table.items():
                name = spec.get("package", key) if isinstance(spec, dict) else key
                if not name.startswith(PREFIX):
                    continue
                if isinstance(spec, dict) and ("path" in spec or "git" in spec or spec.get("workspace")):
                    continue
                req = spec if isinstance(spec, str) else spec.get("version")
                if req:
                    found.setdefault(name, []).append((manifest, req))
    return found


def locked(lock_dir):
    """{crate: version} of wickra-* registry packages in lock_dir/Cargo.lock."""
    text = Path(lock_dir, "Cargo.lock").read_text(encoding="utf-8")
    out = {}
    for m in re.finditer(r'\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"\nsource = "registry\+', text):
        if m.group(1).startswith(PREFIX):
            out.setdefault(m.group(1), set()).add(m.group(2))
    return out


def rewrite_pin(manifest, name, old, new):
    with open(manifest, encoding="utf-8", newline="") as fh:  # keep the file's line endings
        text = fh.read()
    pattern = re.compile(
        rf'(^[ \t]*{re.escape(name)}[ \t]*=[ \t]*(?:\{{[^}}\n]*?\bversion[ \t]*=[ \t]*)?")={re.escape(old)}(")', re.M)
    new_text, n = pattern.subn(rf"\g<1>={new}\g<2>", text)
    if n == 0:
        sys.exit(f"{manifest}: could not find the pin {name} = \"={old}\" to rewrite")
    with open(manifest, "w", encoding="utf-8", newline="") as fh:
        fh.write(new_text)


# --------------------------------------------------------------- plan
def plan():
    """(targets, pins): the newest allowed release per crate, and the exact pins to rewrite."""
    decls = declarations()
    locks = {d: locked(d) for d in LOCKS}
    targets = {}
    pins = []  # (manifest, name, old, new)
    for name in sorted(set(decls) | {n for l in locks.values() for n in l}):
        versions = {v for l in locks.values() for v in l.get(name, ())}
        if not versions:
            continue
        current = max(vtuple(v) for v in versions)
        candidates = [v for v in published(name) if v > current and same_line(current, v)]
        if not candidates:
            continue
        targets[name] = fmt(candidates[-1])
        for manifest, req in decls.get(name, []):
            req = req.strip()
            if req.startswith("=") and req.lstrip("=").strip() != targets[name]:
                pins.append((manifest, name, req.lstrip("=").strip(), targets[name]))
    return decls, targets, pins


def apply(decls, targets, pins):
    """Rewrite the pins, then unlock every family crate with a newer release in one
    `cargo update` per lock, so a crate and the siblings it pins exactly move
    together. Returns the moves the locks actually made."""
    for manifest, name, old, new in pins:
        print(f"pin  {manifest}: {name} ={old} -> ={new}")
        rewrite_pin(manifest, name, old, new)
    moves = {}
    for lock_dir in LOCKS:
        before = locked(lock_dir)
        specs = [f"{n}@{v}" for n in targets for v in sorted(before.get(n, ()))]
        if not specs:
            continue
        args = ["cargo", "update"]
        for spec in specs:
            args += ["-p", spec]
        run(*args, cwd=lock_dir)
        after = locked(lock_dir)
        for name in sorted(set(before) | set(after)):
            old, new = before.get(name, set()), after.get(name, set())
            if old != new:
                print(f"lock {lock_dir}/Cargo.lock: {name} {', '.join(sorted(old)) or '-'} -> {', '.join(sorted(new)) or '-'}")
                if new:
                    moves[name] = (", ".join(sorted(old)) or "new", max(new, key=vtuple))
            if name in decls and name in targets and old and targets[name] not in new:
                sys.exit(f"{lock_dir}/Cargo.lock: {name} did not reach {targets[name]} (holds {sorted(new)})")
    return moves


# --------------------------------------------------------------- publish
def changed_paths():
    out = run("git", "status", "--porcelain=v1")
    return sorted(line[3:] for line in out.splitlines() if line.strip())


def propose(moves, paths):
    providers = sorted(moves)
    title_parts = ", ".join(f"{n} {moves[n][1]}" for n in providers)
    title = f"deps: follow the family ({title_parts})"
    if len(title) > 120:
        title = f"deps: follow the family ({len(moves)} crates)"
    branch = "family/" + "-".join(f"{n}-{moves[n][1]}" for n in providers)[:200]
    lines = [f"- `{n}` {moves[n][0]} -> {moves[n][1]}" for n in providers]
    body = ("A family crate this repository depends on has a new release:\n\n" + "\n".join(lines) +
            "\n\nThe lock" + ("s" if len(LOCKS) > 1 else "") + " and any exact pins move to it; nothing crosses a "
            "breaking line (a new major, or a new 0.x minor, is left for a person). Opened by the daily "
            "follow-family workflow; " + ("it merges itself once the required checks pass." if AUTOMERGE
                                         else "this repository merges such updates by hand (label `manual`)."))
    print(f"branch {branch}\ntitle  {title}\n{body}")
    if DRY_RUN:
        return
    try:
        gh("GET", f"/repos/{REPO}/git/ref/heads/{branch}")
        print(f"branch {branch} already exists: this update is already proposed")
        return
    except RuntimeError as err:
        if "HTTP 404" not in str(err):
            raise
    base = gh("GET", f"/repos/{REPO}/git/ref/heads/main")["object"]["sha"]
    gh("POST", f"/repos/{REPO}/git/refs", {"ref": f"refs/heads/{branch}", "sha": base})
    env = dict(os.environ, SC_TOKEN=TOKEN, SC_REPOSITORY=REPO, SC_BRANCH=branch, SC_MESSAGE=f"{title}\n\n{body}",
               SC_MODE="changes", SC_PATHS=" ".join(paths))
    subprocess.run([sys.executable, str(HERE.parent / "signed-commit" / "signed_commit.py")], env=env, check=True)
    pr = gh("POST", f"/repos/{REPO}/pulls", {"title": title, "head": branch, "base": "main", "body": body})
    print(f"opened {pr['html_url']}")
    if AUTOMERGE:
        graphql("""mutation($id: ID!, $headline: String!, $body: String!) {
                     enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: SQUASH,
                                                        commitHeadline: $headline, commitBody: $body}) {
                       pullRequest { number } } }""",
                id=pr["node_id"], headline=f"{title} (#{pr['number']})", body=body)
        print("auto-merge enabled (squash, the pull request's title and body)")
    else:
        try:
            gh("POST", f"/repos/{REPO}/labels", {"name": "manual", "color": "d93f0b",
                                                 "description": "Needs a person before it can merge"})
        except RuntimeError as err:
            if "already_exists" not in str(err):
                raise
        gh("POST", f"/repos/{REPO}/issues/{pr['number']}/labels", {"labels": ["manual"]})
        print("labelled manual")


def main():
    decls, targets, pins = plan()
    if not targets:
        print("every family crate is on the newest release it may take")
        return
    moves = apply(decls, targets, pins)
    paths = changed_paths()
    if not paths or not moves:
        print("nothing changed on disk")
        return
    propose(moves, paths)


if __name__ == "__main__":
    main()
