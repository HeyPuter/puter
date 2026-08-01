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

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';

import { ChatCompletionDriver } from './ai-chat/ChatCompletionDriver.js';
import { ImageGenerationDriver } from './ai-image/ImageGenerationDriver.js';
import { OCRDriver } from './ai-ocr/OCRDriver.js';
import { VoiceChangerDriver } from './ai-speech2speech/VoiceChangerDriver.js';
import { SpeechToTextDriver } from './ai-speech2txt/SpeechToTextDriver.js';
import { TTSDriver } from './ai-tts/TTSDriver.js';
import { VideoGenerationDriver } from './ai-video/VideoGenerationDriver.js';
import { AppDriver } from './apps/AppDriver.js';
import { KVStoreDriver } from './kv/KVStoreDriver.js';
import { NotificationDriver } from './notification/NotificationDriver.js';
import { SubdomainDriver } from './subdomain/SubdomainDriver.js';

import { resolveDriverMeta } from './meta.js';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../services/metering/consts.js';
import { AI_CONCURRENT, AI_RATE_LIMIT } from './util/aiLimits.js';

// Regression guards on each driver class's declared rate-limit /
// concurrency policy. The `readonly rateLimit = ...` field is a class
// initializer that fires before the constructor body, so we can
// instantiate with empty mocks and inspect the instance directly —
// every other driver-mechanic concern (providers, stores, …) is
// covered by that driver's own test file.

// PuterDriver's constructor signature is (config, clients, stores, services).
// Casting empty objects is fine here because field initializers don't read them.
const fake = () => [{}, {}, {}, {}] as [any, any, any, any];

const meta = (
    instance: object,
): NonNullable<ReturnType<typeof resolveDriverMeta>> => {
    const m = resolveDriverMeta(instance as any);
    if (!m) throw new Error('resolveDriverMeta returned null');
    return m;
};

// ── Non-AI drivers (migrated from hardcoded-permissions) ────────────

describe('KVStoreDriver — rate-limit policy', () => {
    const m = meta(new KVStoreDriver(...fake()));

    it('pins the kv tier values (registered 400 / 10s, temp 200 / 10s)', () => {
        expect(m.rateLimit?.default).toEqual({
            limit: 400,
            window: 10_000,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 400,
                [DEFAULT_TEMP_SUBSCRIPTION]: 200,
            },
        });
    });

    it('declares no concurrent cap (intentional — kv calls are cheap)', () => {
        expect(m.concurrent).toBeUndefined();
    });
});

describe('AppDriver — rate-limit policy', () => {
    const m = meta(new AppDriver(...fake()));

    it('pins the apps tier values (registered 100 / 10s, temp 50 / 10s)', () => {
        expect(m.rateLimit?.default).toEqual({
            limit: 100,
            window: 10_000,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 100,
                [DEFAULT_TEMP_SUBSCRIPTION]: 50,
            },
        });
    });
});

describe('SubdomainDriver — rate-limit policy', () => {
    const m = meta(new SubdomainDriver(...fake()));

    it('pins the subdomain tier values (registered 200 / 10s, temp 100 / 10s)', () => {
        expect(m.rateLimit?.default).toEqual({
            limit: 200,
            window: 10_000,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 200,
                [DEFAULT_TEMP_SUBSCRIPTION]: 100,
            },
        });
    });
});

describe('NotificationDriver — rate-limit policy', () => {
    const m = meta(new NotificationDriver(...fake()));

    it('keeps the higher notifications cap (3000 / 30s)', () => {
        // Notifications are poll-heavy on the UI side, so the cap stays
        // generous compared to apps/subdomains.
        expect(m.rateLimit?.default).toEqual({
            limit: 3_000,
            window: 30_000,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 3_000,
                [DEFAULT_TEMP_SUBSCRIPTION]: 1_000,
            },
        });
    });
});

// ── AI drivers — every one shares the same envelope from aiLimits.ts

describe.each([
    ['ChatCompletionDriver', () => new ChatCompletionDriver(...fake())],
    ['ImageGenerationDriver', () => new ImageGenerationDriver(...fake())],
    ['VideoGenerationDriver', () => new VideoGenerationDriver(...fake())],
    ['TTSDriver', () => new TTSDriver(...fake())],
    ['VoiceChangerDriver', () => new VoiceChangerDriver(...fake())],
    ['SpeechToTextDriver', () => new SpeechToTextDriver(...fake())],
    ['OCRDriver', () => new OCRDriver(...fake())],
])('AI driver — %s', (_name, build) => {
    const m = meta(build());

    it('points at the shared AI_RATE_LIMIT constant', () => {
        // Same reference, not just a deep clone — if any AI driver ever
        // forks the policy locally this assertion is the canary.
        expect(m.rateLimit).toBe(AI_RATE_LIMIT);
    });

    it('points at the shared AI_CONCURRENT constant', () => {
        expect(m.concurrent).toBe(AI_CONCURRENT);
    });

    it('accepts bare account-session ("root") tokens', () => {
        // Privileged ("godmode") apps run on the user's own session token
        // rather than an app token, so the AI drivers can't distinguish
        // them from a browser session and have to admit both.
        expect(m.noUserSession).toBe(false);
    });
});

describe('non-AI drivers — session tokens stay allowed', () => {
    it.each([
        ['KVStoreDriver', () => new KVStoreDriver(...fake())],
        ['AppDriver', () => new AppDriver(...fake())],
        ['SubdomainDriver', () => new SubdomainDriver(...fake())],
        ['NotificationDriver', () => new NotificationDriver(...fake())],
    ])('%s does not set noUserSession', (_name, build) => {
        expect(meta(build()).noUserSession).toBe(false);
    });
});

// ── Iface coordination cross-check ──────────────────────────────────

describe('puter-speech2txt — one driver covers every provider', () => {
    // A single driver serves the interface, so the controller's
    // (iface, method, user) bucket already spans every provider and
    // switching providers mid-session can't dodge the cap.
    it('answers to the legacy per-provider driver names', () => {
        const m = meta(new SpeechToTextDriver(...fake()));
        expect(m.interfaceName).toBe('puter-speech2txt');
        expect(m.driverName).toBe('ai-speech2txt');
        expect(m.aliases).toEqual(
            expect.arrayContaining(['openai-speech2txt', 'xai-speech2txt']),
        );
    });
});
