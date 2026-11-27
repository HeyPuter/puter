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
 * AWSPollyTTSProvider against an AWS that stops answering.
 *
 * The provider and the Polly SDK client are the real ones. AWS is stubbed at
 * the network layer only: `AWS_ENDPOINT_URL_POLLY` points the client at a local
 * HTTP/2 server that takes each request and answers only as a test scripts it.
 * The speech timeout is shortened for the suite; sockets and timers are real.
 */

import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { makeActor, type Actor } from '../../../../../core/actor.js';
import { PuterServer } from '../../../../../server.js';
import type { MeteringService } from '../../../../../services/metering/MeteringService.js';
import {
    scriptedHttp2Upstream,
    type Http2Answer,
    type ScriptedUpstream,
} from '../../../../../testFixtures/scriptedUpstream.js';
import { setupTestServer } from '../../../../../testUtil.js';
import { withAiCostFactor } from '../../../../../util/aiCostFactor.js';
import { settleWithin } from '../../../../../util/concurrency.js';
import {
    callerError,
    readStreamResult,
    withTestActor,
} from '../../../shared/integrationTestUtil.js';
import { AWSPollyTTSProvider } from './AWSPollyTTSProvider.js';
import usWest2PriceList from './fixtures/us-west-2.json';

const { TIMEOUT_MS } = vi.hoisted(() => ({ TIMEOUT_MS: 1000 }));
// A call that never returns fails an assertion, not the test's own timeout.
const CEILING_MS = 5000;
const SETTLED = 'the call settled before the ceiling';

vi.mock('../../../interfaces/textToSpeech/common.js', async (original) => ({
    ...(await original<
        typeof import('../../../interfaces/textToSpeech/common.js')
    >()),
    TTS_UPSTREAM_TIMEOUT_MS: TIMEOUT_MS,
}));

const USAGE_TYPE = 'aws-polly:standard:character';
const ENDPOINT_ENV = 'AWS_ENDPOINT_URL_POLLY';

let server: PuterServer;
let upstream: ScriptedUpstream<Http2Answer>;
let incrementUsageSpy: MockInstance<MeteringService['incrementUsage']>;
const configuredEndpoint = process.env[ENDPOINT_ENV];

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
    if (configuredEndpoint === undefined) delete process.env[ENDPOINT_ENV];
    else process.env[ENDPOINT_ENV] = configuredEndpoint;
});

beforeEach(async () => {
    upstream = await scriptedHttp2Upstream();
    process.env[ENDPOINT_ENV] = upstream.url;
    // Polly is priced from AWS's public price list; serve the recording.
    vi.stubGlobal('fetch', async (input: string | URL | Request) =>
        String(input instanceof Request ? input.url : input).endsWith(
            '/AmazonPolly/current/us-west-2/index.json',
        )
            ? Response.json(usWest2PriceList)
            : new Response('not found', { status: 404 }),
    );
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
});

afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await upstream.close();
});

const makeProvider = () =>
    new AWSPollyTTSProvider(
        withAiCostFactor(
            server.services.metering,
            server.clients.event,
            'ai-tts',
        ),
        {
            credentials: {
                accessKeyId: 'AKIA-TEST',
                secretAccessKey: 'secret',
            },
        },
    );

/** A metered account, so holds and charges are real. */
const makeUser = async (): Promise<Actor> => {
    const username = `polly-${Math.random().toString(36).slice(2, 10)}`;
    const user = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        requires_email_confirmation: false,
    });
    return makeActor({ user: { ...user, email_confirmed: true } });
};

/** Characters billed to Polly's standard engine, one entry per charge. */
const billedCharacters = () =>
    incrementUsageSpy.mock.calls
        .filter(([, usageType]) => usageType === USAGE_TYPE)
        .map(([, , characters]) => characters);

const heldCredits = (actor: Actor) =>
    server.stores.creditHold.outstanding(actor.user.uuid!);

