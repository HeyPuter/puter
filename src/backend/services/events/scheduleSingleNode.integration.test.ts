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

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    bootScheduleHarness,
    type ScheduleHarness,
} from './scheduleTestUtil.js';
import type { ScheduleEvent } from './workerSeam.js';

/**
 * A self-hosted single node: sqlite, the in-process Redis, and the local worker
 * runtime. A schedule fires its handler for real, which reports the event it
 * was handed to a sink. Needs `npm run build:workerLib`.
 */

const BOOT_TIMEOUT_MS = 180_000;
const REPORT_SOURCE = `async ({ event, ctx, fetch }) => {
    await fetch(ctx.sink, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event }),
    });
}`;

let h: ScheduleHarness;
let sink: http.Server;
let sinkUrl: string;
const received: ScheduleEvent[] = [];

beforeAll(async () => {
    sink = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
            received.push(
                (
                    JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
                        event: ScheduleEvent;
                    }
                ).event,
            );
            res.writeHead(200).end();
        });
    });
    await new Promise<void>((resolve) =>
        sink.listen(0, '127.0.0.1', () => resolve()),
    );
    sinkUrl = `http://127.0.0.1:${(sink.address() as AddressInfo).port}/`;
    h = await bootScheduleHarness(
        { invokeTimeoutMs: 20_000 },
        { localWorkers: true },
    );
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await h?.shutdown();
    await new Promise((resolve) => sink?.close(resolve));
});

describe('a single node', () => {
    it('fires a schedule through the in-process worker runtime', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const app = await h.makeApp();
        await h.env.server.stores.eventHandler.publish({
            appUid: app.uid,
            name: 'report',
            source: REPORT_SOURCE,
        });
        const startAt = Math.ceil((Date.now() + 1500) / 1000) * 1000;
        const row = await h.createSchedule(app, {
            kind: 'once',
            startAt,
            everyMs: null,
            handlerName: 'report',
            context: JSON.stringify({ sink: sinkUrl }),
        });
        const offset = (await h.env.server.stores.scheduleIndex.getDef(
            row.uid,
        ))!.def!.offsetMs;
        await new Promise((resolve) =>
            setTimeout(resolve, startAt + offset + 1500 - Date.now()),
        );

        await h.fire();
        await vi.waitFor(() => expect(received).toHaveLength(1), {
            timeout: 30_000,
        });
        expect(received[0]).toMatchObject({
            subject: `schedule:${row.uid}`,
            op: 'tick',
            id: `${row.uid}:${startAt}`,
            scheduledFor: startAt,
            attempt: 1,
        });
        expect(received[0].firedAt).toBeGreaterThanOrEqual(startAt);
        expect(
            await h.env.server.stores.schedule.get(
                h.env.server.services.schedule.namespace,
                row.uid,
            ),
        ).toMatchObject({ state: 'done', endReason: 'ended' });
        vi.restoreAllMocks();
    }, 120_000);
});
