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
 * Puter is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Puter. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Seeded fuzzing of the image, video, speech and OCR drivers through every
 * provider they register. One suite covers the six so the server boots once.
 * Every vendor refuses the request, so what runs is each driver's validation,
 * each provider's request building, and the mapping of the refusal.
 */

import { Readable } from 'node:stream';

import { PollyClient } from '@aws-sdk/client-polly';
import { TextractClient } from '@aws-sdk/client-textract';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Actor } from '../../../core/actor.js';
import type { PuterServer } from '../../../server.js';
import { setupTestServer } from '../../../testUtil.js';
import { isDriverStreamResult } from '../../meta.js';
import {
    fuzzCalls,
    caseRandom,
    Findings,
    unclassifiedFailure,
    fuzzCases,
    hostileValue,
    pick,
    pickStable,
    type Random,
    upstream,
    type UpstreamReply,
} from '../shared/fuzzTestUtil.js';
import {
    readStreamResult,
    withTestActor,
} from '../shared/integrationTestUtil.js';

vi.mock('undici', async (importOriginal) => ({
    ...(await importOriginal<typeof import('undici')>()),
    fetch: (input: unknown, init?: RequestInit) => upstream.fetch(input, init),
}));

vi.mock('axios', () => {
    const request = (config: Parameters<typeof upstream.axios>[0]) =>
        upstream.axios(config);
    const get = (url: string, config?: object) =>
        upstream.axios({ ...config, url, method: 'GET' });
    return { default: { request, get }, request, get };
});

const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const AUDIO =
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
const PDF = 'data:application/pdf;base64,JVBERi0xLjQK';

type Route = { provider: string; model?: string };

interface Target {
    name: string;
    driver: string;
    method: string;
    /** The providers the suite must reach, so a lost registration fails it. */
    providers: string[];
    routes: (driver: Record<string, any>) => Promise<Route[]>;
    corpus: Record<string, unknown>[];
}

const modelRoutes = async (driver: Record<string, any>): Promise<Route[]> =>
    (await driver.models()).map((model: { provider: string; id: string }) => ({
        provider: model.provider,
        model: model.id,
    }));

const providerRoutes = async (driver: Record<string, any>): Promise<Route[]> =>
    (await driver.list()).map((provider: string) => ({ provider }));

