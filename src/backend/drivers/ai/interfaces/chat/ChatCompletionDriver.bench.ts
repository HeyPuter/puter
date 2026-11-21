import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe } from 'vitest';
import { useBenchEnv } from '../../../../benchUtil.js';
import type { IConfig } from '../../../../types.js';

const usage = { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 };

const chunk = (fields: object) =>
    `data: ${JSON.stringify({
        id: 'chatcmpl_bench',
        object: 'chat.completion.chunk',
        ...fields,
    })}\n\n`;

// Stands in for the vendor, so the gates, the credit hold and the usage
// record are the real ones.
const upstream = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (part: string) => {
        body += part;
    });
    req.once('end', () => {
        if (!(JSON.parse(body) as { stream?: boolean }).stream) {
            res.setHeader('Content-Type', 'application/json');
            res.end(
                JSON.stringify({
                    id: 'chatcmpl_bench',
                    object: 'chat.completion',
                    created: 0,
                    model: 'deepseek-flash',
                    choices: [
                        {
                            index: 0,
                            message: { role: 'assistant', content: 'done' },
                            finish_reason: 'stop',
                        },
                    ],
                    usage,
                }),
            );
            return;
        }
        res.setHeader('Content-Type', 'text/event-stream');
        res.end(
            chunk({
                choices: [
                    {
                        index: 0,
                        delta: { content: 'done' },
                        finish_reason: 'stop',
                    },
                ],
            }) +
                chunk({ choices: [], usage }) +
                'data: [DONE]\n\n',
        );
    });
});
await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
// Bench mode runs no `afterAll`; the listener must not hold the process open.
upstream.unref();
const upstreamOrigin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

describe('chat', () => {
    const env = useBenchEnv({
        config: {
            providers: {
                deepseek: { apiKey: 'bench', apiBaseUrl: upstreamOrigin },
            },
            // The OpenAI route asks for a paid plan, and the test users
            // have none.
            meteringEnforcement: { subscriptions: false },
        } as IConfig,
        // The hold store registers its Redis scripts on first use. Done
        // here, they exist before the harness starts counting commands.
        seed: async (env) => {
            await complete(false);
            const other = await env.server.stores.user.getByUsername(
                env.users.other.username,
            );
            await env.server.services.metering.updateAddonCredit(
                other!.uuid,
                1_000_000_000,
            );
        },
    });

    const args = (stream: boolean) => ({
        model: 'deepseek-flash',
        provider: 'deepseek',
        stream,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 16,
    });

    const complete = (stream: boolean, token?: string) =>
        env.request('/drivers/call', {
            json: {
                interface: 'puter-chat-completion',
                method: 'complete',
                args: args(stream),
            },
            token,
        });

    // A stream that fails still answers 200, with an error line.
    const expectUsageLine = async (response: Response) => {
        const lines = (await response.text()).trim().split('\n');
        const last = JSON.parse(lines.at(-1) ?? '{}') as { type?: string };
        if (last.type !== 'usage') {
            throw new Error(`stream ended with ${lines.at(-1)}`);
        }
    };

    env.scenario('stream a chat completion', async () => {
        await expectUsageLine(await complete(true));
    });

    env.scenario('stream a chat completion with purchased credit', async () => {
        await expectUsageLine(await complete(true, env.users.other.token));
    });

    env.scenario('complete a chat without streaming', async () => {
        await complete(false, env.users.other.token);
    });

    env.scenario(
        'stream a chat completion through the OpenAI route',
        async () => {
            const response = await env.request(
                '/puterai/openai/v1/chat/completions',
                // This route refuses a bare session token.
                { json: args(true), token: env.users.user.apiToken },
            );
            const frames = (await response.text())
                .trim()
                .split('\n\n')
                .map((frame) => frame.replace(/^data: /, ''));
            // A stream that fails sends an error frame, then `[DONE]`.
            const failed = frames
                .slice(0, -1)
                .some((frame) => 'error' in (JSON.parse(frame) as object));
            if (frames.at(-1) !== '[DONE]' || failed) {
                throw new Error(`stream ended with ${frames.slice(-2)}`);
            }
        },
    );
});
