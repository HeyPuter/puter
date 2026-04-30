// Microcents per second of audio, per ElevenLabs speech-to-speech model.
// Values mirror the ElevenLabs scale tier (per-unit × 0.9).
export const VOICE_CHANGER_COSTS: Record<string, number> = {
    'elevenlabs:eleven_multilingual_sts_v2:second': 300000 * 0.9,
    'elevenlabs:eleven_english_sts_v2:second': 300000 * 0.9,
};
