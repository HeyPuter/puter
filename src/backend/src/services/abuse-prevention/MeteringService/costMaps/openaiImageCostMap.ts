// OpenAI Image Generation Cost Map (microcents per image)
// Pricing for DALL-E 2 and DALL-E 3 models based on image dimensions.
// All costs are in microcents (1/1,000,000th of a cent). Example: 1,000,000 microcents = $0.01 USD.
//
// Source: [`TrackSpendingService.js`](../../../../TrackSpendingService.js) ImageGenerationStrategy static models
//
// Naming pattern: "openai:{model}:{size}" or "openai:{model}:hd:{size}" for HD images

export const OPENAI_IMAGE_COST_MAP = {
    // DALL-E 3
    "openai:dall-e-3:1024x1024": 40000,        // $0.04
    "openai:dall-e-3:1024x1792": 80000,        // $0.08
    "openai:dall-e-3:1792x1024": 80000,        // $0.08
    "openai:dall-e-3:hd:1024x1024": 80000,     // $0.08
    "openai:dall-e-3:hd:1024x1792": 120000,    // $0.12
    "openai:dall-e-3:hd:1792x1024": 120000,    // $0.12

    // DALL-E 2
    "openai:dall-e-2:1024x1024": 20000,        // $0.02
    "openai:dall-e-2:512x512": 18000,          // $0.018
    "openai:dall-e-2:256x256": 16000,          // $0.016
};