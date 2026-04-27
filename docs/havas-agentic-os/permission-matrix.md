# Havas Agentic OS Permission Matrix

Current policy is enforced by UI routing, backend MCP endpoints, orchestrator approval logic, and append-only audit logging. It is still a demo-grade policy layer until real external MCP connectors are attached.

| Surface | Current capability | Allowed by default | Requires approval | Explicit limit |
| --- | --- | --- | --- | --- |
| Operator chat | Send agent messages and demo commands | Yes | No | Browser-local history only |
| PMAI demo | Briefs, risk summaries, backlog suggestions | Yes | No | Local demo payload, no durable task write |
| DevOps demo | Stage pipeline narrative, smoke status, rollback note | Yes | Deploy execution | No production deploy endpoint in inspected contract |
| OpenClaw demo | Public signal scan narrative | Yes | Private or authenticated source access | Demo endpoint only |
| Policy Manager workspace | Read policy, approval, exception, audit cards | Yes | Policy mutation | Static UI workspace content |
| Morpheus runtime | Route chat to runtime agent workspace | When runtime is attached | Destructive or external actions | Depends on Morpheus authorization |
| Goal fallback | Submit a goal to Morpheus `/api/v1/goal` | When route fails and Morpheus accepts it | Production execution | Backend only reports accepted goal id |
| Local filesystem/app launch | Open product apps via `launch_app` for selected app slugs | Yes for known product apps | Data mutation inside launched app | Governed by the launched app, not CXOS chat |
| MCP Hub | Broker Code, Jira, and Confluence tool calls | Yes for connected servers and read scopes | Any write, mutation, or private-source expansion | Non-MCP tools are rejected |
| Code MCP | Repo open, file tree, search, diff, history, summary | Read scoped repos | Branch switch, pipeline run | Never read ignored/noisy paths by default |
| Jira MCP | Project list, issue list, issue detail | Read scoped projects | Create, transition, comment | Writes require approval mode and audit id |
| Confluence MCP | Spaces, pages, page read, search | Read scoped spaces | Create, edit | Writes require approval mode and audit id |

## MCP Read/Write Matrix

| Flow | Read allowed | Write allowed only after approval | Required evidence |
| --- | --- | --- | --- |
| Code | Repo search, file inspect, branch/commit history, summary | Branch switch, pipeline run | Repo, ref, files touched, command/result summary, audit id |
| Jira | Project list, issue search, issue detail, board state | Issue create, transition, comment | Issue key, previous state, new state, approval mode, audit id |
| Confluence | Space list, page search, page read | Page create, page edit | Page id, diff summary, approval mode, audit id |

## Approval Rules

- Drafting, summarizing, routing, staging, and scanning public demo signals are default-allowed.
- Destructive operations, production deploys, policy changes, private-source scans, and authenticated third-party actions require explicit human approval and audit logging.
- Current approval modes are `approve_per_action` by default and `approve_once` when explicitly granted.
- Current CXOS fallback responses are presentation continuity, not proof that the action ran.
- MCP write responses must be labeled as proposed unless the connector returns durable evidence.
