# Havas Agentic OS Specification

## Vision

Havas Agentic OS is a desktop-grade agent workspace built on an MCP-first integration spine. It is not a Jira feature, a code viewer, or a docs panel in isolation. It is a unified operating surface where agents and operators can work across code, delivery systems, and knowledge systems through one permissioned, auditable tool layer.

The first shipping scope covers three first-class apps:

- Code
- Jira
- Confluence

These apps must behave like OS-native workspaces, share one command and approval model, and route all external actions through MCP-compatible tools only.

## Product Goals

- Make MCP the single integration contract for external tools.
- Give agents and operators one shared desktop workflow across code, tickets, and docs.
- Keep read paths fast and useful without weakening write safety.
- Make every write path approval-gated and every tool call auditable.
- Preserve a degraded but truthful user experience when a connector is partially available.

## Non-Goals

- Non-MCP adapters or hidden direct API integrations.
- Fake live states when a connector is blocked or partial.
- Silent write execution.
- App-specific permission models that diverge from the OS spine.
- Future-looking modules with no present consumer.

## Core Principles

### MCP-first

All external integrations must be exposed through MCP-compatible servers and clients. If a system cannot be reached through MCP, it is out of scope for the OS surface until an MCP bridge exists.

### Truthful degraded states

The OS must distinguish between:

- live connected read
- imported evidence
- blocked
- unavailable

No UI or agent response may imply live execution when only evidence or status data exists.

### Approval before write

Read-only is the default. Write actions require explicit approval via OS-level permission handling. If approval semantics are unclear, fail closed.

### Shared OS spine

Code, Jira, Confluence, the command palette, and the task monitor all use the same:

- connection model
- tool discovery
- capability listing
- approval rules
- audit trail
- orchestrator routing

## System Scope

## 1. MCP Hub

The MCP Hub is the integration spine for the OS.

### Responsibilities

- register multiple MCP servers
- connect and reconnect servers
- expose tool discovery
- expose capability listing
- track secure auth state per server
- negotiate permissions
- execute reads and proposal-style writes
- emit append-only audit events
- expose health and availability

### Required surfaces

- `/api/havas-agentic-os/mcp/tools`
- `/api/havas-agentic-os/mcp/capabilities`
- `/api/havas-agentic-os/mcp/connect`
- `/api/havas-agentic-os/mcp/health`
- `/api/havas-agentic-os/mcp/availability`
- `/api/havas-agentic-os/mcp/task-monitor`
- `/api/havas-agentic-os/mcp/proposals`

### Core state per server

- `serverId`
- `connectionStatus`
- `authState`
- `healthState`
- `capabilities`
- `tools`
- `requestedPermissions`
- `grantedPermissions`
- `lastError`
- `availabilityMode`

### Availability modes

- `live`
- `degraded`
- `evidence`
- `blocked`
- `offline`

## 2. Code Workspace

The Code app is the engineering workspace inside the OS.

### UI shape

- left: repo tree
- center tabs: File, Diff, History, Search, PR
- right: agent sidecar

### Required capabilities

- open local repo
- support remote clone if the code MCP server provides it
- list files
- open file
- search repo
- show staged changes
- diff against main
- view commit history
- switch branch
- run tests or pipeline through MCP
- generate repo summary through orchestrator
- ask agent with code selection context

### Agent behaviors

The agent can request code actions through MCP tools only:

- open file
- search text
- show diff
- run pipeline
- generate summary

Any execution-class action must remain visible in the task monitor and audit log.

## 3. Jira Workspace

The Jira app is the delivery workspace inside the OS.

### UI shape

- projects list
- boards
- filtered issues
- issue detail
- comments
- acceptance criteria view
- proposal/write status panel

### Required read capabilities

- list projects
- list issues by filter
- open issue detail
- read comments
- read workflow status

### Required write capabilities

- create issue
- add comment
- transition issue

### Write execution model

Jira writes are OS-managed proposal-and-approval flows:

1. agent or operator proposes an action
2. OS records proposal and audit event
3. OS shows approval requirement
4. approved proposal may execute through MCP
5. final result is logged

If the live Jira connector is not fully available, the UI must stay in `proposal-only` or `evidence-only` mode and say so explicitly.

## 4. Confluence Workspace

The Confluence app is the knowledge workspace inside the OS.

### UI shape

- spaces list
- recent pages
- search
- page viewer
- ask-agent actions
- write approvals and audit visibility

### Required read capabilities

- list spaces
- list pages
- read page
- search pages
- summarize page
- extract action items

