# Contributing to Puter Backend

Thanks for taking the time to contribute. Puter moves fast and we want to keep it that way without sacrificing quality, so this guide leans on shared judgment more than strict gates. None of these rules are harshly enforced — but every PR that follows them makes the next one easier.

If you're not sure about something, open the PR anyway and ask. It's almost always better than not contributing.

New to the backend? Start with [doc/architecture.md](doc/architecture.md) — it covers the layered stack (controllers → services → stores → clients), how extensions plug in, and the core conventions.

---

## 1. Test it. Run it.

Before you open a PR, the change should actually work — not just compile.

- Run the affected code path end-to-end at least once. If it's a UI change, click through it. If it's an API change, hit the endpoint.
- If something is hard to test, that's worth a comment in the PR — it usually points at a design issue we can fix together.

"It builds" and "it passes type checks" are not the same as "it works."

### 1.1 Add tests for new things, where applicable

If you're introducing new behavior — a new function, endpoint, component, or branch of logic — add a test for it where it's reasonable to do so. Untested new code is the easiest place for regressions to hide later.

- New behavior with a clear input/output? Write a test.
- New bug fix? A regression test stops it coming back.
- Genuinely hard to cover (UI animation, third-party integration, infra glue)? Skip it, but say so in the PR so a reviewer can sanity-check the call.

We're not chasing a coverage number. We're trying to make sure the things we care about don't break silently.

## 2. Follow the patterns that are already there

Puter has established structures for the backend, the frontend, drivers, extensions, and more. When you add something new, look at how similar things are done elsewhere and match that shape. Consistency is worth more than personal preference here, because it lowers the cost of reading code for everyone else.

[**doc/architecture.md**](doc/architecture.md) is the source of truth for the backend: layer responsibilities (controllers, drivers, services, stores, clients), how `PuterServer` wires them, when to use `Context`, what belongs in an extension vs. core, and the naming/dedup/cross-layer rules. When you're adding something new, that doc tells you which layer it belongs in and what shape it should take. When in doubt, read the neighbors before you write.

If you genuinely think the existing pattern is wrong, that's a great conversation to have — raise it in the PR or an issue, don't quietly diverge.

## 3. Don't expose system or user information

We take security and privacy seriously, and most leaks happen by accident — a stray `console.log`, a debug endpoint left in, an error message that includes a file path or a user ID.

Before opening a PR, scan your diff for:

- Logs, error messages, or responses that include internal paths, secrets, tokens, env vars, or user data that the caller shouldn't see.
- Debug routes, test credentials, or commented-out auth checks.
- New endpoints that return more than the caller actually needs.

When in doubt, return less. If your change touches anything auth-, permission-, or data-export-related, call that out in the PR description so reviewers know to look closely.

For security issues you don't want to discuss in public, see [SECURITY.md](SECURITY.md).

## 4. AI-assisted code is welcome — understood code is required

Use whatever tools help you ship. Copilot, Claude, Cursor — all fine. We use them too.

The line is simple: **don't commit code you couldn't have written, debugged, or defended yourself.**

That means:

- You've read the diff, not just accepted it.
- You understand what each function does and why it's there.
- You ran it (see rule 1) and you can explain in review what you'd check if it broke.

If a reviewer asks "why does this work?" and the honest answer is "the model said so," that's the bar we're trying to stay above. AI is a great accelerator for things you understand, and a quiet way to ship bugs for things you don't.

## Opening a PR

- Keep PRs focused on one thing where you can. Two small PRs review faster than one mixed one.
- Write a description that says **what** changed and **why**. The diff already shows the how.
- If your change is user-visible, mention how you tested it.
- Drafts are welcome — open early if you want feedback before the change is finished.

## 5. Boy Scout Rule — leave it 1% better

Small improvements compound. Big rewrites rarely happen. So when you're already in a file:

- Fix the obvious typo, the missing typehint, the dead import.
- Add the test that should have existed.
- Tidy the bit you had to read three times to understand.

You don't need to clean up the whole module — just leave the area you touched a little better than you found it.

```
1% better every day   1.01^365 = 37.38
1% worse  every day   0.99^365 =  0.03
```

The opposite is also true: a small mess left behind, every day, eventually buries us. Don't be the 0.99.

Keep cleanup proportional to the change. A bug fix doesn't need a refactor riding along — that just makes review harder. Use judgment.

---

That's it. Welcome aboard, and thanks for making Puter better.
