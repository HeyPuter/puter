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

import { PollyClient } from '@aws-sdk/client-polly';
import { TextractClient } from '@aws-sdk/client-textract';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Actor } from '../../../core/actor.js';
import type { PuterServer } from '../../../server.js';
import { setupTestServer } from '../../../testUtil.js';
import { isDriverStreamResult } from '../../meta.js';
import {
    fuzzCalls,
    fuzzCases,
    hostileValue,
    pick,
    type Random,
    upstream,
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
    const refuse = async () => {
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
                ...pick(
                    random,
                    byProvider.get(pick(random, target.providers))!,
                ),
            };
            // Now and then the route itself is the malformed part.
            if (random() < 0.05) {
                route[pick(random, ['provider', 'model'])] =
                    hostileValue(random);
            }
            return route;
        };
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
    }, 600_000);
});
