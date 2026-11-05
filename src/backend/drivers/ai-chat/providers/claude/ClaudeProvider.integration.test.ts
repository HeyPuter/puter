/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Integration test for the Claude provider.
 *
 * Hits the real Anthropic API with tiny prompts against the cheapest models
 * (Haiku, and Sonnet/Opus 5.5 only where the feature under test requires a
 * model that supports it) so the smoke checks run fast and don't accumulate
 * cost. Skipped automatically when `PUTER_TEST_AI_CLAUDE_API_KEY` is not set;
 * in CI, only triggered when the Claude provider source actually changes (see
 * `.github/workflows/ai-provider-integration-tests.yaml`).
 *
 * The phase-4 additions below exercise request/response fidelity end to end
 * against the live API — not mocks — for exactly the behaviors the design's
 * fidelity claims depend on: an unmodified Claude-Code-shaped system array,
 * context_management + adaptive thinking, safeguards, web_search metering,
 * and fast-mode metering.
 */

import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    optionalEnv,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { AIChatStream } from '../../utils/Streaming.js';
import { ClaudeProvider } from './ClaudeProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_CLAUDE_API_KEY';

/** A metering stub that records every `utilRecordUsageObject` call instead of no-op'ing it. */
const makeRecordingMeteringStub = () => {
    const stub = makeMeteringStub();
    const calls: Array<{
        usage: Record<string, number>;
        modelKey: string;
        costs: Record<string, number>;
    }> = [];
    (stub as unknown as { utilRecordUsageObject: unknown }).utilRecordUsageObject =
        vi.fn(
            async (
                usage: Record<string, number>,
                _actor: unknown,
                modelKey: string,
                costs: Record<string, number>,
            ) => {
                calls.push({ usage, modelKey, costs });
                return [];
            },
        );
    return { metering: stub, calls };
};

/** Captures the NDJSON chunks a streaming `init_chat_stream` populator writes. */
const makeCapturingChatStream = (opts: { streamToolInput?: boolean } = {}) => {
    const chunks: string[] = [];
    const sink = new Writable({
        write(chunk, _enc, cb) {
            chunks.push(chunk.toString('utf8'));
            cb();
        },
    });
    const chatStream = new AIChatStream({ stream: sink, ...opts });
    return {
        chatStream,
        events: () =>
            chunks
                .join('')
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line) as Record<string, unknown>),
    };
};

