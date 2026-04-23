// Microcents per character for TTS synthesis, per model. Values mirror the
// ElevenLabs scale tier (per-additional-char × 0.9). Seconds-based costs
// for speech-to-speech live on VoiceChangerDriver.
export const ELEVENLABS_TTS_COSTS: Record<string, number> = {
    eleven_multilingual_v2: 18000 * 0.9,
    eleven_turbo_v2_5: 18000 * 0.9,
    eleven_turbo_v2: 18000 * 0.9,
    eleven_flash_v2_5: 9000 * 0.9,
    eleven_v3: 18000 * 0.9,
};
