// ElevenLabs Text-to-Speech Cost Map
//
// Pricing for ElevenLabs voices varies by model and plan tier. We don't yet
// have public micro-cent pricing, so we record usage with a zero cost. This
// prevents metering alerts while still tracking character counts for future
// cost attribution once pricing is finalized.

export const ELEVENLABS_COST_MAP = {
    'elevenlabs:eleven_multilingual_v2:character': 11,
    'elevenlabs:eleven_turbo_v2_5:character': 11,
    'elevenlabs:eleven_flash_v2_5:character': 5.5,
    'elevenlabs:eleven_v3:character': 11,
};