### Required write capabilities

- create page
- update page

### Write execution model

Confluence follows the same OS-level proposal, approval, and audit model as Jira. If discovery or page access is blocked, the UI must show `blocked` or `status-only`, not a fake live experience.

## 5. Command Palette

The command palette is the OS-global action bus.

### Requirements

- available anywhere
- keyboard shortcuts:
  - `Ctrl+K`
  - `Cmd+K`
- show tool availability
- show permission status
- show approval requirements
- open apps and run MCP-backed actions

### Initial commands

- Open Code
- Open Jira
- Open Confluence
- Search code for ...
- Find Jira issue ...
- Summarize Confluence page ...
- Run pipeline ...
- Review Jira proposals
- Open Task Monitor

## 6. Task Monitor

The Task Monitor is the OS execution ledger.

### Requirements

- show task chain
- show active MCP tool call chain
- show proposal queue
- show approvals
- show errors
- show recent audit events
- show audit file location or source

It must be the canonical place to understand:

- what the agent attempted
- what needs approval
- what ran
- what failed
- what was logged

## 7. Agent Orchestrator

The orchestrator is the MCP-first routing layer for agent actions.

### Rules

- prefer MCP tools when available
- never route to a non-MCP external integration
- support retry with backoff for retryable failures
- allow fallback only to another MCP-compatible tool
- preserve approval requirements during retries and fallback
- emit structured task state for the task monitor

### Routing priorities

1. security and privacy
2. permission enforcement
3. MCP-only rule
4. truthfulness of availability state
5. user-facing usefulness

## Permission Model

### Defaults

- all servers start read-only
- read tools may run when matching granted scopes exist
- write tools require approval
- approval modes:
  - `approve_once`
  - `approve_per_action`

### Enforcement points

- MCP connection negotiation
- tool execution gate
- proposal creation
- approval grant/revoke
- orchestrator action routing
- command palette action launch

## Audit Model

Every MCP interaction must create or update an append-only audit trail.

### Minimum audit fields

- `auditId`
- `serverId`
- `toolName`
- `actionType`
- `actor`
- `target`
- `timestamp`
- `approvalMode`
- `permissionDecision`
- `result`
- `errorCode`

### Audit guarantees

- secrets never logged
- auth tokens stored encrypted
- audit log is append-only
- proposal submission is logged even before execution
- denied actions are logged

## Data Contracts

The OS must keep one consistent contract family across backend and UI.

### Shared contract groups

- connection payload
- tools payload
- capabilities payload
- availability payload
- task monitor payload
- proposal payload
- audit payload

### Backend constraint

Live connectors may replace demo or evidence adapters only behind the same payload shape. UI should not need a redesign to switch from evidence to live.

## Delivery Phases

## Phase 1: OS spine stabilization

- MCP Hub routes and contracts
- secure auth state
- append-only audit
- task monitor and command palette wiring
- truthful availability states

## Phase 2: First-class app completion

- Code workspace completion
- Jira workspace connected-read
- Confluence workspace connected-read
- proposal visibility and approval UX polish

## Phase 3: Live write bridge

- Jira approved execution path
- Confluence approved execution path
- stronger approval and revoke UX
- richer error and retry handling

## Acceptance Criteria

### MCP Hub

- multiple MCP servers can connect simultaneously
- tools and capabilities can be listed per server
- auth state is stored without leaking secrets
- health and availability are queryable

### Code

- repo opens
- file tree works
- file open works
- search works
- diff works
- pipeline action appears in monitor and audit

### Jira

- projects and issues are visible through live read or truthful evidence mode
- issue detail opens
- proposal write actions appear in proposal queue
- approval requirement is visible before execution
- all related audit events are visible

### Confluence

- spaces or truthful blocked state are visible
- page search and read work when connector is live
- create/update paths remain approval-gated
- blocked/discovery failures are explicit

### Global OS

- command palette is global
- task monitor shows tool chain, approvals, errors, and audit
- no write occurs without approval
- no non-MCP external integration path exists

## Open Risks

- Atlassian capability availability may differ per tenant and per installed app surface.
- Jira may remain partially live while Confluence stays blocked.
- NVIDIA/Qwen builder usage can accelerate implementation, but it does not change runtime connector truthfulness.

## Current Implementation Direction

The repo should align to existing MCP hub, router, orchestrator, audit, and desktop UI patterns. New work should replace demo or evidence-only adapters with live MCP connectors behind the same contracts rather than creating parallel surfaces.
