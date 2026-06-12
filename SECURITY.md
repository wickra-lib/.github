# Security Policy

This is the default security policy for all repositories in the
[`wickra-lib`](https://github.com/wickra-lib) organization. Individual
repositories may publish their own `SECURITY.md`, which takes precedence over
this one — for example the main library
([`wickra`](https://github.com/wickra-lib/wickra/blob/main/SECURITY.md)) has a
more detailed policy covering its supported versions, scope, and assurance case.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report it privately through one of:

- GitHub's **private vulnerability reporting** — open the affected repository's
  *Security* tab and choose *"Report a vulnerability"*, or
- email **support@wickra.org** with a subject line starting with
  `[wickra security]`.

Please include:

- the affected repository and version(s) or commit,
- a description of the issue and its impact,
- steps to reproduce, ideally a minimal proof of concept.

## What to expect

- An acknowledgement within **5 working days**.
- An assessment and, if confirmed, a planned fix with a target release.
- Coordinated disclosure: we agree on a disclosure date with you and credit you
  in the release notes unless you prefer to stay anonymous.

## Scope

In scope: the source code, build and release workflows, and published artifacts
of repositories in this organization.

Out of scope: vulnerabilities in third-party dependencies (report those
upstream; we track them via Dependabot). Findings that do not affect a project —
for example an unreachable code path — are triaged and recorded rather than
acted on blindly.