const TARGETS: Target[] = [
    {
        name: 'image generation',
        driver: 'aiImage',
        method: 'generate',
        providers: [
            'byteplus-image-generation',
            'cloudflare-image-generation',
            'gemini-image-generation',
            'kling-image-generation',
            'openai-image-generation',
            'replicate-image-generation',
            'xai-image-generation',
        ],
        routes: modelRoutes,
        corpus: [
            { prompt: 'a red cube' },
            {
                prompt: 'a red cube',
                ratio: { w: 1024, h: 768 },
                quality: 'high',
                seed: 7,
                negative_prompt: 'blur',
                steps: 4,
                guidance: 2,
                response_format: 'png',
                output_megapixels: '1',
                providerOptions: { go_fast: true },
            },
            {
                prompt: 'make it blue',
                input_image: PNG,
                input_image_mime_type: 'image/png',
            },
            {
                prompt: 'combine these',
                input_images: [PNG, PNG],
                imageSize: '1K',
                resolution: '1k',
            },
        ],
    },
    {
        name: 'video generation',
        driver: 'aiVideo',
        method: 'generate',
        providers: [
            'byteplus-video-generation',
            'gemini-video-generation',
            'kling-video-generation',
            'minimax-video-generation',
            'together-video-generation',
        ],
        routes: modelRoutes,
        corpus: [
            { prompt: 'a red ball' },
            {
                prompt: 'a red ball',
                seconds: 4,
                resolution: '480p',
                size: '1280x720',
                fps: 24,
                seed: 7,
                negative_prompt: 'blur',
                generate_audio: true,
                output_format: 'mp4',
            },
            {
                prompt: 'animate this',
                reference_images: [PNG],
                frame_images: [{ input_image: PNG, frame: 0 }],
                last_frame: PNG,
                input_reference: PNG,
                metadata: { trace: 't' },
            },
            {
                prompt: 'edit this',
                input_video: 'data:video/mp4;base64,AAAA',
                duration: '5',
                width: 1280,
                height: 720,
            },
        ],
    },
    {
        name: 'text to speech',
        driver: 'aiTts',
        method: 'synthesize',
        providers: [
            'aws-polly',
            'elevenlabs',
            'gemini',
            'kling',
            'openai',
            'speechify',
            'xai',
        ],
        routes: providerRoutes,
        corpus: [
            { text: 'Hello.' },
            {
                text: 'Hello.',
                voice: 'Joanna',
                engine: 'neural',
                model: 'tts-1',
                language: 'en-US',
                response_format: 'mp3',
                output_format: 'mp3_44100_128',
                instructions: 'Calm.',
                voice_settings: { stability: 0.5 },
            },
            { text: 'Hello.', ssml: '<speak>Hello.</speak>' },
        ],
    },
    {
        name: 'speech to text',
        driver: 'aiSpeech2Txt',
        method: 'transcribe',
        providers: ['gemini', 'openai', 'xai'],
        routes: providerRoutes,
        corpus: [
            { file: AUDIO },
            {
                file: AUDIO,
                language: 'en',
                prompt: 'Names: Ada.',
                temperature: 0,
                response_format: 'verbose_json',
                timestamp_granularities: ['word'],
                logprobs: true,
                diarize: true,
                known_speaker_names: ['Ada'],
                extra_body: { a: 1 },
                chunking_strategy: 'auto',
                format: true,
                multichannel: false,
                channels: 1,
                audio_format: 'wav',
                sample_rate: 16000,
            },
        ],
    },
    {
        name: 'speech to speech',
        driver: 'aiSpeech2Speech',
        method: 'convert',
        providers: ['elevenlabs'],
        routes: async () => [{ provider: 'elevenlabs' }],
        corpus: [
            { audio: AUDIO },
            {
                audio: AUDIO,
                voice: 'v',
                model: 'eleven_multilingual_sts_v2',
                voice_settings: { stability: 0.5 },
                seed: 1,
                remove_background_noise: true,
                output_format: 'mp3_44100_128',
                file_format: 'other',
                optimize_streaming_latency: 1,
                enable_logging: false,
            },
        ],
    },
    {
        name: 'OCR',
        driver: 'aiOcr',
        method: 'recognize',
        providers: ['aws-textract', 'mistral'],
        routes: async () => [
            { provider: 'aws-textract' },
            { provider: 'mistral' },
        ],
        corpus: [
            { source: PDF },
            { file: PDF },
            {
                source: PNG,
                pages: [0],
                includeImageBase64: true,
                imageLimit: 1,
                imageMinSize: 10,
                tableFormat: 'markdown',
                extractHeader: true,
                extractFooter: false,
                documentAnnotationPrompt: 'Summarize.',
                bboxAnnotationFormat: { type: 'json_schema' },
                documentAnnotationFormat: { type: 'text' },
            },
        ],
    },
];


// -- Malformed successes --

