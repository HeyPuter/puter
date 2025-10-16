# PuterAI Module

The PuterAI module provides AI capabilities to Puter through various services including:

- Text generation and chat completion
- Text-to-speech synthesis
- Image generation
- Document analysis

## Metered Services

All AI services in this module are metered using Puter's MeteringService. This allows us to charge per `unit` usage, where a `unit` is defined by the specific service:
for example, most LLMs will charge per token, AWS Polly charges per character, and AWS Textract charges per page. the metering service tracks usage units, and relies on its centralized cost maps to determine if a user has enough credits to perform an operation, and to record usage after the operation is complete.

see [MeteringService](../../../src/services/MeteringService/MeteringService.ts) for more details on how metering works.