describe.skipIf(skipUnlessEnv(ENV_VAR))('ClaudeProvider (integration)', () => {
    const buildProvider = (metering: MeteringService = makeMeteringStub()) =>
        new ClaudeProvider(
            metering,
            // Stores / FS only consulted for `puter_path` uploads — none of
            // these tests reach those code paths.
            { fsEntry: undefined as never, s3Object: undefined as never },
            undefined as never,
            { apiKey: optionalEnv(ENV_VAR)! },
        );

    it('returns a non-empty completion from claude-haiku-4-5', { timeout: INTEGRATION_TEST_TIMEOUT_MS }, async () => {
        const provider = buildProvider();
        const result = await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [{ role: 'user', content: 'Say hi in one word.' }],
                max_tokens: 16,
            }),
        );

        expect(result).toHaveProperty('message');
        const content = (result as { message: { content: unknown } }).message
            .content as Array<{ type: string; text?: string }>;
        expect(Array.isArray(content)).toBe(true);
        const text = content.find((c) => c.type === 'text')?.text ?? '';
        expect(text.length).toBeGreaterThan(0);
    });

    it(
        'returns a non-empty completion from claude-haiku-5-5',
        { timeout: INTEGRATION_TEST_TIMEOUT_MS },
        async () => {
            const provider = buildProvider();
            const result = await withTestActor(() =>
                provider.complete({
                    model: 'claude-haiku-5-5',
                    messages: [{ role: 'user', content: 'Say hi in one word.' }],
                    thinking: { type: 'disabled' },
                    reasoning_effort: 'low',
                    max_tokens: 64,
                }),
            );
            const content = (
                result as {
                    message: { content: Array<{ type: string; text?: string }> };
                }
            ).message.content;
            expect(
                content.find((block) => block.type === 'text')?.text?.length,
            ).toBeGreaterThan(0);
        },
    );

    // (a) Claude Code-shaped system blocks, attribution header first — the
    // pipeline must never merge or reorder system blocks: the header is
    // only recognized by Anthropic when it is the sole content of an
    // isolated, first block (verified live during design; see
    // `anthropicWire.ts`'s `systemToMessages`).
    it('sends a Claude-Code-shaped system array unchanged — the model sees the block after the attribution header', { timeout: INTEGRATION_TEST_TIMEOUT_MS }, async () => {
        const provider = buildProvider();
        const header =
            'x-anthropic-billing-header: cc_version=2.1.289; cc_entrypoint=cli;';
        const result = await withTestActor(() =>
            provider.complete({
                model: 'claude-haiku-4-5-20251001',
                messages: [
                    {
                        role: 'system',
                        content: [
                            { type: 'text', text: header },
                            {
                                type: 'text',
                                text: 'The secret word is PINEAPPLE-42. When asked for the secret word, reply with exactly the secret word and nothing else.',
                            },
                        ],
                    },
                    {
                        role: 'user',
                        content:
                            'What is the secret word? If you were not given one, reply exactly UNKNOWN.',
                    },
                ],
                max_tokens: 20,
            }),
        );
        const content = (result as { message: { content: unknown } }).message
            .content as Array<{ type: string; text?: string }>;
        const text = content.find((c) => c.type === 'text')?.text ?? '';
        expect(text).toContain('PINEAPPLE-42');
    });

    // (b) context_management clear_thinking + adaptive thinking.
    it('accepts clear_thinking_20251015 + adaptive thinking on sonnet-5-5', { timeout: INTEGRATION_TEST_TIMEOUT_MS }, async () => {
        const provider = buildProvider();
        const result = await withTestActor(() =>
            provider.complete({
                model: 'claude-sonnet-5-5',
                messages: [{ role: 'user', content: 'Say hi in one word.' }],
                max_tokens: 64,
                thinking: { type: 'adaptive' },
                context_management: {
                    edits: [{ type: 'clear_thinking_20251015' }],
                },
            }),
        );
        expect(result).toHaveProperty('message');
        expect(
            (result as { usageDetails?: unknown }).usageDetails,
        ).toBeTruthy();
    });

    // (c) safeguards round trip keyed by tool_use id.
    it('streams a safeguard_results chunk keyed by the real tool_use id', { timeout: INTEGRATION_TEST_TIMEOUT_MS }, async () => {
        const provider = buildProvider();
        const harness = makeCapturingChatStream({ streamToolInput: true });
        const result = await withTestActor(() =>
            provider.complete({
                model: 'claude-sonnet-5-5',
                stream: true,
                messages: [
                    {
                        role: 'user',
                        content: 'Run `ls -la` in the current directory with the Bash tool.',
                    },
                ],
                max_tokens: 300,
                streamToolInput: true,
                tools: [
                    {
                        type: 'function',
                        function: {
                            name: 'Bash',
                            description: 'Run a shell command',
                            parameters: {
                                type: 'object',
                                properties: { command: { type: 'string' } },
                                required: ['command'],
                            },
                        },
                    },
                ],
                safeguards: [
                    { type: 'dangerous_tool_use', classifier_context: {} },
                ],
            }),
        );
        await (
            result as { init_chat_stream: (p: { chatStream: unknown }) => Promise<void> }
        ).init_chat_stream({ chatStream: harness.chatStream });

        const events = harness.events();
        const toolUse = events.find((e) => e.type === 'tool_use');
        const safeguardResults = events.find(
            (e) => e.type === 'safeguard_results',
        );
        expect(toolUse).toBeTruthy();
        expect(safeguardResults).toBeTruthy();
        const results = safeguardResults!.results as Array<{
            status?: Record<string, unknown>;
        }>;
        const toolUseIds = results.flatMap((r) =>
            Object.keys(r.status?.tool_uses ?? {}),
        );
        expect(toolUseIds).toContain(toolUse!.id);
    });

    // (d) web_search max_uses:1, metered at 1,000,000 µ¢ for one search.
    it('meters one web_search use at 1,000,000 µ¢', { timeout: INTEGRATION_TEST_TIMEOUT_MS }, async () => {
        const { metering, calls } = makeRecordingMeteringStub();
        const provider = buildProvider(metering);
        const result = await withTestActor(() =>
            provider.complete({
                model: 'claude-sonnet-5-5',
                messages: [
                    {
                        role: 'user',
                        content:
                            'Use the web_search tool once to find today’s date, then reply with one word.',
                    },
                ],
                max_tokens: 300,
                tools: [{ type: 'web_search_20250305', max_uses: 1 }],
            }),
        );

        const usageDetails = (result as { usageDetails?: { webSearchRequests?: number } })
            .usageDetails;
        expect(usageDetails?.webSearchRequests).toBeGreaterThanOrEqual(1);

        const executorCall = calls.find((c) =>
            c.modelKey.startsWith('claude:'),
        );
        expect(executorCall?.usage.web_search_requests).toBeGreaterThanOrEqual(1);
        // $10/1k requests == 1,000,000 µ¢ per request.
        expect(executorCall?.costs.web_search_requests).toBe(
            (executorCall?.usage.web_search_requests ?? 0) * 1_000_000,
        );
    });

    // (e) opus-5-5 speed:'fast' — usageDetails.speed and fast keys metered.
    it('reports usageDetails.speed "fast" and meters fast_* keys on opus-5-5', { timeout: INTEGRATION_TEST_TIMEOUT_MS }, async () => {
        const { metering, calls } = makeRecordingMeteringStub();
        const provider = buildProvider(metering);
        const result = await withTestActor(() =>
            provider.complete({
                model: 'claude-opus-5-5',
                messages: [{ role: 'user', content: 'Say hi in one word.' }],
                max_tokens: 16,
                speed: 'fast',
            }),
        );

        const usageDetails = (result as { usageDetails?: { speed?: string } })
            .usageDetails;
        expect(usageDetails?.speed).toBe('fast');

        const executorCall = calls.find((c) =>
            c.modelKey.startsWith('claude:'),
        );
        expect(executorCall?.usage).toHaveProperty('fast_output_tokens');
        expect(executorCall?.costs.fast_output_tokens).toBeGreaterThan(0);
    });
});
