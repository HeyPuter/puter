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
import { WorkerDriver } from './workers/WorkerDriver.js';

import { DRIVERS_CALL_LIMIT } from '../controllers/drivers/DriverController.js';
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

    // Asserted as a relationship rather than as literals: what has to hold is
    // that a scan is charged more than a point read and that every tier still
    // clears an app rendering a view, not that the numbers are any particular
    // pair.
    it('gives `list` its own budget — a prefix scan, not a point read', () => {
        const list = m.rateLimit?.methods?.list;
        const dflt = m.rateLimit?.default;
        expect(list).toBeDefined();

        // Per-second, since the two use different windows.
        const perSecond = (spec: { limit: number; window?: number }): number =>
            spec.limit / ((spec.window ?? 60_000) / 1000);
        expect(perSecond(list!)).toBeLessThan(perSecond(dflt!));

        for (const tier of [
            DEFAULT_FREE_SUBSCRIPTION,
            DEFAULT_TEMP_SUBSCRIPTION,
        ]) {
            expect(list!.bySubscription?.[tier]).toBeLessThanOrEqual(
                list!.limit,
            );
            // A view that lists on open shouldn't run out mid-session.
            expect(list!.bySubscription?.[tier]).toBeGreaterThanOrEqual(30);
        }
    });

    // An individual kv call is cheap, which is what the window is sized for.
    // The concurrent cap is a different axis: it bounds how many can be in
    // flight at once from a caller that never waits for a response.
    it('caps in-flight calls, with `list` tighter than the default', () => {
        expect(m.concurrent?.default).toEqual({
            limit: 30,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 15,
                [DEFAULT_TEMP_SUBSCRIPTION]: 8,
            },
        });
        expect(m.concurrent?.methods?.list?.limit).toBe(5);
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

    // The blanket envelope above is sized for the reads desktop boot makes.
    // Writing an app row also allocates an app directory and a subdomain.
    it('puts the write methods on a tighter budget than the reads', () => {
        const perSecond = (spec: { limit: number; window?: number }): number =>
            spec.limit / ((spec.window ?? 60_000) / 1000);
        const readRate = perSecond(m.rateLimit!.default!);

        for (const method of ['create', 'update', 'upsert', 'delete']) {
            const spec = m.rateLimit?.methods?.[method];
            expect(spec).toBeDefined();
            expect(perSecond(spec!)).toBeLessThan(readRate);

            // Tighter than the reads, but not so tight that provisioning a
            // few apps in a row — which deploying a worker does on the
            // user's behalf — runs out partway through.
            for (const tier of [
                DEFAULT_FREE_SUBSCRIPTION,
                DEFAULT_TEMP_SUBSCRIPTION,
            ]) {
                expect(spec!.bySubscription?.[tier]).toBeGreaterThanOrEqual(30);
            }
        }
    });

    it('rate-limits the name-availability oracle separately', () => {
        expect(m.rateLimit?.methods?.isNameAvailable?.limit).toBe(60);
    });
});

