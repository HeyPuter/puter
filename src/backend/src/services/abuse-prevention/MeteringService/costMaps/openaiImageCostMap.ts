// OpenAI Image Generation Cost Map (microcents per image)
// Pricing for DALL-E 2 and DALL-E 3 models based on image dimensions.
// All costs are in microcents (1/1,000,000th of a cent). Example: 1,000,000 microcents = $0.01 USD.
//
// Source: [`TrackSpendingService.js`](../../../../TrackSpendingService.js) ImageGenerationStrategy static models
//
// Naming pattern: "openai:{model}:{size}" or "openai:{model}:hd:{size}" for HD images

import { toMicroCents } from "../utils";



export const OPENAI_IMAGE_COST_MAP = {
    // DALL-E 3
    "openai:dall-e-3:1024x1024": toMicroCents(0.04),        // $0.04
    "openai:dall-e-3:1024x1792": toMicroCents(0.08),         // $0.08
    "openai:dall-e-3:1792x1024": toMicroCents(0.08),        // $0.08
    "openai:dall-e-3:hd:1024x1024": toMicroCents(0.08),     // $0.08
    "openai:dall-e-3:hd:1024x1792": toMicroCents(0.12),    // $0.12
    "openai:dall-e-3:hd:1792x1024": toMicroCents(0.12),    // $0.12

    // DALL-E 2
    "openai:dall-e-2:1024x1024": toMicroCents(0.02),        // $0.02
    "openai:dall-e-2:512x512": toMicroCents(0.018),          // $0.018
    "openai:dall-e-2:256x256": toMicroCents(0.016),          // $0.016

    // gpt-image-1
    "low:1024x1024": toMicroCents(0.011),
    "low:1024x1536": toMicroCents(0.016),
    "low:1536x1024": toMicroCents(0.016),
    "medium:1024x1024": toMicroCents(0.042),
    "medium:1024x1536": toMicroCents(0.063),
    "medium:1536x1024": toMicroCents(0.063),
    "high:1024x1024": toMicroCents(0.167),
    "high:1024x1536": toMicroCents(0.25),
    "high:1536x1024": toMicroCents(0.25),
};