const realSetTimeout = globalThis.setTimeout;
const MEDIA_URL = 'https://media.upstream.test/a.bin';
const DONE = [
    'succeeded',
    'completed',
    'success',
    'Success',
    'succeed',
    'SUCCEEDED',
    'COMPLETED',
    'done',
    'finished',
    'failed',
    'Fail',
    'error',
    'canceled',
    'expired',
];
const PENDING = [
    'queued',
    'processing',
    'running',
    'submitted',
    'starting',
    'in_progress',
    'Queueing',
    'Processing',
    'Preparing',
];
const REPLY_KEYS = [
    'status',
    'message',
    'usage',
    'data',
    'id',
    'model',
    'text',
    'error',
    'output',
    'outputs',
    'url',
    'urls',
    'get',
    'stream',
    'b64_json',
    'image',
    'images',
    'video',
    'videos',
    'video_url',
    'result',
    'results',
    'content',
    'duration',
    'seconds',
    'words',
    'pages',
    'language',
    'task_id',
    'task_status',
    'task_status_msg',
    'task_result',
    'code',
    'success',
    'result_info',
    'errors',
    'file_id',
    'file',
    'download_url',
    'base_resp',
    'status_code',
    'status_msg',
    'audio_data',
    'audio',
    'audio_format',
    'audio_base64',
    'alignment',
    'usageInfo',
    'usage_info',
    'pagesProcessed',
    'pages_processed',
    'markdown',
    'index',
    'documentAnnotation',
    'document_annotation',
    'metrics',
    'predict_time',
    'image_count',
    'input_tokens',
    'output_tokens',
    'total_tokens',
    'completion_tokens',
    'prompt_tokens',
    'input_tokens_details',
    'output_tokens_details',
    'image_tokens',
    'text_tokens',
    'generated_images',
    'cost',
    'cost_in_usd_ticks',
    'resolution',
    'ratio',
    'width',
    'height',
    'size',
    'quality',
    'last_frame_image',
    'first_frame_image',
    'image_list',
    'final_unit_deduction',
    'unit_deduction',
    'video_width',
    'video_height',
    'created_at',
    'completed_at',
    'version',
    'logs',
    'input',
    'voices',
    'voice_id',
    'name',
    'type',
    'has_more',
    'request_id',
    'character_count',
    'characters',
    'segments',
    'speakers',
    'channels',
    'start',
    'end',
    'speaker',
    'logprobs',
    'tokens',
    'info',
    'AudioStream',
    'Blocks',
    'BlockType',
    'Text',
    'Confidence',
    'Id',
    'RequestCharacters',
    'ContentType',
    'DocumentMetadata',
    'Pages',
    'Relationships',
    'Ids',
    'Type',
    'Page',
    'Geometry',
    'Voices',
];

const replyLeaf = (random: Random): unknown => {
    const roll = Math.floor(random() * 12);
    if (roll <= 1) return MEDIA_URL;
    if (roll === 2) return PNG.split(',')[1];
    if (roll === 3) return PNG;
    if (roll <= 5) return pick(random, DONE);
    if (roll === 6) return random() < 0.3 ? pick(random, PENDING) : 0;
    if (roll === 7) return pick(random, [1, 5, 0, 200, 1024, 3.5]);
    if (roll === 8) return pick(random, ['id_1', 'LINE', 'PAGE', 'mp3', 'en']);
    if (roll === 9) return random() < 0.5;
    return hostileValue(random);
};

const ID_KEY = /(^id$|_id$|^Id$|request_id)/;
const URL_KEY = /(url|^get$|^stream$|^output$|_image$|^video$|^image$|^file$)/i;
const STATUS_KEY = /(status$|^code$|^success$|^type$|BlockType)/;
const COUNT_KEY =
    /(duration|seconds|tokens|count|^cost|deduction|width|height|time|Pages|pagesProcessed|pages_processed|characters|Confidence|^index$|^start$|^end$)/;
const LIST_KEY =
    /(^data$|outputs?$|images$|videos$|results$|words$|pages$|segments$|voices$|Blocks$|image_list|errors$|content$)/;

