# Contributing to Puter Backend

Thanks for contributing. These rules aren't strictly enforced — but following them makes every PR easier. If anything's unclear, ping a core maintainer or open the PR and ask.

New to the backend? Start with [doc/architecture.md](doc/architecture.md).

---

## 1. Test it. Run it.

Run the affected code path end-to-end before opening a PR. "It builds" is not "it works."

Add tests for new behavior, endpoints, or bug fixes. If something's genuinely hard to test, say so in the PR.

## 2. Follow existing patterns

Match the shape of similar code already in the repo. [doc/architecture.md](doc/architecture.md) is the source of truth for layers, wiring, and naming. If you think a pattern is wrong, raise it — don't quietly diverge.

## 3. Don't expose system or user information

Scan your diff for stray logs, debug routes, internal paths, secrets, tokens, or user data in errors/responses. When in doubt, return less. Flag any auth, permission, or data-export changes in the PR description.

For private security reports, see [SECURITY.md](SECURITY.md).

## 4. AI-assisted code is fine — understood code is required

Don't commit code you couldn't have written, debugged, or defended yourself. Read the diff, run it, and be ready to explain it in review.

## 5. Update docs for API changes

If you change puter-js APIs (drivers or endpoints used by puter-js), update [developer docs](src/docs/). puter-js itself may also need updating.

## 6. Boy Scout Rule — leave it 1% better

![Boy Scout Rule](https://imgs.search.brave.com/DMmIWl5-NuZVtrR9kXBb06AKF8kturkgSW9UMb2-6m4/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9sYXdz/b2Zzb2Z0d2FyZWVu/Z2luZWVyaW5nLmNv/bS9pbWFnZXMvbGF3/cy9ib3ktc2NvdXQt/cnVsZS5wbmc)

Fix the typo, the dead import, the missing test, the bit you had to read twice. Keep cleanup proportional to the change — no refactors riding along on bug fixes.

---

## Opening a PR

- One thing per PR where possible.
- Describe **what** and **why**; the diff shows how.
- Mention how you tested user-visible changes.
- Drafts welcome.

---

Questions? Message a core maintainer. Welcome aboard.
