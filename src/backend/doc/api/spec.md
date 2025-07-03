# API Specification

## AI Model Naming

### Scope

This rule applies to `model` field in AI-related API endpoints. Such as:

- `puter-chat-completion/complete`

### Request Format

- interface (type: string, required) (`"puter-chat-completion"`)
- method (type: string, required) (`"complete"`)
- driver (type: string, optional) (`"ai-chat"` / `"openrouter"`)
- args
  - model (type: string, required) (e.g., `"gpt-4o"`, `"openai/gpt-4o"`, `"azure:openai/gpt-4o"`)
  - messages (type: array, required)
    - (e.g., `["Hello! How are you?"]`)
    - (e.g., `[{ content: "Hello! How are you?" }]`)

### Rule

- 3 formats are allowed:
  - `<model-name>` (e.g., `gpt-4o`)
  - `<vendor>/<model-name>` (e.g., `openai/gpt-4o`)
  - `<supplier>:<vendor>/<model-name>` (e.g., `azure:openai/gpt-4o`)
-
- All models have a vender name. But not all models have a supplier name.
- When the supplier name is specified, the validation of the model name is done by the supplier instead of puter backend.
- We should only initialize an AI service if the corresponding config is given.

- Backend will pick a model when multiple candidates match the request. For instance, if a request specifies `gpt-4o`, the system will pick the most affordable model that matches `gpt-4o` from all available models.
- Backend will return an error on invalid model names and invalid formats.
- Available models are defined in this [list](https://puter.com/puterai/chat/models).
