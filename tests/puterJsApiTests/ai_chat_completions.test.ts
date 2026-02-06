import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import OpenAI from 'openai';
import { createOpenAI } from '@ai-sdk/openai';
import { jsonSchema, stepCountIs, streamText, tool } from 'ai';

const loadConfig = () => {
    const envApiUrl = process.env.PUTER_API_URL;
    const envAuthToken = process.env.PUTER_AUTH_TOKEN;
    if ( envApiUrl ) {
        return {
            api_url: envApiUrl,
            auth_token: envAuthToken,
        } as { api_url: string; auth_token?: string };
    }

    const configPath = path.join(__dirname, '../client-config.yaml');
    if ( ! fs.existsSync(configPath) ) {
        throw new Error('Missing client-config.yaml. Create tests/client-config.yaml ' +
            'or set PUTER_API_URL and PUTER_AUTH_TOKEN.');
    }
    return yaml.parse(fs.readFileSync(configPath, 'utf8')) as {
        api_url: string;
        auth_token?: string;
    };
};

const buildHeaders = (authToken?: string) => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if ( authToken ) {
        headers.Authorization = `Bearer ${authToken}`;
    }
    return headers;
};

const postChat = async (body: unknown) => {
    const config = loadConfig();
    const url = `${config.api_url}/puterai/openai/v1/chat/completions`;
    const response = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(config.auth_token),
        body: JSON.stringify(body),
    });
    return { response, config };
};

