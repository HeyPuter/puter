
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
    "gemini:gemini-2.0-flash:promptTokenCount": 10,
    "gemini:gemini-2.0-flash:candidatesTokenCount": 40,
    "gemini:gemini-1.5-flash:promptTokenCount": 3,
    "gemini:gemini-1.5-flash:candidatesTokenCount": 2,
    "gemini:gemini-2.5-flash-image-preview:1024x1024": 3_900_000
}
