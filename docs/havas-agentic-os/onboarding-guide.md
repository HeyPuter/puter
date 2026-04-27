# Havas Agentic OS Onboarding Guide

Use this guide to run the current Havas CXOS demo surface and understand what is real versus fallback.

## Roles

- Operator: uses the desktop, workspaces, chat, and quick commands.
- Agent owner: maps Morpheus runtime agents to workspace slugs.
- Policy owner: approves production deploys, destructive actions, private scans, and policy changes.

## First Run

1. Open the Havas CXOS desktop.
2. Open Documents, Policy Manager, TeserracT, DevOps, and OpenClaw workspaces to review static context.
3. Run `/pmai brief`, `/devops deploy`, and `/openclaw scan` to validate local demo mode.
4. Attach Morpheus on `:3550` and confirm runtime agents are discoverable.
5. Click an agent app to summon it; the UI sends `__summon__` through `/api/cx-agent/chat`.
6. Open MCP Connections, then verify `/api/havas-agentic-os/mcp/availability` reflects the active Atlassian/Code provider state.

## Operating Notes

- Agent chats are stored in browser `localStorage` per agent.
- Demo commands call `/api/cx-agent/demo`; regular messages call `/api/cx-agent/chat`.
- Unknown agents can still show a local demo workspace.
- The offline reply means Morpheus is unreachable or did not accept route/goal fallback.
- MCP routes live under `/api/havas-agentic-os/mcp/*`.
- Audit events append to `HAVAS_AGENTIC_OS_AUDIT_FILE` or `.havas-agentic-os-audit.jsonl`.
- Atlassian site metadata can be overridden with `HAVAS_ATLASSIAN_CLOUD_ID`, `HAVAS_ATLASSIAN_SITE_NAME`, and `HAVAS_ATLASSIAN_SITE_URL`.
- If Rovo search or Confluence discovery is unavailable on the Atlassian instance, the UI must show degraded availability instead of fake content.

## Handoff Checklist

- Confirm which parts are static workspace content, local demo responses, or live Morpheus runtime output.
- Confirm approval owners before showing DevOps deploy, policy mutation, or external-source scan narratives.
- Capture exact environment values for `MORPHEUS_URL` and `MORPHEUS_SECRET` when runtime behavior is part of the demo.
