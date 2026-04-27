# Havas Agentic OS MCP E2E Demo

This demo validates the implemented MCP hub, desktop windows, approval modes, and append-only audit flow.

## Preconditions

- Havas CXOS desktop can open the Agentic OS surface.
- Morpheus is optional unless live runtime routing is part of the demo.
- MCP connectors for Code, Jira, and Confluence are either attached or represented by the bundled demo adapters.
- Operator, approver, and audit owner are named before write flows are shown.
- Optional: set `HAVAS_AGENTIC_OS_AUDIT_FILE` to control where append-only audit JSONL is written.
- Optional: set `HAVAS_ATLASSIAN_CLOUD_ID`, `HAVAS_ATLASSIAN_SITE_NAME`, and `HAVAS_ATLASSIAN_SITE_URL` to override the default Atlassian site metadata shown in the UI.

## Demo Path

1. Open the Havas Agentic OS desktop.
2. Open MCP Connections and confirm Code, Jira, and Confluence are connected.
3. Call `/api/havas-agentic-os/mcp/availability` and confirm live provider constraints are visible before entering workspaces.
4. Open Code and verify repo tree, search, diff/history, and command palette entries.
5. Open Jira and Confluence and verify read flows render from live MCP routes or clearly degraded availability state.
6. Trigger a write action such as Jira comment or pipeline run.
7. Confirm the default `approve_per_action` mode blocks the write.
8. Grant `approve_once` or submit explicit approval, then rerun the action.
9. Verify audit id and append-only audit record path are surfaced in the UI/API response.

## Expected Result

- Read flows return scoped evidence with source names.
- Write flows show target, payload summary, approval mode, audit id, and rollback note.
- Offline or mock mode is clearly labeled as non-durable.
- No claim of completed external mutation appears without connector evidence.
- Partial Atlassian availability is shown honestly: Jira project discovery may work while Rovo search or Confluence discovery remains blocked.
