
// TODO DS: these should be loaded from config or db eventually
/**
 * flat cost map based on usage types, numbers are in microcents (1/1 millionth of a cent)
 * E.g. 1000000 microcents = 1 cent
 * most services measure their prices in 1 million requests or tokens or whatever, so if that's the case you can simply use the cent val
 * $0.63 per 1M reads = 63 microcents per read
 * $1.25 per 1M writes = 125 microcents per write
 */
export const GEMINI_COST_MAP = {
    // Gemini api usage types (costs per token in microcents)
    'gemini:gemini-1.5-flash:promptTokenCount': 7.5,
    'gemini:gemini-1.5-flash:candidatesTokenCount': 30,
    'gemini:gemini-2.0-flash:promptTokenCount': 10,
    'gemini:gemini-2.0-flash:candidatesTokenCount': 40,
    'gemini:gemini-2.0-flash-lite:promptTokenCount': 8,
    'gemini:gemini-2.0-flash-lite:candidatesTokenCount': 32,
    'gemini:gemini-2.5-flash:promptTokenCount': 12,
    'gemini:gemini-2.5-flash:candidatesTokenCount': 48,
    'gemini:gemini-2.5-flash-lite:promptTokenCount': 10,
    'gemini:gemini-2.5-flash-lite:candidatesTokenCount': 40,
    'gemini:gemini-2.5-pro:promptTokenCount': 15,
    'gemini:gemini-2.5-pro:candidatesTokenCount': 60,
    'gemini:gemini-3-pro-preview:promptTokenCount': 25,
    'gemini:gemini-3-pro-preview:candidatesTokenCount': 100,
    'gemini:gemini-2.5-flash-image-preview:1024x1024': 3_900_000,
    'gemini:gemini-3-pro-image-preview:1024x1024': 15_600_000
};
