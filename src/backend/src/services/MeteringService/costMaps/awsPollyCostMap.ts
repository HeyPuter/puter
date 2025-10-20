// AWS Polly Cost Map (character-based pricing for text-to-speech)
//
// This map defines per-character pricing (in microcents) for AWS Polly TTS engines.
// Pricing is based on the ENGINE_PRICING object from AWSPollyService.js.
// Each entry is the cost per character for the specified engine.
//
// Pattern: "aws-polly:{engine}:character"
// Example: "aws-polly:standard:character" → 400 microcents per character
//
// Note: This is per-character pricing for TTS engines, not token-based.

export const AWS_POLLY_COST_MAP = {
    // Standard engine: $4.00 per 1M characters (400 microcents per character)
    'aws-polly:standard:character': 400,

    // Neural engine: $16.00 per 1M characters (1600 microcents per character)
    'aws-polly:neural:character': 1600,

    // Long-form engine: $100.00 per 1M characters (10000 microcents per character)
    'aws-polly:long-form:character': 10000,

    // Generative engine: $30.00 per 1M characters (3000 microcents per character)
    'aws-polly:generative:character': 3000,
};