/** Mostly the kind of value the vendors put under `key`, sometimes not. */
const replyValue = (random: Random, depth: number, key = ''): unknown => {
    if (random() < 0.7) {
        if (ID_KEY.test(key)) return 'id_1';
        if (STATUS_KEY.test(key) && random() < 0.8) {
            return pick(random, [
                ...DONE,
                ...DONE,
                0,
                200,
                true,
                'LINE',
                'PAGE',
                pick(random, PENDING),
            ]);
        }
        if (COUNT_KEY.test(key)) {
            return pick(random, [
                1,
                5,
                0,
                3.5,
                1024,
                '5',
                -1,
                1e308,
                2 ** 53,
                null,
                '1e309',
            ]);
        }
        if (LIST_KEY.test(key) && depth <= 4 && random() < 0.75) {
            return Array.from({ length: 1 + Math.floor(random() * 2) }, () =>
                random() < 0.8
                    ? replyObject(random, depth + 1)
                    : replyLeaf(random),
            );
        }
        if (URL_KEY.test(key) && random() < 0.7) {
            return pick(random, [
                MEDIA_URL,
                MEDIA_URL,
                PNG,
                PNG.split(',')[1],
                [MEDIA_URL],
                { url: MEDIA_URL },
            ]);
        }
    }
    const roll = random();
    if (depth > 4 || roll < 0.4) return replyLeaf(random);
    if (roll < 0.55) {
        return Array.from({ length: Math.floor(random() * 4) }, () =>
            replyValue(random, depth + 1),
        );
    }
    return replyObject(random, depth + 1);
};

const replyObject = (
    random: Random,
    depth: number,
): Record<string, unknown> => {
    const object: Record<string, unknown> = {};
    for (let count = 2 + Math.floor(random() * 10); count > 0; count--) {
        const key = pick(random, REPLY_KEYS);
        object[key] = replyValue(random, depth, key);
    }
    return object;
};

/** A 2xx answer shaped like no vendor's, built from the fields they use. */
const vendorReply = (random: Random, url: URL): UpstreamReply => {
    const roll = random();
    if (roll < 0.04) return refused;
    if (roll < 0.1) {
        return {
            body: pick(random, [
                '',
                '<html>Bad gateway</html>',
                '{',
                'null',
                '[]',
                '0',
                '"x"',
            ]),
            contentType: pick(random, [
                'text/html',
                'application/json',
                'text/plain',
            ]),
        };
    }
    if (roll < 0.2 || url.hostname === 'media.upstream.test') {
        return {
            body: pick(random, ['bytes', '', 'RIFF', '\u0089PNG']),
            contentType:
                pick(random, [
                    'image/png',
                    'audio/mpeg',
                    'video/mp4',
                    'application/octet-stream',
                    'text/html',
                    '',
                ]) || undefined,
        };
    }
    const body = replyObject(random, 1);
    for (const key of ['id', 'task_id', 'data', 'status', 'output', 'code']) {
        if (random() < 0.6) body[key] = replyValue(random, 1, key);
    }
    return { body, contentType: 'application/json' };
};

let awsReply: ((command: unknown) => unknown) | undefined;
// Charges no vendor answer should be able to cause.
const charges: string[] = [];

const key = { apiKey: 'fuzz-key' };
const aws = {
    aws: { access_key: 'AKIAFUZZ', secret_key: 'x', region: 'us-west-2' },
};
const providers = {
    openai: key,
    'openai-completion': key,
    gemini: key,
    xai: key,
    mistral: key,
    'mistral-ocr': key,
    minimax: key,
    'together-ai': key,
    byteplus: key,
    elevenlabs: key,
    speechify: key,
    kling: key,
    'replicate-image-generation': key,
    'cloudflare-image-generation': { apiToken: 'fuzz-key', accountId: 'acct' },
    'aws-polly': aws,
    'aws-textract': aws,
    ollama: { enabled: false },
};

const refused = { status: 400, body: { error: { message: 'refused' } } };

let server: PuterServer;
// File input needs a user, so the calls run as one, not as the system actor.
let actor: Actor;