const VOICES = {
    Voices: [
        {
            Id: 'Joanna',
            Name: 'Joanna',
            LanguageCode: 'en-US',
            LanguageName: 'US English',
            SupportedEngines: ['standard'],
        },
    ],
};

/**
 * Answers DescribeVoices at once, and SynthesizeSpeech with its headers at once
 * and then `chunks`, `everyMs` apart.
 */
const pollyAnswering =
    (chunks: Buffer[], everyMs = 0): Http2Answer =>
    (stream, headers) => {
        stream.resume();
        if (String(headers[':path']).startsWith('/v1/voices')) {
            stream.respond({
                ':status': 200,
                'content-type': 'application/json',
            });
            stream.end(JSON.stringify(VOICES));
            return;
        }
        stream.respond({ ':status': 200, 'content-type': 'audio/mpeg' });
        const pending = [...chunks];
        const tick = setInterval(() => {
            stream.write(pending.shift());
            if (pending.length > 0) return;
            clearInterval(tick);
            stream.end();
        }, everyMs);
        stream.once('close', () => clearInterval(tick));
    };

describe('AWSPollyTTSProvider when AWS stops answering', () => {
    it('fails a synthesis AWS takes and never answers as 504 upstream_timeout, uncharged', async () => {
        const actor = await makeUser();
        const provider = makeProvider();
        const started = Date.now();

        const call = callerError(
            () => provider.synthesize({ text: 'hello', voice: 'Joanna' }),
            actor,
        );

        expect(await settleWithin(call, CEILING_MS), SETTLED).toBe(true);
        expect(await call).toMatchObject({
            statusCode: 504,
            legacyCode: 'upstream_timeout',
        });
        expect(Date.now() - started).toBeGreaterThanOrEqual(TIMEOUT_MS - 10);
        // One request went out, and it was reset, not left open.
        expect(upstream.requests()).toBe(1);
        await vi.waitFor(() => expect(upstream.abandoned()).toBe(1));
        expect(billedCharacters()).toEqual([]);
        await vi.waitFor(async () => expect(await heldCredits(actor)).toBe(0));
    }, 15_000);

    it('fails a voice lookup AWS never answers the same way, then looks the voices up again', async () => {
        const actor = await makeUser();
        const provider = makeProvider();

        // No voice is named, so the call starts with DescribeVoices.
        const call = callerError(
            () => provider.synthesize({ text: 'hello' }),
            actor,
        );
        expect(await settleWithin(call, CEILING_MS), SETTLED).toBe(true);
        expect(await call).toMatchObject({
            statusCode: 504,
            legacyCode: 'upstream_timeout',
        });

        upstream.answer(pollyAnswering([Buffer.from('audio')]));
        const result = await withTestActor(
            () => provider.synthesize({ text: 'hello' }),
            actor,
        );
        expect((await readStreamResult(result)).toString()).toBe('audio');
        // The stalled lookup, then a fresh lookup and the synthesis.
        expect(upstream.requests()).toBe(3);
    }, 15_000);

    it('delivers audio that is still arriving after the timeout and charges it once', async () => {
        const actor = await makeUser();
        const provider = makeProvider();
        const chunks = Array.from({ length: 5 }, (_, i) =>
            Buffer.alloc(1024, i + 1),
        );
        // Two seconds of audio under a one-second timeout.
        upstream.answer(pollyAnswering(chunks, 400));
        const started = Date.now();

        const result = await withTestActor(
            () => provider.synthesize({ text: 'hello', voice: 'Joanna' }),
            actor,
        );
        const audio = await readStreamResult(result);

        expect(Date.now() - started).toBeGreaterThan(TIMEOUT_MS);
        expect(audio.equals(Buffer.concat(chunks))).toBe(true);
        await vi.waitFor(() => expect(billedCharacters()).toEqual([5]));
    }, 15_000);
});
