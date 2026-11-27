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
 * TextractOcrProvider against an AWS that stops answering.
 *
 * The provider and the Textract SDK client are the real ones. AWS is stubbed at
 * the network layer only: `AWS_ENDPOINT_URL_TEXTRACT` points the client at a
 * local HTTP server that takes each request and answers only as a test scripts
 * it. The timeout is shortened for the suite; sockets and timers are real.
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
    scriptedHttpUpstream,
    type HttpAnswer,
    type ScriptedUpstream,
} from '../../../../../testFixtures/scriptedUpstream.js';
import { setupTestServer } from '../../../../../testUtil.js';
import { withAiCostFactor } from '../../../../../util/aiCostFactor.js';
import { settleWithin } from '../../../../../util/concurrency.js';
import type { ResolvedFileInput } from '../../../../util/fileInput.js';
import { findOcrModel } from '../../../interfaces/ocr/models.js';
import {
    callerError,
    withTestActor,
} from '../../../shared/integrationTestUtil.js';
import {
    TEXTRACT_PAGE_USAGE_TYPE,
    TextractOcrProvider,
} from './TextractOcrProvider.js';
import usWest2PriceList from './fixtures/textract-us-west-2.json';

const { TIMEOUT_MS } = vi.hoisted(() => ({ TIMEOUT_MS: 1000 }));
// A call that never returns fails an assertion, not the test's own timeout.
const CEILING_MS = 5000;
const SETTLED = 'the call settled before the ceiling';

vi.mock('../../../interfaces/ocr/common.js', async (original) => ({
    ...(await original<typeof import('../../../interfaces/ocr/common.js')>()),
    TEXTRACT_UPSTREAM_TIMEOUT_MS: TIMEOUT_MS,
}));

const ENDPOINT_ENV = 'AWS_ENDPOINT_URL_TEXTRACT';
const MODEL = findOcrModel('aws-textract')!;
const JSON_REPLY = { 'content-type': 'application/x-amz-json-1.1' };
// The upstream is scripted, so the bytes only have to be bytes.
const PAGE = Buffer.from('a scanned page');

let server: PuterServer;
let upstream: ScriptedUpstream<HttpAnswer>;
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
    upstream = await scriptedHttpUpstream();
    process.env[ENDPOINT_ENV] = upstream.url;
    // Textract is priced from AWS's public price list; serve the recording.
    vi.stubGlobal('fetch', async (input: string | URL | Request) =>
        String(input instanceof Request ? input.url : input).endsWith(
            '/AmazonTextract/current/us-west-2/index.json',
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
    new TextractOcrProvider(
        withAiCostFactor(
            server.services.metering,
            server.clients.event,
            'ai-ocr',
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
    const username = `textract-${Math.random().toString(36).slice(2, 10)}`;
    const user = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        requires_email_confirmation: false,
    });
    return makeActor({ user: { ...user, email_confirmed: true } });
};

/** A document sent to Textract as bytes. */
const uploaded = (): ResolvedFileInput => ({
    filename: 'page.png',
    fsEntry: null,
    load: async () => ({
        buffer: PAGE,
        filename: 'page.png',
        mimeType: 'image/png',
        fsEntry: null,
    }),
});

/** Pages billed to Textract, one entry per charge. */
const billedPages = () =>
    incrementUsageSpy.mock.calls
        .filter(([, usageType]) => usageType === TEXTRACT_PAGE_USAGE_TYPE)
        .map(([, , pages]) => pages);

const heldCredits = (actor: Actor) =>
    server.stores.creditHold.outstanding(actor.user.uuid!);

const recognize = (
    provider: TextractOcrProvider,
    input: ResolvedFileInput,
    actor: Actor,
) => provider.recognize(input, {}, MODEL, actor);

describe('TextractOcrProvider when AWS stops answering', () => {
    it('fails a request AWS takes and never answers as 504 upstream_timeout, uncharged', async () => {
        const actor = await makeUser();
        const provider = makeProvider();
        const started = Date.now();

        const call = callerError(
            () => recognize(provider, uploaded(), actor),
            actor,
        );

        expect(await settleWithin(call, CEILING_MS), SETTLED).toBe(true);
        expect(await call).toMatchObject({
            statusCode: 504,
            legacyCode: 'upstream_timeout',
        });
        expect(Date.now() - started).toBeGreaterThanOrEqual(TIMEOUT_MS - 10);
        // One request went out, and its connection was closed, not left open.
        expect(upstream.requests()).toBe(1);
        await vi.waitFor(() => expect(upstream.abandoned()).toBe(1));
        expect(billedPages()).toEqual([]);
        await vi.waitFor(async () => expect(await heldCredits(actor)).toBe(0));
    }, 15_000);

    it('fails a reply that starts and then stalls', async () => {
        const actor = await makeUser();
        const provider = makeProvider();
        upstream.answer((req, res) => {
            req.resume();
            res.writeHead(200, JSON_REPLY);
            res.write('{"Blocks":[');
        });

        const call = callerError(
            () => recognize(provider, uploaded(), actor),
            actor,
        );

        expect(await settleWithin(call, CEILING_MS), SETTLED).toBe(true);
        expect(await call).toMatchObject({
            statusCode: 504,
            legacyCode: 'upstream_timeout',
        });
        await vi.waitFor(() => expect(upstream.abandoned()).toBe(1));
        expect(billedPages()).toEqual([]);
    }, 15_000);

    it('does not upload the bytes when the S3 request times out', async () => {
        const actor = await makeUser();
        const provider = makeProvider();
        const load = vi.fn<ResolvedFileInput['load']>();
        const stored: ResolvedFileInput = {
            filename: 'page.png',
            fsEntry: {
                uuid: uuidv4(),
                path: '/someone/page.png',
                bucket: 'puter-test',
                bucketRegion: 'us-west-2',
                size: PAGE.length,
                sqlId: 1,
                userId: 1,
            },
            load,
        };

        const call = callerError(
            () => recognize(provider, stored, actor),
            actor,
        );

        expect(await settleWithin(call, CEILING_MS), SETTLED).toBe(true);
        expect(await call).toMatchObject({
            statusCode: 504,
            legacyCode: 'upstream_timeout',
        });
        expect(load).not.toHaveBeenCalled();
        expect(upstream.requests()).toBe(1);
    }, 15_000);

    it('reads and bills a reply that arrives inside the timeout', async () => {
        const actor = await makeUser();
        const provider = makeProvider();
        upstream.answer((req, res) => {
            req.resume();
            setTimeout(() => {
                res.writeHead(200, JSON_REPLY);
                res.end(
                    JSON.stringify({
                        Blocks: [
                            { BlockType: 'PAGE' },
                            {
                                BlockType: 'LINE',
                                Text: 'hello',
                                Confidence: 99,
                            },
                        ],
                    }),
                );
            }, 20);
        });

        const result = await withTestActor(
            () => recognize(provider, uploaded(), actor),
            actor,
        );

        expect(result.text).toBe('hello');
        expect(upstream.abandoned()).toBe(0);
        await vi.waitFor(() => expect(billedPages()).toEqual([1]));
    }, 15_000);
});