beforeAll(async () => {
    upstream.install();
    upstream.respond = () => refused;
    const refuse = async (command: unknown) => {
        if (awsReply) return awsReply(command);
        throw Object.assign(new Error('refused'), {
            name: 'ValidationException',
            $metadata: { httpStatusCode: 400 },
        });
    };
    vi.spyOn(PollyClient.prototype, 'send').mockImplementation(refuse);
    vi.spyOn(TextractClient.prototype, 'send').mockImplementation(refuse);
    server = await setupTestServer({
        providers,
        unlimitedMetering: true,
    } as never);
    const user = await server.stores.user.create({
        username: 'media-fuzz',
        uuid: '6b1f3c1e-5d0a-4f6e-9c53-0d1f6a2b7c11',
        password: null,
        email: 'media-fuzz@test.local',
        requires_email_confirmation: false,
    });
    // Poll intervals pass at once; request timeouts are far longer.
    globalThis.setTimeout = ((
        fn: () => void,
        ms?: number,
        ...rest: unknown[]
    ) =>
        realSetTimeout(
            fn,
            ms && ms >= 400 && ms <= 6000 ? 1 : ms,
            ...rest,
        )) as typeof setTimeout;
    const metering = server.services.metering as unknown as Record<string, any>;
    const realBatch = metering.batchIncrementUsages.bind(metering);
    metering.batchIncrementUsages = (who: unknown, usages: any[]) => {
        // A flagged charge is recorded and dropped, so it can't drain the
        // balance the later cases run on.
        const sane = (usages ?? []).filter((usage) => {
            let ok = true;
            for (const [name, value] of [
                ['amount', usage?.usageAmount],
                ['cost', usage?.costOverride],
            ] as const) {
                if (value === undefined || value === null) continue;
                if (
                    typeof value !== 'number' ||
                    !Number.isFinite(value) ||
                    value < 0 ||
                    value > 1e12
                ) {
                    charges.push(
                        `${name} ${usage?.usageType} ${String(value)}`,
                    );
                    ok = false;
                }
            }
            return ok;
        });
        return realBatch(who, sane);
    };
    actor = {
        user: {
            id: user.id,
            uuid: user.uuid,
            username: user.username,
            email: user.email ?? null,
            email_confirmed: true,
        } as Actor['user'],
    };
}, 120_000);

afterAll(async () => {
    await server?.shutdown();
    upstream.uninstall();
    globalThis.setTimeout = realSetTimeout;
    vi.restoreAllMocks();
});

