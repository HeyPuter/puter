import type { BuiltInTool, ChatOptions, Tool } from '../../index.js';

const getWeather = {
    type: 'function',
    function: {
        name: 'get_weather',
        description: 'Get the current weather for a city.',
        parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
        },
    },
};
const registry: Tool[] = [getWeather];

export const webSearch: ChatOptions = {
    model: 'openai/gpt-6-luna',
    tools: [{ type: 'web_search' }],
};
export const builtIn: BuiltInTool = { type: 'web_search' };
export const functionTool: ChatOptions = { tools: [getWeather] };
export const fromRegistry: ChatOptions = { tools: registry };
export const mixed: ChatOptions = {
    tools: [getWeather, { type: 'web_search' }],
};
// A `Tool` is always a function tool, so its definition reads without narrowing.
export const names = (tools: Tool[]): string[] =>
    tools.map((tool) => tool.function.name);
// @ts-expect-error A function tool needs its `function` definition.
export const missingFunction: ChatOptions = { tools: [{ type: 'function' }] };
// @ts-expect-error Not a built-in tool.
export const unknownBuiltIn: ChatOptions = { tools: [{ type: 'web_serch' }] };
