# Support

This is the organization-wide support guide for the Wickra ecosystem. It
applies to every repository under `wickra-lib` that does not ship its own
`SUPPORT.md`.

## Where to ask

Every repository has its own discussions board, and there is an
ecosystem-wide one:

**<https://github.com/orgs/wickra-lib/discussions>**

Ask in the repository your question is about. Use the organization
discussions for anything that spans projects — comparing tools, general
usage, or when you are unsure which repository applies.

## Documentation first

Most questions are already answered:

- **Docs site:** <https://docs.wickra.org> — quickstarts for Rust, Python,
  Node.js, WASM, C, C++, C#, Go, Java and R, a per-indicator reference, warmup
  periods, the data layer, and an FAQ.
- **Project overview:** <https://wickra.org>
- **API docs (Rust):** <https://docs.rs/wickra/latest/wickra/>

## Bugs and feature requests

Open an issue in the repository the problem belongs to. A report that names the
version, the language binding and a reproducible input gets help fastest.

Generated repositories — the `*-go` module mirrors and the `*-site` marketing
sites — are published from their parent project. Report anything about their
content against the parent repository instead; changes made directly in a mirror
are overwritten on the next release.

## Security issues

Do **not** report vulnerabilities through public issues or discussions. Use the
private advisory form:

**<https://github.com/wickra-lib/wickra/security/advisories/new>**

The disclosure process is described in
[`SECURITY.md`](https://github.com/wickra-lib/.github/blob/main/SECURITY.md).

## Support expectations

Wickra is maintained by a single maintainer on a best-effort basis. Issues and
discussions are triaged and acknowledged as time allows; there is no commercial
support and no service level agreement.