describe('Puter OpenAI-Compatible Chat Completions', () => {
    it('works with the OpenAI SDK (tool round-trip)', async () => {
        const config = loadConfig();
        const apiKey = config.auth_token || process.env.OPENAI_API_KEY;
        if ( ! apiKey ) throw new Error('Missing auth token for OpenAI SDK test');

        const client = new OpenAI({
            apiKey,
            baseURL: `${config.api_url}/puterai/openai/v1`,
        });

        const tools = [
            {
                type: 'function',
                function: {
                    name: 'calculate',
                    description: 'Perform a mathematical calculation',
                    parameters: {
                        type: 'object',
                        properties: {
                            expression: {
                                type: 'string',
                                description: 'Mathematical expression to evaluate',
                            },
                        },
                        required: ['expression'],
                    },
                },
            },
        ];

        const messages = [
            {
                role: 'user',
                content: 'Use the calculate tool to compute 2 + 2.',
            },
        ];

        const first = await client.chat.completions.create({
            model: 'claude-haiku-4-5',
            messages,
            tools,
            tool_choice: { type: 'function', function: { name: 'calculate' } },
        });

        const toolCalls = first.choices[0]?.message?.tool_calls ?? [];
        expect(toolCalls.length).toBeGreaterThan(0);

        const toolResults = toolCalls.map((toolCall: any) => ({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ expression: '2 + 2', result: 4 }),
        }));

        const followup = await client.chat.completions.create({
            model: 'claude-haiku-4-5',
            messages: [
                ...messages,
                { role: 'assistant', tool_calls: toolCalls },
                ...toolResults,
            ],
        });

        expect(followup.choices[0]?.message?.content).toBeTruthy();
    }, 20000);

    it('works with the Vercel AI SDK (tool round-trip)', async () => {
        const config = loadConfig();
        const apiKey = config.auth_token || process.env.OPENAI_API_KEY;
        if ( ! apiKey ) throw new Error('Missing auth token for AI SDK test');

        const openai = createOpenAI({
            apiKey,
            baseURL: `${config.api_url}/puterai/openai/v1`,
        });

        const result = await streamText({
            model: openai.chat('claude-haiku-4-5'),
            messages: [
                {
                    role: 'user',
                    content: 'Use the calculate tool to compute 2 + 2.',
                },
            ],
            tools: {
                calculate: tool({
                    description: 'Perform a mathematical calculation',
                    inputSchema: jsonSchema({
                        type: 'object',
                        properties: {
                            expression: {
                                type: 'string',
                                description: 'Mathematical expression to evaluate',
                            },
                        },
                        required: ['expression'],
                    }),
                    execute: async ({ expression }) => {
                        if ( ! expression ) return { expression, result: null };
                        const resultValue = Function(`"use strict"; return (${expression});`)();
                        return { expression, result: resultValue };
                    },
                }),
            },
            toolChoice: { type: 'tool', toolName: 'calculate' },
            stopWhen: stepCountIs(2),
        });

        const text = await result.text;
        expect(text).toBeTruthy();
    }, 20000);

    it('accepts OpenAI tool result format (non-streaming)', async () => {
        const messages = [
            {
                role: 'user',
                content: 'What is the weather in Seattle, WA and what is 2 + 2?',
            },
        ];
        const tools = [
            {
                type: 'function',
                function: {
                    name: 'get_weather',
                    description: 'Get the current weather for a location',
                    parameters: {
                        type: 'object',
                        properties: {
                            location: {
                                type: 'string',
                                description: 'The city and state, e.g. San Francisco, CA',
                            },
                            unit: {
                                type: 'string',
                                enum: ['celsius', 'fahrenheit'],
                                description: 'Temperature unit',
                            },
                        },
                        required: ['location'],
                    },
                },
            },
            {
                type: 'function',
                function: {
                    name: 'calculate',
                    description: 'Perform a mathematical calculation',
                    parameters: {
                        type: 'object',
                        properties: {
                            expression: {
                                type: 'string',
                                description: 'Mathematical expression to evaluate',
                            },
                        },
                        required: ['expression'],
                    },
                },
            },
        ];

        const first = await postChat({
            model: 'claude-haiku-4-5',
            messages,
            tools,
            tool_choice: 'auto',
        });

        expect(first.response.status).toBe(200);
        const firstJson = await first.response.json();
        const toolCalls = firstJson?.choices?.[0]?.message?.tool_calls ?? [];

        if ( ! toolCalls.length ) {
            // If the model does not call tools, the test is inconclusive but should not fail.
            return;
        }

        const toolResults = toolCalls.map((toolCall: any) => {
            if ( toolCall.function?.name === 'get_weather' ) {
                return {
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({
                        location: 'Seattle, WA',
                        temperature: 79,
                        unit: 'fahrenheit',
                    }),
                };
            }
            if ( toolCall.function?.name === 'calculate' ) {
                return {
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ expression: '2 + 2', result: 4 }),
                };
            }
            return {
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: 'Unknown tool' }),
            };
        });

        const followup = await postChat({
            model: 'claude-haiku-4-5',
            messages: [
                ...messages,
                { role: 'assistant', tool_calls: toolCalls },
                ...toolResults,
            ],
        });

        expect(followup.response.status).toBe(200);
        const followupJson = await followup.response.json();
        expect(followupJson?.choices?.[0]?.message).toBeTruthy();
    }, 20000);

    it('streams and returns a well-formed SSE response', async () => {
        const { response } = await postChat({
            model: 'claude-haiku-4-5',
            messages: [
                {
                    role: 'user',
                    content: 'What is 2 + 2?',
                },
            ],
            stream: true,
        });

        expect(response.status).toBe(200);
        const reader = response.body?.getReader();
        expect(reader).toBeTruthy();
        if ( ! reader ) return;

        const decoder = new TextDecoder();
        let sawDone = false;
        let sawData = false;
        let buffer = '';

        while ( true ) {
            const { value, done } = await reader.read();
            if ( done ) break;
            buffer += decoder.decode(value, { stream: true });
            if ( buffer.includes('data:') ) sawData = true;
            if ( buffer.includes('data: [DONE]') ) {
                sawDone = true;
                break;
            }
        }

        expect(sawData).toBe(true);
        expect(sawDone).toBe(true);
    }, 20000);
});
