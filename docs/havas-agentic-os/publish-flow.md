# Havas Agentic OS Publish Flow

The inspected code supports demo publishing of the Havas Agentic OS experience through repo assets, UI routes, and backend demo endpoints. It does not expose a dedicated production publish API.

## Flow

1. Prepare docs, design tokens, screenshots, and demo workspace copy in the repo.
2. Start the Puter backend and GUI with the CXOS desktop enabled.
3. Attach Morpheus at `http://localhost:3550` or set `MORPHEUS_URL`; add `MORPHEUS_SECRET` if the runtime requires `x-service-secret`.
4. Verify local demo commands: `/pmai brief`, `/devops deploy`, and `/openclaw scan`.
5. Verify chat routing through `POST /api/cx-agent/chat` with an attached runtime agent.
6. Capture final assets only after fallback behavior is acceptable for the demo.

## Release Gates

- UI opens Havas workspaces and native product apps without changing `UICXOSDesktop.js`.
- `/api/cx-agent/demo` returns valid payloads for PMAI, DevOps, and OpenClaw.
- `/api/cx-agent/chat` either routes to Morpheus, submits a Morpheus goal fallback, or returns the documented offline message.
- Any claim of live autonomous execution is removed unless Morpheus is attached and audit evidence is available.

## Rollback

- Disable Morpheus runtime attachment by clearing `MORPHEUS_URL` or pointing it away from the runtime.
- Remove demo workspace exposure from the GUI route or feature flag in a separate implementation change.
- Keep docs and tokens versioned so presentation assets remain reproducible.
