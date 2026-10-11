# Contributing to Puter

Thanks for contributing. These rules aren't strictly enforced, but following them makes every PR easier. If anything's unclear, ping a core maintainer or open the PR and ask.

- New to the backend? Start with [doc/architecture.md](doc/architecture.md).
- Code, test, and docs conventions for the whole repo live in [AGENTS.md](AGENTS.md). It's written for AI agents; the conventions apply to human contributors too.
- Adding or changing a public API (an endpoint, driver method, or puter.js method)? Follow [doc/contributing-apis.md](doc/contributing-apis.md): backward compatibility, [developer docs](src/docs/), types, and tests all move in the same PR.
- Found a vulnerability? Report it privately per [SECURITY.md](SECURITY.md).

---

## Before you open a PR

Check your diff against these sections of AGENTS.md:

- [Working rules of thumb](AGENTS.md#working-rules-of-thumb): run it end to end, test new behavior and bug fixes, understand every line you commit (AI assistance is fine), leave touched files a bit better, and publish limit changes.
- [Reuse and abstraction](AGENTS.md#reuse-and-abstraction) and [hot paths](AGENTS.md#hot-paths).
- [Security & privacy](AGENTS.md#security--privacy): expose nothing the caller doesn't need.

## Opening a PR

- One thing per PR where possible.
- Describe **what** and **why**; the diff shows how.
- Mention how you tested user-visible changes.
- Drafts welcome.

---

Questions? Message a core maintainer. Welcome aboard.
