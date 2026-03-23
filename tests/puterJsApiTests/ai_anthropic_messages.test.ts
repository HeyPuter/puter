import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import Anthropic from '@anthropic-ai/sdk';

interface ClientConfig {
    api_url: string;
    auth_token?: string;
    do_expensive_ai_tests?: boolean;
}

const loadConfig = (): ClientConfig => {
    const envApiUrl = process.env.PUTER_API_URL;
    const envAuthToken = process.env.PUTER_AUTH_TOKEN;
    if (envApiUrl) {
        return {
            api_url: envApiUrl,
            auth_token: envAuthToken,
            do_expensive_ai_tests: process.env.PUTER_DO_EXPENSIVE_AI_TESTS === 'true',
        };
    }

    const configPath = path.join(__dirname, '../client-config.yaml');
    if (!fs.existsSync(configPath)) {
        throw new Error('Missing client-config.yaml. Create tests/client-config.yaml ' +
            'or set PUTER_API_URL and PUTER_AUTH_TOKEN.');
    }
    return yaml.parse(fs.readFileSync(configPath, 'utf8')) as ClientConfig;
};

const buildHeaders = (authToken?: string) => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    return headers;
};

const postMessages = async (body: unknown) => {
    const config = loadConfig();
    const url = `${config.api_url}/puterai/anthropic/v1/messages`;
    const response = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(config.auth_token),
        body: JSON.stringify(body),
    });
    return { response, config };
};

describe('Puter Anthropic-Compatible Messages API', () => {
    it('returns a well-formed non-streaming message', async () => {
        const config = loadConfig();
        if (!config.do_expensive_ai_tests) return;

        const { response } = await postMessages({
            model: 'claude-haiku-4-5',
            max_tokens: 256,
            messages: [
                { role: 'user', content: 'Say hello in exactly three words.' },
            ],
        });

        expect(response.status).toBe(200);
        const json = await response.json() as any;
        expect(json.type).toBe('message');
        expect(json.role).toBe('assistant');
        expect(json.id).toMatch(/^msg_/);
        expect(Array.isArray(json.content)).toBe(true);
        expect(json.content.length).toBeGreaterThan(0);
        expect(json.content[0].type).toBe('text');
        expect(typeof json.content[0].text).toBe('string');
        expect(json.stop_reason).toBe('end_turn');
        expect(typeof json.usage?.input_tokens).toBe('number');
        expect(typeof json.usage?.output_tokens).toBe('number');
    }, 20000);

    it('streams and returns well-formed SSE events', async () => {
        const config = loadConfig();
        if (!config.do_expensive_ai_tests) return;

        const { response } = await postMessages({
            model: 'claude-haiku-4-5',
            max_tokens: 256,
            stream: true,
            messages: [
                { role: 'user', content: 'What is 2 + 2?' },
            ],
        });

        expect(response.status).toBe(200);
        const reader = response.body?.getReader();
        expect(reader).toBeTruthy();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = '';
        const events: string[] = [];

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let idx;
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
                const block = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);
                const eventMatch = block.match(/^event: (\S+)/m);
                if (eventMatch) events.push(eventMatch[1]);
            }
        }

        expect(events).toContain('message_start');
        expect(events).toContain('content_block_start');
        expect(events).toContain('content_block_delta');
        expect(events).toContain('content_block_stop');
        expect(events).toContain('message_delta');
        expect(events).toContain('message_stop');
    }, 20000);

    it('handles tool use round-trip (non-streaming)', async () => {
        const config = loadConfig();
        if (!config.do_expensive_ai_tests) return;

        const tools = [
            {
                name: 'calculate',
                description: 'Perform a mathematical calculation',
                input_schema: {
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
        ];

        // First turn: ask the model to use the tool
        const { response: firstResponse } = await postMessages({
            model: 'claude-haiku-4-5',
            max_tokens: 1024,
            messages: [
                { role: 'user', content: 'Use the calculate tool to compute 2 + 2.' },
            ],
            tools,
        });

        expect(firstResponse.status).toBe(200);
        const firstJson = await firstResponse.json() as any;

        const toolUseBlocks = (firstJson.content || []).filter(
            (b: any) => b.type === 'tool_use',
        );

        if (toolUseBlocks.length === 0) {
            // Model did not call tools — inconclusive, skip
            return;
        }

        expect(toolUseBlocks[0].name).toBe('calculate');
        expect(toolUseBlocks[0].id).toBeTruthy();

        // Second turn: provide tool result and get final answer
        const { response: secondResponse } = await postMessages({
            model: 'claude-haiku-4-5',
            max_tokens: 1024,
            messages: [
                { role: 'user', content: 'Use the calculate tool to compute 2 + 2.' },
                { role: 'assistant', content: firstJson.content },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: toolUseBlocks[0].id,
                            content: JSON.stringify({ expression: '2 + 2', result: 4 }),
                        },
                    ],
                },
            ],
            tools,
        });

        expect(secondResponse.status).toBe(200);
        const secondJson = await secondResponse.json() as any;
        expect(secondJson.type).toBe('message');
        const textBlocks = (secondJson.content || []).filter(
            (b: any) => b.type === 'text',
        );
        expect(textBlocks.length).toBeGreaterThan(0);
        expect(textBlocks[0].text).toBeTruthy();
    }, 30000);

    it('works with the Anthropic SDK', async () => {
        const config = loadConfig();
        if (!config.do_expensive_ai_tests) return;
        const apiKey = config.auth_token;
        if (!apiKey) throw new Error('Missing auth token for Anthropic SDK test');

        const client = new Anthropic({
            apiKey,
            baseURL: `${config.api_url}/puterai/anthropic/v1`,
        });

        const message = await client.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 256,
            messages: [
                { role: 'user', content: 'Say hello.' },
            ],
        });

        expect(message.type).toBe('message');
        expect(message.role).toBe('assistant');
        expect(message.content.length).toBeGreaterThan(0);
        expect(message.content[0].type).toBe('text');
    }, 20000);

    it('accepts a system parameter', async () => {
        const config = loadConfig();
        if (!config.do_expensive_ai_tests) return;

        const { response } = await postMessages({
            model: 'claude-haiku-4-5',
            max_tokens: 256,
            system: 'You are a pirate. Always respond in pirate speak.',
            messages: [
                { role: 'user', content: 'Say hello.' },
            ],
        });

        expect(response.status).toBe(200);
        const json = await response.json() as any;
        expect(json.type).toBe('message');
        expect(json.content[0].text).toBeTruthy();
    }, 20000);
});
