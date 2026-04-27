# Havas Agentic OS Implementation Plan

## Task Tracking

At the start, use `TaskCreate` to create a task for each step:

1. Lock shared MCP contracts and truthfulness states
2. Complete Code workspace against the MCP spine
3. Upgrade Jira from evidence mode to connected-read
4. Upgrade Confluence from blocked/status-only to connected-read
5. Wire proposal approval flow through Task Monitor and palette
6. Run `/izonconsule:finalize` skill

## Existing Patterns

Pattern survey summary:

- [src/backend/src/havas-agentic-os/mcp-hub.ts](/Users/mehmet.turac/Documents/minitools/tosdesk/src/backend/src/havas-agentic-os/mcp-hub.ts): core MCP registry, approvals, proposals, audit contract
- [src/backend/src/havas-agentic-os/orchestrator.ts](/Users/mehmet.turac/Documents/minitools/tosdesk/src/backend/src/havas-agentic-os/orchestrator.ts): MCP-first task execution and routing
- [src/backend/src/routers/havas-agentic-os.js](/Users/mehmet.turac/Documents/minitools/tosdesk/src/backend/src/routers/havas-agentic-os.js): existing aligned route family for code, jira, confluence, commands, task monitor, tools, availability
- [src/backend/src/havas-agentic-os/tasks.ts](/Users/mehmet.turac/Documents/minitools/tosdesk/src/backend/src/havas-agentic-os/tasks.ts) and [audit.ts](/Users/mehmet.turac/Documents/minitools/tosdesk/src/backend/src/havas-agentic-os/audit.ts): monitor and append-only audit primitives
- [src/gui/src/UI/UICXOSDesktop.js](/Users/mehmet.turac/Documents/minitools/tosdesk/src/gui/src/UI/UICXOSDesktop.js): shared normalization and rendering pattern for MCP-backed OS apps
- [src/gui/src/havas-agentic-os/demoData.js](/Users/mehmet.turac/Documents/minitools/tosdesk/src/gui/src/havas-agentic-os/demoData.js) and [styles.js](/Users/mehmet.turac/Documents/minitools/tosdesk/src/gui/src/havas-agentic-os/styles.js): fallback payloads and established OS visual language

Alignment decision:

- follow the existing `/api/havas-agentic-os/mcp/*` route family
- preserve current shared payload shapes and UI normalization
- preserve proposal-and-approval semantics for writes
- deviate only by replacing demo or evidence adapters with live MCP-backed connectors behind the same contracts

No-pattern note:

- there is no established live Atlassian write bridge yet
- Confluence live discovery remains a real integration gap, not a UI gap

## Skills

After plan approval and before making edits, run `/izonconsule:review-plan`, `/izonconsule:review-code`, `/izonconsule:finalize`.

## Step 1: Lock MCP Contract and Availability Semantics

- freeze the backend payload contract for:
  - connections
  - tools
  - capabilities
  - availability
  - task monitor
  - proposals
- ensure `live`, `degraded`, `evidence`, `blocked`, and `offline` are used consistently
- remove any remaining ambiguity that could imply live Jira or Confluence when only evidence exists

Outcome:

- backend and UI can evolve connectors without changing user-facing semantics

## Step 2: Complete Code Workspace on the Existing Spine

- verify file tree, search, diff, history, branch, and pipeline flows all map cleanly to MCP tools
- close any missing UI gaps in the Code window
- ensure command palette and task monitor expose Code actions consistently

Outcome:

- Code becomes the reference app for a fully connected MCP workspace

## Step 3: Upgrade Jira to Connected-Read

- replace evidence-first Jira reads with live MCP-backed project, issue, and detail reads where tenant capability allows
- keep proposal-style write tools as approval-gated
- preserve fallback to evidence mode only when live Jira is unavailable
- keep audit and truthfulness messaging intact

Outcome:

- Jira becomes a first-class connected-read app without weakening write safety

## Step 4: Upgrade Confluence to Connected-Read

- identify the real tenant/app limitation blocking live Confluence data
- wire list/search/read through MCP when accessible
- keep explicit `blocked` or `status-only` state when capability is absent
- do not fake a usable docs experience before backend discovery truly works

Outcome:

- Confluence is either honestly connected-read or honestly blocked, never ambiguous

## Step 5: Tighten Proposal, Approval, and Monitor UX

- finish the loop between proposal creation, command palette entry points, task monitor visibility, and approval actions
- surface proposal state, approval scope, and audit identifiers consistently
- make it obvious what is pending, what was denied, and what executed

Outcome:

- write paths feel OS-native and controllable rather than hidden backend mechanics

## Step 6: Run `/izonconsule:finalize` Skill

Run the `/izonconsule:finalize` skill to run tests, simplify code, review, and commit.
