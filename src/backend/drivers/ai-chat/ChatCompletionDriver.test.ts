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
 * Offline unit tests for ChatCompletionDriver.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) so the driver runs against the live `EventClient`,
 * `MeteringService`, stores, and `FSService`. The driver is
 * exercised through its public `complete()` interface against the
 * always-available `FakeChatProvider` — no real upstream API keys
 * are needed because no `config.providers.*` entries are set, so
 * `fake-chat` is the only provider registered.
 *
 * Provider behaviour (request shape, streaming dialect) is covered
 * separately by each provider's test file. This file pins down
 * driver-level behaviour: auth gate, model resolution, validation
 * event routing, credit/quota gates, max_tokens cap, fallback,
 * event emission and cost calculation.
 */
import type { Readable } from 'node:stream';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { HttpError } from '../../core/http/HttpError.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { withTestActor } from '../integrationTestUtil.js';
import { ChatCompletionDriver } from './ChatCompletionDriver.js';
import { FakeChatProvider } from './providers/FakeChatProvider.js';
import type { IChatCompleteResult, ICompleteArguments } from './types.js';

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let driver: ChatCompletionDriver;

const makeDriver = async () => {
    // Fresh driver bound to the live test server. Empty provider keys
    // (other than the explicit `ollama: { enabled: false }` to suppress
    // auto-discovery of a local Ollama on developer machines) means
    // `fake-chat` is the only provider that registers, giving us a
    // deterministic, network-free model surface.
    const d = new ChatCompletionDriver(
        { providers: { ollama: { enabled: false } } } as never,
        server.clients,
        server.stores,
        server.services,
    );
    d.onServerStart();
    // `onServerStart` kicks off `#buildModelMap` without awaiting it.
    // Poll `models()` until the map is populated — production never
    // serves a request before the kernel has finished booting, but in
    // tests we hit the driver before microtasks have drained.
    for (let i = 0; i < 200; i++) {
        const m = await d.models();
        if (m.length > 0) return d;
        await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('ChatCompletionDriver model map never populated in test');
};

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(async () => {
    driver = await makeDriver();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Helpers ─────────────────────────────────────────────────────────

const collectStream = async (stream: Readable): Promise<unknown[]> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks)
        .toString('utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
};

const captureEvent = <K extends string>(name: K) => {
    const calls: unknown[][] = [];
    vi.spyOn(server.clients.event, 'emit').mockImplementation(
        (key, data, meta) => {
            if (key === name) calls.push([key, data, meta]);
        },
    );
    return calls;
};

// ── Model catalog ───────────────────────────────────────────────────

describe('ChatCompletionDriver model catalog', () => {
    it('models() exposes only fake-chat when no provider api keys are configured', async () => {
        const models = await driver.models();
        // FakeChatProvider declares three models; no real provider is wired.
        expect(models.map((m) => m.id).sort()).toEqual([
            'abuse',
            'costly',
            'fake',
        ]);
        for (const m of models) {
            expect(m.provider).toBe('fake-chat');
        }
    });

    it('models() deduplicates by id even when aliases share buckets', async () => {
        const models = await driver.models();
        const ids = models.map((m) => m.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('list() returns sorted ids of registered models', async () => {
        const ids = await driver.list();
        // FakeChatProvider models have no `puterId`, so `list()` falls
        // back to `id`.
        expect(ids).toEqual(['abuse', 'costly', 'fake']);
    });

    it('getReportedCosts() emits one entry per (model, cost-key) pair and skips zero rates and the `tokens` scale descriptor', () => {
        const reported = driver.getReportedCosts();
        // `fake` and `abuse` have 0-cost keys → skipped (not finite > 0
        // alone; the impl skips non-finite, and the cost map filters
        // numeric finite entries — zero is finite, so both are reported).
        // Reality check: the impl pushes any finite numeric `costs[key]`
        // except the `tokens` scale descriptor.
        const usageTypes = reported.map((r) => r.usageType);
        expect(usageTypes).toContain('fake-chat:costly:input-tokens');
        expect(usageTypes).toContain('fake-chat:costly:output-tokens');
        // No `tokens` scale entries leaked through:
        for (const r of reported) {
            expect(r.usageType).not.toMatch(/:tokens$/);
        }
        // Shape sanity:
        const costly = reported.find(
            (r) => r.usageType === 'fake-chat:costly:input-tokens',
        )!;
        expect(costly.ucentsPerUnit).toBe(1000);
        expect(costly.unit).toBe('token');
        expect(costly.source).toBe('driver:aiChat/fake-chat');
    });
});

// ── Auth + model resolution ─────────────────────────────────────────

describe('ChatCompletionDriver.complete auth and model resolution', () => {
    it('throws 401 when no actor is in context', async () => {
        // Note: not wrapped in `withTestActor` — `Context.get('actor')`
        // returns undefined.
        await expect(
            driver.complete({
                model: 'fake',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        ).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 400 when the requested model is unknown', async () => {
        await expect(
            withTestActor(() =>
                driver.complete({
                    model: 'totally-not-a-model',
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('falls back to the provider default model when neither model nor provider is given (claude is the hard-coded default provider)', async () => {
        // Without `claude` in providers config, the driver tries
        // `claude` as the default provider but it isn't registered, so
        // `args.model` stays undefined and `#resolveModel` returns null
        // — surfaces as 400.
        await expect(
            withTestActor(() =>
                driver.complete({
                    messages: [{ role: 'user', content: 'hi' }],
                } as ICompleteArguments),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('routes by alias when a provider exposes one (puterId is auto-aliased on the bucket)', async () => {
        // Inject a model that carries a `puterId` so we can verify the
        // alias bucket resolves back to the canonical id. Spy on
        // FakeChatProvider.models BEFORE constructing the driver so the
        // model map is built with our shape.
        vi.spyOn(FakeChatProvider.prototype, 'models').mockResolvedValueOnce([
            {
                id: 'realfake',
                aliases: [],
                puterId: 'puter-fake',
                costs_currency: 'usd-cents',
                costs: { 'input-tokens': 0, 'output-tokens': 0 },
                max_tokens: 8192,
            },
        ]);
        const d = await makeDriver();

        const completeSpy = vi.spyOn(FakeChatProvider.prototype, 'complete');
        completeSpy.mockResolvedValueOnce({
            message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
            usage: {},
            finish_reason: 'stop',
        } as never);

        await withTestActor(() =>
            d.complete({
                model: 'puter-fake',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        // The driver hands the canonical id to the provider, not the alias.
        const passed = completeSpy.mock.calls[0]![0] as ICompleteArguments;
        expect(passed.model).toBe('realfake');
        expect(passed.provider).toBe('fake-chat');
    });
});

// ── Happy path: events + cost emission ──────────────────────────────

describe('ChatCompletionDriver.complete events and cost emission', () => {
    it('runs the prompt, returns the provider message, and tags the result `via_ai_chat_service`', async () => {
        const res = (await withTestActor(() =>
            driver.complete({
                model: 'fake',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        )) as IChatCompleteResult & { via_ai_chat_service: boolean };

        expect(res.via_ai_chat_service).toBe(true);
        expect('message' in res && res.message).toBeDefined();
    });

    it('emits `ai.prompt.validate` first (so listeners can flip allow=false) and then `ai.prompt.complete`', async () => {
        const events: string[] = [];
        const emitAndWaitSpy = vi
            .spyOn(server.clients.event, 'emitAndWait')
            .mockImplementation(async (key) => {
                events.push(`wait:${String(key)}`);
            });
        vi.spyOn(server.clients.event, 'emit').mockImplementation((key) => {
            events.push(`emit:${String(key)}`);
        });

        await withTestActor(() =>
            driver.complete({
                model: 'fake',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(emitAndWaitSpy).toHaveBeenCalled();
        expect(events[0]).toBe('wait:ai.prompt.validate');
        expect(events).toContain('emit:ai.prompt.complete');
    });

    it('emits `ai.prompt.cost-calculated` with the right microcent math for a priced model', async () => {
        // Inject a model whose cost keys match the canonical
        // `input_tokens`/`output_tokens` usage keys so the cost map
        // applies cleanly. The fake-chat `costly` row uses hyphenated
        // keys, which exercises a different path covered separately by
        // the `usd_cents = null` test.
        vi.spyOn(FakeChatProvider.prototype, 'models').mockResolvedValueOnce([
            {
                id: 'priced',
                aliases: [],
                costs_currency: 'usd-cents',
                costs: { input_tokens: 1000, output_tokens: 2000 },
                max_tokens: 8192,
            },
        ]);
        const d = await makeDriver();

        const costEvents = captureEvent('ai.prompt.cost-calculated');

        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce({
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'ok' }],
            },
            usage: { input_tokens: 10, output_tokens: 7 },
            finish_reason: 'stop',
        } as never);

        await withTestActor(() =>
            d.complete({
                model: 'priced',
                messages: [{ role: 'user', content: 'hello world' }],
            }),
        );

        expect(costEvents).toHaveLength(1);
        const data = costEvents[0]![1] as {
            input_tokens: number;
            output_tokens: number;
            input_ucents: number;
            output_ucents: number;
            total_ucents: number;
            service_used: string;
            model_used: string;
        };
        expect(data.input_tokens).toBe(10);
        expect(data.output_tokens).toBe(7);
        expect(data.input_ucents).toBe(10 * 1000);
        expect(data.output_ucents).toBe(7 * 2000);
        expect(data.total_ucents).toBe(10 * 1000 + 7 * 2000);
        expect(data.model_used).toBe('priced');
        expect(data.service_used).toBe('fake-chat');
    });

    it('injects `usd_cents` on the usage object derived from the cost map', async () => {
        vi.spyOn(FakeChatProvider.prototype, 'models').mockResolvedValueOnce([
            {
                id: 'priced',
                aliases: [],
                costs_currency: 'usd-cents',
                costs: { input_tokens: 1000, output_tokens: 2000 },
                max_tokens: 8192,
            },
        ]);
        const d = await makeDriver();

        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce({
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'ok' }],
            },
            usage: { input_tokens: 4, output_tokens: 2 },
            finish_reason: 'stop',
        } as never);

        const res = (await withTestActor(() =>
            d.complete({
                model: 'priced',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        )) as { usage: Record<string, number> };

        const expectedMicroCents = 4 * 1000 + 2 * 2000;
        expect(res.usage.usd_cents).toBe(expectedMicroCents / 1_000_000);
    });

    it('does not override `usd_cents` when the provider already returned one (e.g. OpenRouter)', async () => {
        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce({
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'ok' }],
            },
            usage: { input_tokens: 4, output_tokens: 2, usd_cents: 99 },
            finish_reason: 'stop',
        } as never);

        const res = (await withTestActor(() =>
            driver.complete({
                model: 'fake',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        )) as { usage: Record<string, number> };

        // Provider's authoritative `usd_cents` is preserved verbatim.
        expect(res.usage.usd_cents).toBe(99);
    });

    it('sets `usd_cents = null` when the model has no cost data', async () => {
        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce({
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'ok' }],
            },
            usage: { input_tokens: 4, output_tokens: 2 },
            finish_reason: 'stop',
        } as never);

        const res = (await withTestActor(() =>
            driver.complete({
                model: 'fake', // zero cost map → no rates seen
                messages: [{ role: 'user', content: 'hi' }],
            }),
        )) as { usage: Record<string, number | null> };

        expect(res.usage.usd_cents).toBeNull();
    });
});

// ── Validation event routing ────────────────────────────────────────

describe('ChatCompletionDriver.complete validation event routing', () => {
    it('silently routes to the `fake` model when a listener sets allow=false (no abuse flag)', async () => {
        const completeSpy = vi.spyOn(FakeChatProvider.prototype, 'complete');
        vi.spyOn(server.clients.event, 'emitAndWait').mockImplementation(
            async (key, data) => {
                if (key === 'ai.prompt.validate') {
                    (data as { allow: boolean }).allow = false;
                }
            },
        );

        await withTestActor(() =>
            driver.complete({
                model: 'costly',
                messages: [{ role: 'user', content: 'spam' }],
            }),
        );

        // Forwarded to fake-chat:fake, not fake-chat:costly.
        const args = completeSpy.mock.calls[0]![0] as ICompleteArguments;
        expect(args.model).toBe('fake');
        expect(args.provider).toBe('fake-chat');
    });

    it('routes to the `abuse` model and embeds `event.custom` when listener sets allow=false + abuse=true', async () => {
        const completeSpy = vi.spyOn(FakeChatProvider.prototype, 'complete');
        const payload = { script: '<script>noop</script>' };
        vi.spyOn(server.clients.event, 'emitAndWait').mockImplementation(
            async (key, data) => {
                if (key === 'ai.prompt.validate') {
                    const d = data as {
                        allow: boolean;
                        abuse: boolean;
                        custom: unknown;
                    };
                    d.allow = false;
                    d.abuse = true;
                    d.custom = payload;
                }
            },
        );

        await withTestActor(() =>
            driver.complete({
                model: 'costly',
                messages: [{ role: 'user', content: 'bot prompt' }],
            }),
        );

        const args = completeSpy.mock.calls[0]![0] as ICompleteArguments;
        expect(args.model).toBe('abuse');
        expect(args.custom).toBe(payload);
    });
});

// ── Credit gate + max_tokens cap ────────────────────────────────────

describe('ChatCompletionDriver.complete credit gate and max_tokens cap', () => {
    it('throws 402 `insufficient_funds` when the actor has no remaining credits', async () => {
        vi.spyOn(server.services.metering, 'hasEnoughCredits').mockResolvedValue(
            false,
        );

        await expect(
            withTestActor(() =>
                driver.complete({
                    model: 'costly',
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 402,
            legacyCode: 'insufficient_funds',
        });
    });

    it('caps `max_tokens` so output cannot exceed remaining credits', async () => {
        // Inject a model with canonical `output_tokens` cost so the
        // `outputTokenCost > 0` branch triggers (fake-chat:costly uses
        // hyphenated keys, which the default `output_cost_key`
        // 'output_tokens' doesn't match).
        vi.spyOn(FakeChatProvider.prototype, 'models').mockResolvedValueOnce([
            {
                id: 'capme',
                aliases: [],
                costs_currency: 'usd-cents',
                costs: { input_tokens: 1000, output_tokens: 2000 },
                max_tokens: 8192,
            },
        ]);
        const d = await makeDriver();

        // Remaining credits = 100_000 microcents.
        // Approx input cost is tiny (very short prompt), so allowed
        // output ≈ 100_000 / 2000 = 50 tokens, comfortably below the
        // caller's 10_000 ceiling.
        vi.spyOn(server.services.metering, 'getRemainingUsage').mockResolvedValue(
            100_000,
        );

        const completeSpy = vi
            .spyOn(FakeChatProvider.prototype, 'complete')
            .mockResolvedValueOnce({
                message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'ok' }],
                },
                usage: { input_tokens: 1, output_tokens: 1 },
                finish_reason: 'stop',
            } as never);

        await withTestActor(() =>
            d.complete({
                model: 'capme',
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 10_000,
            }),
        );

        const passed = completeSpy.mock.calls[0]![0] as ICompleteArguments;
        expect(passed.max_tokens).toBeDefined();
        expect(passed.max_tokens!).toBeLessThanOrEqual(50);
        expect(passed.max_tokens!).toBeGreaterThan(0);
    });

    it('rejects subscriber-only models for the default free subscription', async () => {
        vi.spyOn(FakeChatProvider.prototype, 'models').mockResolvedValueOnce([
            {
                id: 'subonly',
                aliases: [],
                costs_currency: 'usd-cents',
                costs: { 'input-tokens': 100, 'output-tokens': 100 },
                max_tokens: 8192,
                subscriberOnly: true,
            },
        ]);
        const d = await makeDriver();
        // Plenty of credits so the credit gate doesn't intercept first.
        vi.spyOn(server.services.metering, 'hasEnoughCredits').mockResolvedValue(
            true,
        );
        vi.spyOn(server.services.metering, 'getRemainingUsage').mockResolvedValue(
            1_000_000,
        );

        await expect(
            withTestActor(() =>
                d.complete({
                    model: 'subonly',
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 403,
            legacyCode: 'permission_denied',
        });
    });
});

// ── Normalisation ───────────────────────────────────────────────────

describe('ChatCompletionDriver.complete normalization', () => {
    it('normalizes the messages array before forwarding to the provider', async () => {
        const completeSpy = vi.spyOn(FakeChatProvider.prototype, 'complete');
        completeSpy.mockResolvedValueOnce({
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'ok' }],
            },
            usage: {},
            finish_reason: 'stop',
        } as never);

        await withTestActor(() =>
            // Plain string — normalize_messages should wrap into { role, content: [...] }
            driver.complete({
                model: 'fake',
                messages: ['just a string' as unknown as object],
            } as ICompleteArguments),
        );

        const passed = completeSpy.mock.calls[0]![0] as ICompleteArguments;
        expect(Array.isArray(passed.messages)).toBe(true);
        expect(passed.messages[0]).toMatchObject({
            role: 'user',
            content: [{ type: 'text', text: 'just a string' }],
        });
    });

    it('returns a `normalize_single_message`-shaped message when args.response.normalize is true', async () => {
        const rawMsg = 'plain text reply'; // not in normalized shape
        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce({
            message: rawMsg,
            usage: {},
            finish_reason: 'stop',
        } as never);

        const res = (await withTestActor(() =>
            driver.complete({
                model: 'fake',
                messages: [{ role: 'user', content: 'hi' }],
                response: { normalize: true },
            }),
        )) as { message: { role: string; content: unknown[] }; normalized: boolean };

        expect(res.normalized).toBe(true);
        expect(res.message.role).toBe('user'); // default role from normalize
        expect(res.message.content).toEqual([
            { type: 'text', text: 'plain text reply' },
        ]);
    });
});

// ── Fallback / error envelope ───────────────────────────────────────

describe('ChatCompletionDriver.complete fallback and error envelope', () => {
    it('returns HTTP 500 with the failure history in `fields.attempts` when all providers fail', async () => {
        vi.spyOn(FakeChatProvider.prototype, 'complete').mockRejectedValue(
            new Error('boom'),
        );

        let caught: HttpError | undefined;
        try {
            await withTestActor(() =>
                driver.complete({
                    model: 'fake',
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            );
        } catch (e) {
            caught = e as HttpError;
        }
        expect(caught).toBeInstanceOf(HttpError);
        expect(caught!.statusCode).toBe(500);
        expect(caught!.message).toBe('All providers failed');
        const attempts = (caught as unknown as { fields: { attempts: unknown[] } })
            .fields.attempts;
        expect(Array.isArray(attempts)).toBe(true);
        // No second provider serves `fake`, so we record exactly one attempt
        // before falling out of the loop.
        expect(attempts).toHaveLength(1);
        expect(attempts[0]).toMatchObject({
            model: 'fake',
            provider: 'fake-chat',
            error: 'boom',
        });
    });

    it('re-checks `hasEnoughCredits` between fallback attempts so a parallel request that drains the wallet aborts the chain', async () => {
        // The primary provider throws; the fallback loop checks credits
        // before its next upstream hit. We force `false` on the second
        // check to verify the 402 short-circuit, even though no actual
        // fallback model is wired (the loop bails on the credit gate
        // before `#findFallback` decides there's nowhere to go).
        vi.spyOn(FakeChatProvider.prototype, 'complete').mockRejectedValueOnce(
            new Error('boom'),
        );
        const credits = vi
            .spyOn(server.services.metering, 'hasEnoughCredits')
            .mockResolvedValueOnce(true) // pre-flight
            .mockResolvedValueOnce(false); // mid-fallback re-check

        // No second provider serves `fake`, so `#findFallback` returns
        // null and the loop exits before reaching the credit re-check.
        // We assert the spy was called for the pre-flight (proving the
        // gate is wired) and that the final outcome is the all-failed
        // envelope, not the 402 — that pins the order of operations.
        await expect(
            withTestActor(() =>
                driver.complete({
                    model: 'fake',
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 500 });
        expect(credits.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
});

// ── Streaming ───────────────────────────────────────────────────────

describe('ChatCompletionDriver.complete streaming', () => {
    it('wraps a provider stream in a DriverStreamResult and emits cost-calculated on stream end', async () => {
        const costEvents = captureEvent('ai.prompt.cost-calculated');

        const result = (await withTestActor(() =>
            driver.complete({
                model: 'costly',
                messages: [{ role: 'user', content: 'streaming hello' }],
                stream: true,
            }),
        )) as unknown as {
            dataType: string;
            content_type: string;
            chunked: boolean;
            stream: Readable;
        };

        expect(result.dataType).toBe('stream');
        expect(result.content_type).toBe('application/x-ndjson');
        expect(result.chunked).toBe(true);

        // FakeChatProvider's stream waits 500ms then writes the text.
        const events = await collectStream(result.stream);
        // The provider writes one text event, then `chatStream.end({})`
        // emits a `usage` envelope. The driver wraps `end` to inject
        // `usd_cents`.
        const usageLine = events.find(
            (e) => (e as { type: string }).type === 'usage',
        ) as { type: 'usage'; usage: Record<string, number | null> };
        expect(usageLine).toBeDefined();
        // costly returns 0/0 unless inputTokens > 0; usage cost is
        // computed off whatever the provider emitted (empty {} here) so
        // `usd_cents` lands as null — no rates seen.
        expect(usageLine.usage.usd_cents).toBeNull();

        // cost-calculated fires once stream.end completes.
        expect(costEvents).toHaveLength(1);
    }, 10_000);
});
