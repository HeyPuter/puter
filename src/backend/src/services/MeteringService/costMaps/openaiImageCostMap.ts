// OpenAI Image Generation Cost Map (microcents per image)
// Pricing for DALL-E 2 and DALL-E 3 models based on image dimensions.
// All costs are in microcents (1/1,000,000th of a cent). Example: 1,000,000 microcents = $0.01 USD.//
// Naming pattern: "openai:{model}:{size}" or "openai:{model}:hd:{size}" for HD images

import { toMicroCents } from '../utils';

export const OPENAI_IMAGE_COST_MAP = {
    // DALL-E 3
    'openai:dall-e-3:1024x1024': toMicroCents(0.04),        // $0.04
    'openai:dall-e-3:1024x1792': toMicroCents(0.08),         // $0.08
    'openai:dall-e-3:1792x1024': toMicroCents(0.08),        // $0.08
    'openai:dall-e-3:hd:1024x1024': toMicroCents(0.08),     // $0.08
    'openai:dall-e-3:hd:1024x1792': toMicroCents(0.12),    // $0.12
    'openai:dall-e-3:hd:1792x1024': toMicroCents(0.12),    // $0.12

    // DALL-E 2
    'openai:dall-e-2:1024x1024': toMicroCents(0.02),        // $0.02
    'openai:dall-e-2:512x512': toMicroCents(0.018),          // $0.018
    'openai:dall-e-2:256x256': toMicroCents(0.016),          // $0.016

    // gpt-image-1
    'openai:gpt-image-1:low:1024x1024': toMicroCents(0.011),
    'openai:gpt-image-1:low:1024x1536': toMicroCents(0.016),
    'openai:gpt-image-1:low:1536x1024': toMicroCents(0.016),
    'openai:gpt-image-1:medium:1024x1024': toMicroCents(0.042),
    'openai:gpt-image-1:medium:1024x1536': toMicroCents(0.063),
    'openai:gpt-image-1:medium:1536x1024': toMicroCents(0.063),
    'openai:gpt-image-1:high:1024x1024': toMicroCents(0.167),
    'openai:gpt-image-1:high:1024x1536': toMicroCents(0.25),
    'openai:gpt-image-1:high:1536x1024': toMicroCents(0.25),

    // gpt-image-1-mini
    'openai:gpt-image-1-mini:low:1024x1024': toMicroCents(0.005),
    'openai:gpt-image-1-mini:low:1024x1536': toMicroCents(0.006),
    'openai:gpt-image-1-mini:low:1536x1024': toMicroCents(0.006),
    'openai:gpt-image-1-mini:medium:1024x1024': toMicroCents(0.011),
    'openai:gpt-image-1-mini:medium:1024x1536': toMicroCents(0.015),
    'openai:gpt-image-1-mini:medium:1536x1024': toMicroCents(0.015),
    'openai:gpt-image-1-mini:high:1024x1024': toMicroCents(0.036),
    'openai:gpt-image-1-mini:high:1024x1536': toMicroCents(0.052),
    'openai:gpt-image-1-mini:high:1536x1024': toMicroCents(0.052),
};