describe('WorkerDriver — rate-limit policy', () => {
    const m = meta(new WorkerDriver(...fake()));

    // Without a declared policy this driver fell back to the generic
    // 600/minute default, which does not fit a method that deploys code.
    it('pins `create` below the driver`s own read budget', () => {
        const create = m.rateLimit?.methods?.create;
        expect(create).toBeDefined();
        expect(create!.limit).toBeLessThan(m.rateLimit!.default!.limit);

        // Developing against workers means redeploying on every change, so
        // the floor has to clear a working session rather than a few tries.
        for (const tier of [
            DEFAULT_FREE_SUBSCRIPTION,
            DEFAULT_TEMP_SUBSCRIPTION,
        ]) {
            expect(create!.bySubscription?.[tier]).toBeGreaterThanOrEqual(20);
            expect(create!.bySubscription?.[tier]).toBeLessThanOrEqual(
                create!.limit,
            );
        }
    });

    it('never drops a concurrency slot below 2', () => {
        const specs = [
            m.concurrent?.default,
            ...Object.values(m.concurrent?.methods ?? {}),
        ].filter(Boolean);
        expect(specs.length).toBeGreaterThan(0);
        for (const spec of specs) {
            expect(spec!.limit).toBeGreaterThanOrEqual(2);
            for (const n of Object.values(spec!.bySubscription ?? {})) {
                expect(n).toBeGreaterThanOrEqual(2);
            }
        }
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

// ── Cross-driver invariants ────────────────────────────────────────

describe('every registered driver', () => {
    const drivers = [
        ['kvStore', KVStoreDriver],
        ['aiChat', ChatCompletionDriver],
        ['aiImage', ImageGenerationDriver],
        ['aiTts', TTSDriver],
        ['aiVideo', VideoGenerationDriver],
        ['aiSpeech2Speech', VoiceChangerDriver],
        ['aiSpeech2Txt', SpeechToTextDriver],
        ['aiOcr', OCRDriver],
        ['apps', AppDriver],
        ['subdomains', SubdomainDriver],
        ['notifications', NotificationDriver],
        ['workers', WorkerDriver],
    ] as const;

    // A driver that declares nothing silently inherits the generic
    // 600/minute fallback in `checkDriverRateLimit`, which is far too loose
    // for anything that writes or spends. Declaring is the point.
    it.each(drivers)('%s declares a rate-limit policy', (_name, Driver) => {
        const m = meta(new (Driver as any)(...fake()));
        expect(m.rateLimit?.default ?? m.rateLimit?.methods).toBeTruthy();
    });

    // Concurrency has no fallback at all — undeclared means unbounded.
    it.each(drivers)('%s declares a concurrency cap', (_name, Driver) => {
        const m = meta(new (Driver as any)(...fake()));
        expect(m.concurrent?.default).toBeTruthy();
    });

    // A single slot turns incidental client parallelism — two tabs, a
    // prefetch alongside a user action — into a spurious 429. Paid tiers
    // keep enough headroom to actually parallelise.
    it.each(drivers)(
        '%s keeps every concurrency slot at 2 or more, and 5+ when paid',
        (_name, Driver) => {
            const m = meta(new (Driver as any)(...fake()));
            const specs = [
                m.concurrent?.default,
                ...Object.values(m.concurrent?.methods ?? {}),
            ].filter(Boolean);
            for (const spec of specs) {
                expect(spec!.limit).toBeGreaterThanOrEqual(5);
                for (const n of Object.values(spec!.bySubscription ?? {})) {
                    expect(n).toBeGreaterThanOrEqual(2);
                }
            }
        },
    );

    // The `/call` route carries its own limit across the whole driver
    // surface. It is meant to catch fan-out across many interfaces, which
    // only works if it sits above what any single driver already allows —
    // otherwise it quietly becomes the operative limit for the widest
    // drivers and overrides the tier policy they declare, while their own
    // assertions above keep passing because those check the declaration
    // rather than the ceiling a caller actually meets.
    //
    // Windows differ per driver (10s, 30s, 60s), so compare rates.
    const perMinute = (spec: { limit: number; window: number }) =>
        (spec.limit / spec.window) * 60_000;

    const envelopePerMinute = perMinute(DRIVERS_CALL_LIMIT);

    it.each(drivers)(
        '%s declares no budget wider than the /call envelope',
        (_name, Driver) => {
            const m = meta(new (Driver as any)(...fake()));
            const specs = [
                m.rateLimit?.default,
                ...Object.values(m.rateLimit?.methods ?? {}),
            ].filter(Boolean);
            expect(specs.length).toBeGreaterThan(0);
            for (const spec of specs) {
                // `bySubscription` only ever carves *tighter* caps out of
                // `limit`, so the base is the widest value in the spec.
                expect(perMinute(spec!)).toBeLessThanOrEqual(envelopePerMinute);
            }
        },
    );
});
