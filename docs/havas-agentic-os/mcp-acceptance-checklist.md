# Havas Agentic OS MCP Acceptance Checklist

Use this checklist as the docs-level acceptance test set for Code, Jira, and Confluence MCP flows.

## Code MCP

- [ ] Read: can search scoped repo content without reading ignored or noisy paths.
- [ ] Read: can inspect branch, PR, and CI status with source refs.
- [ ] Write guard: commit, push, PR update, and CI rerun require approval.
- [ ] Evidence: response includes repo, ref, files touched, and result summary.

## Jira MCP

- [ ] Read: can list scoped projects through structured Jira MCP tools.
- [ ] Read: can search issues and inspect issue detail in scoped projects when Rovo/app search is available.
- [ ] Read: can summarize board state without mutation.
- [ ] Write guard: create, edit, transition, assign, comment, and link require approval.
- [ ] Evidence: write response includes issue key, previous state, new state, and approval id.
- [ ] Degraded mode: if Rovo/app search is unavailable, UI shows partial availability instead of pretending issue discovery succeeded.

## Confluence MCP

- [ ] Read: can search pages, read page content, and inspect comments in scoped spaces when discovery/search is available.
- [ ] Read: can cite page id or URL in returned evidence.
- [ ] Write guard: create, edit, move, archive, and comment require approval.
- [ ] Evidence: write response includes page id, diff summary, approval id, and rollback note.
- [ ] Degraded mode: if the Atlassian app/search surface is unavailable, UI shows blocked discovery state with cloudId/site metadata.

## Cross-Flow Gates

- [ ] Orchestrator labels mock, offline, and live connector evidence distinctly.
- [ ] MCP Hub denies writes when approver, target, payload summary, or rollback note is missing.
- [ ] Audit record includes actor, connector, action, target, timestamp, approval id, and result.
- [ ] Demo script avoids claims of durable external changes without connector evidence.
- [ ] Availability endpoint exposes live provider constraints separately from workspace payloads.
