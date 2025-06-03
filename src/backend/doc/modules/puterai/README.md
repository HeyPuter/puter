# PuterAI Module

The PuterAI module provides AI capabilities to Puter through various services including:

- Text generation and chat completion
- Text-to-speech synthesis
- Image generation
- Document analysis

## Metered Services

All AI services in this module are metered using Puter's CostService infrastructure. For details on how metering works and how to implement it in new services, see the [Metered Services documentation](../../features/metered-services.md).

Each AI service defines its own cost structure based on its specific usage patterns:

### Text Generation Models

- Costs are typically defined per million tokens
- Separate rates for input and output tokens
- Different models have different pricing tiers

### Text-to-Speech (AWS Polly)

- Cost per character
- Fixed rate regardless of voice or language

### Document Analysis (AWS Textract)

- Cost per page
- Fixed rate for basic layout analysis

### Image Generation (DALL-E)

- Cost varies by image size and quality
- Different rates for different models

## Service Implementation

Each service in this module:

1. Defines its cost structure
2. Validates available funds before operations
3. Records costs after successful operations
4. Handles insufficient funds errors appropriately

For implementation details of specific services, see their respective documentation files in this directory.
