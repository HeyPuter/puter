FOLLOW ./AGENTS.md

- Any change that alters the response shape of an existing (pre-cutoff) model — as the
  Responses-API finish_reason/reasoning change in OpenAIUtil.js did — must sit behind the
  normalize policy resolution or be explicitly approved first. Equalization work never
  licenses silent changes to what current models already return.
- Before writing a behavioral claim into chat.md/chatresponse.md, verify it against every
  code path it covers: the Mistral remap and the Anthropic coercer handled unmapped
  finish_reason differently, and the shipped sentence was true for one and false for the other.
- When you self-disclose a defect mid-session, immediately record it in a Known Gaps section
  of the PR draft — disclosures that live only in the transcript do not survive to review,
  and a prepared PR silently ships them.
- Make the final act before handoff a fresh `npm run build:workerLib` followed by the suites,
  stating exit codes; never pipe a suite run through grep when the exit code is the evidence.
- When a user's uncommitted edit "vanishes" from the worktree, check `git stash list` before
  concluding it was lost — GitHub Desktop auto-stashes on branch switch as
  "!!GitHub_Desktop<branch>" and `git stash pop` recovers it.
- `tools/typecheck-baseline.json` is a permanent no-go zone: never edit it and never run
  `typecheck:update`, subagents included.
