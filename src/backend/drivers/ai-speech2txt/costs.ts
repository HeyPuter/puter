// Microcents per second of audio, per OpenAI transcription model.
export const SPEECH_TO_TEXT_COSTS: Record<string, number> = {
    'openai:gpt-4o-transcribe:second': 10000,
    'openai:gpt-4o-mini-transcribe:second': 5000,
    'openai:gpt-4o-transcribe-diarize:second': 10000,
    'openai:whisper-1:second': 10000,
};
