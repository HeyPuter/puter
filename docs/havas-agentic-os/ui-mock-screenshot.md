# Havas Agentic OS UI Mock And Screenshot Notes

## Target Mock

The first screen shows the current Havas desktop with the chat panel open on the right and a focused Agentic OS workspace in the main area.

## Visible Elements

- Top workspace title: `Agentic OS Orchestrator`.
- Left or central evidence rail with three sources: `Code`, `Jira`, and `Confluence`.
- Main panel showing an evidence bundle with source, timestamp, confidence, and action status.
- Approval drawer showing actor, target, requested write, required approver, and rollback note.
- Chat composer showing the operator request and Orchestrator response.

## Screenshot States

- Read state: Code, Jira, and Confluence cards are marked `Read complete`.
- Pending write state: Jira or Confluence card is marked `Approval required`.
- Completed write state: card shows connector audit id and rollback note.
- Offline state: banner says `MCP connector unavailable; showing mock evidence`.

## Capture Rules

- Do not imply live write execution unless the screenshot includes an audit id.
- Keep browser-local chat history visually distinct from durable audit evidence.
- Avoid showing secrets, tokens, private issue text, or ignored repository paths.
