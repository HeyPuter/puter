
// TODO DS: these should be loaded from config or db eventually
/** 
 * flat cost map based on usage types, numbers are in microcents (1/1 millionth of a cent)
 * E.g. 1000000 microcents = 1 cent
 * most services measure their prices in 1 million requests or tokens or whatever, so if that's the case you can simply use the cent val
 * $0.63 per 1M reads = 63 microcents per read
 * $1.25 per 1M writes = 125 microcents per write
 */
export const USAGE_TYPE_MAPS = {
    // Map with unit to cost measurements in microcent
    'kv:read': 63,
    'kv:write': 125,

    // OpenAI api usage types (costs per token in microcents)
    // Source: OpenAICompletionService.js models_() pricing (usd-cents per 1M tokens × 1000 = microcents per token)
    'openai:gpt-5:input': 125,
    'openai:gpt-5:output': 1000,
    'openai:gpt-5-mini:input': 25,
    'openai:gpt-5-mini:output': 200,
    'openai:gpt-5-nano:input': 5,
    'openai:gpt-5-nano:output': 40,
    'openai:gpt-5-chat-latest:input': 125,
    'openai:gpt-5-chat-latest:output': 1000,
    'openai:gpt-4o:input': 250,
    'openai:gpt-4o:output': 1000,
    'openai:gpt-4o-mini:input': 15,
    'openai:gpt-4o-mini:output': 60,
    'openai:o1:input': 1500,
    'openai:o1:output': 6000,
    'openai:o1-mini:input': 300,
    'openai:o1-mini:output': 1200,
    'openai:o1-pro:input': 15000,
    'openai:o1-pro:output': 60000,
    'openai:o3:input': 1000,
    'openai:o3:output': 4000,
    'openai:o3-mini:input': 110,
    'openai:o3-mini:output': 440,
    'openai:o4-mini:input': 110,
    'openai:o4-mini:output': 440,
    'openai:gpt-4.1:input': 200,
    'openai:gpt-4.1:output': 800,
    'openai:gpt-4.1-mini:input': 40,
    'openai:gpt-4.1-mini:output': 160,
    'openai:gpt-4.1-nano:input': 10,
    'openai:gpt-4.1-nano:output': 40,
    'openai:gpt-4.5-preview:input': 7500,
    'openai:gpt-4.5-preview:output': 15000,
}
