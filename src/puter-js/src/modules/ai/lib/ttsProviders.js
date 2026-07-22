// TTS provider aliases and their backend driver names, shared by
// txt2speech and its listEngines/listVoices companions.

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export const normalizeTTSProvider = (value) => {
    if ( typeof value !== 'string' ) {
        return null;
    }
    const lower = value.toLowerCase();
    if ( lower === 'openai' ) return 'openai';
    if ( ['elevenlabs', 'eleven', '11labs', '11-labs', 'eleven-labs', 'elevenlabs-tts'].includes(lower) ) return 'elevenlabs';
    if ( ['gemini', 'google', 'gemini-tts', 'google-tts'].includes(lower) ) return 'gemini';
    if ( ['xai', 'grok', 'x-ai', 'xai-tts', 'grok-tts'].includes(lower) ) return 'xai';
    if ( lower === 'aws' || lower === 'polly' || lower === 'aws-polly' ) return 'aws-polly';
    return value;
};

const TTS_DRIVER_NAMES = {
    'openai': 'openai-tts',
    'elevenlabs': 'elevenlabs-tts',
    'gemini': 'gemini-tts',
    'xai': 'xai-tts',
};

/**
 * @param {string | null} provider
 * @returns {string}
 */
export const ttsDriverName = (provider) =>
    (provider && TTS_DRIVER_NAMES[provider]) || 'aws-polly';
