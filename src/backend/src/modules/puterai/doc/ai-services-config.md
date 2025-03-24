# Configuring AI Services

AI services are configured under the `services` block in the configuration file. Each service requires an `apiKey` to authenticate requests.

## Example Configuration
```json
{
  "services": {
    "openai": {
      "apiKey": "sk-abcdefg..."
    },
    "deepseek": {
      "apiKey": "sk-xyz123..."
    },
    "other-ai-service": {
      "apiKey": "sk-hijklmn..."
    }
  }
}