describe.each(TARGETS)('$name driver seeded fuzzing', (target) => {
    it('rejects a malformed request with a classified error on every provider', async () => {
        const driver = (server.drivers as unknown as Record<string, any>)[
            target.driver
        ];
        const routes = await target.routes(driver);
        const byProvider = new Map<string, Route[]>();
        for (const route of routes) {
            byProvider.set(route.provider, [
                ...(byProvider.get(route.provider) ?? []),
                route,
            ]);
        }
        expect([...byProvider.keys()].sort()).toEqual(target.providers);

        const pinned = (random: Random) => {
            const route: Record<string, unknown> = {
                ...pickStable(
                    random,
                    byProvider.get(
                        pickStable(random, target.providers, (name) => name),
                    )!,
                    (candidate) => String(candidate.model),
                ),
            };
            // Now and then the route itself is the malformed part.
            if (random() < 0.05) {
                route[pick(random, ['provider', 'model'])] =
                    hostileValue(random);
            }
            return route;
        };
        const askedBefore = upstream.asked;
        const findings = await fuzzCalls({
            seed: 0x3ed1a,
            cases: fuzzCases(1000),
            corpus: target.corpus,
            optionNames: target.corpus.flatMap((request) =>
                Object.keys(request),
            ),
            pinned,
            call: async (args) => {
                const result = await withTestActor(
                    () => driver[target.method](args),
                    actor,
                );
                if (isDriverStreamResult(result))
                    await readStreamResult(result);
            },
        });
        findings.assertNone();
        // Some of the requests have to get as far as a vendor.
        expect(upstream.asked).toBeGreaterThan(askedBefore);
    }, 600_000);
    it('settles every request when the vendor answers with a malformed success', async () => {
        const driver = (server.drivers as unknown as Record<string, any>)[
            target.driver
        ];
        const routes = await target.routes(driver);
        const only = process.env.PUTER_FUZZ_PROVIDER;
        const names = target.providers.filter((name) => !only || name === only);
        if (!names.length) return;
        const findings = new Findings();
        const seed = Number(process.env.PUTER_FUZZ_SEED ?? 0x5eed);
        for (let index = 0; index < fuzzCases(1500); index++) {
            const random = caseRandom(seed, index);
            const provider = pickStable(random, names, (name) => name);
            const candidates = routes.filter((r) => r.provider === provider);
            const route = pickStable(random, candidates, (c) =>
                String(c.model),
            );
            const args = {
                ...(random() < 0.6
                    ? target.corpus[0]
                    : pick(random, target.corpus)),
                ...route,
            };
            const replies: unknown[] = [];
            let asks = 0;
            const replyRandom = caseRandom(seed ^ 0x77, index);
            upstream.respond = ({ url }) => {
                if (++asks > 8) return refused;
                const reply = vendorReply(replyRandom, url);
                replies.push(`${url.hostname}${url.pathname}`, reply.body);
                return reply;
            };
            // The SDK types its output, so only optional fields vary.
            awsReply = (command) => {
                const name = (command as object).constructor.name;
                if (name === 'DescribeVoicesCommand') {
                    return {
                        Voices: [
                            {
                                Id: 'Joanna',
                                Name: 'Joanna',
                                LanguageCode: 'en-US',
                                LanguageName: 'US English',
                                SupportedEngines: [
                                    'neural',
                                    'standard',
                                    'generative',
                                    'long-form',
                                ],
                            },
                        ],
                    };
                }
                const maybe = <T>(value: T) =>
                    replyRandom() < 0.25 ? undefined : value;
                if (name === 'SynthesizeSpeechCommand') {
                    return {
                        AudioStream: maybe(Readable.from(Buffer.from('mp3'))),
                        RequestCharacters: maybe(
                            pick(replyRandom, [5, 0, -1, 2 ** 31]),
                        ),
                        ContentType: maybe('audio/mpeg'),
                    };
                }
                return {
                    DocumentMetadata: maybe({
                        Pages: maybe(pick(replyRandom, [1, 0, 3000])),
                    }),
                    Blocks: maybe(
                        Array.from(
                            { length: Math.floor(replyRandom() * 5) },
                            () => ({
                                BlockType: maybe(
                                    pick(replyRandom, [
                                        'PAGE',
                                        'LINE',
                                        'WORD',
                                        'TABLE',
                                    ]),
                                ),
                                Text: maybe(
                                    pick(replyRandom, ['hi', '', '\u0000']),
                                ),
                                Confidence: maybe(
                                    pick(replyRandom, [99.5, 0, NaN]),
                                ),
                                Id: maybe('b1'),
                                Page: maybe(pick(replyRandom, [1, 0, 7])),
                            }),
                        ),
                    ),
                };
            };
            charges.length = 0;
            let timer: ReturnType<typeof realSetTimeout> | undefined;
            try {
                await Promise.race([
                    (async () => {
                        const result = await withTestActor(
                            () => driver[target.method](structuredClone(args)),
                            actor,
                        );
                        if (isDriverStreamResult(result))
                            await readStreamResult(result);
                        else JSON.stringify(result);
                    })(),
                    new Promise((_, reject) => {
                        timer = realSetTimeout(
                            () => reject(new Error('the call did not finish')),
                            15_000,
                        );
                    }),
                ]);
            } catch (error) {
                const failure = unclassifiedFailure(error);
                if (failure)
                    findings.add(
                        `${provider} ${failure.replace(/"[^"]*"\.*/g, '…').replace(/Body:.*/, '')}`,
                        index,
                        `${route.model ?? ''}`,
                        replies,
                    );
            } finally {
                clearTimeout(timer);
            }
            for (const charge of charges.splice(0)) {
                findings.add(
                    `${provider} metering ${charge.split(' ')[0]}`,
                    index,
                    `${route.model ?? ''} ${charge}`,
                    replies,
                );
            }
        }
        upstream.respond = () => refused;
        awsReply = undefined;
        findings.assertNone();
    }, 1_800_000);
});
