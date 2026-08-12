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

import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../actor';
import { SYSTEM_ACTOR } from '../../actor';
import {
    EGRESS_COSTS,
    STORAGE_OP_COSTS,
} from '../../../services/metering/costs';
import type { UsageInput } from '../../../services/metering/types';
import { createEgressMeteringMiddleware } from './egressMetering';

const actor = (uuid = 'user-1'): Actor =>
    ({ user: { uuid, username: 'u' } }) as Actor;

/**
 * Response double that behaves like the parts of `http.ServerResponse` the
 * middleware touches: writes go somewhere, `close` is emitted once the response
 * is over, and headers are readable at that point.
 */
const makeRes = (headers: Record<string, string> = {}) => {
    const emitter = new EventEmitter();
    const written: unknown[] = [];
    const res = Object.assign(emitter, {
        write: vi.fn((chunk: unknown) => {
            written.push(chunk);
            return true;
        }),
        end: vi.fn((chunk?: unknown) => {
            if (chunk !== undefined && typeof chunk !== 'function')
                written.push(chunk);
            return res;
        }),
        getHeaders: () => headers,
    }) as unknown as Response & { written: unknown[] };
    return Object.assign(res, { written });
};

const run = (
    reqPartial: Partial<Request> & Record<string, unknown> = {},
    headers: Record<string, string> = {},
) => {
    const buffered: Array<{ actor: Actor; usages: UsageInput[] }> = [];
    const bufferIncrementUsages = vi.fn((a: Actor, usages: UsageInput[]) => {
        buffered.push({ actor: a, usages });
    });
    const middleware = createEgressMeteringMiddleware({
        services: { metering: { bufferIncrementUsages } },
    });

    const req = {
        subdomains: ['api'],
        actor: actor(),
        ...reqPartial,
    } as unknown as Request;
    const res = makeRes(headers);
    const next = vi.fn();
    middleware(req, res, next);

    return { req, res, next, buffered, bufferIncrementUsages };
};

const finish = (res: Response) => res.emit('close');

const usageOf = (usages: UsageInput[], usageType: string) =>
    usages.find((u) => u.usageType === usageType);

describe('createEgressMeteringMiddleware', () => {
    it('passes the request straight through', () => {
        const { next, res } = run();
        expect(next).toHaveBeenCalledOnce();
        // The write hooks must not swallow the payload.
        res.write(Buffer.from('abc'));
        res.end('de');
        expect((res as Response & { written: unknown[] }).written).toEqual([
            Buffer.from('abc'),
            'de',
        ]);
    });

    it('bills every byte written, plus the headers, at the response cost', () => {
        const { res, buffered } = run({}, { 'content-type': 'text/plain' });

        res.write(Buffer.alloc(1000));
        res.end(Buffer.alloc(24));
        finish(res);

        expect(buffered).toHaveLength(1);
        const egress = usageOf(buffered[0]!.usages, 'egress:bytes')!;
        // Header estimate is small but non-zero, so the total is a floor.
        expect(egress.usageAmount).toBeGreaterThan(1024);
        expect(egress.usageAmount).toBeLessThan(1100);
        expect(egress.costOverride).toBeCloseTo(
            EGRESS_COSTS['egress:bytes'] * egress.usageAmount,
            10,
        );
    });

    it('counts string chunks by their encoded length, not their character count', () => {
        const empty = run();
        finish(empty.res);
        const headerBytes = usageOf(
            empty.buffered[0]!.usages,
            'egress:bytes',
        )!.usageAmount;

        const { res, buffered } = run();
        res.end('déjà');
        finish(res);
        const withBody = usageOf(
            buffered[0]!.usages,
            'egress:bytes',
        )!.usageAmount;

        expect(withBody - headerBytes).toBe(Buffer.byteLength('déjà'));
    });

    it('meters a response that died mid-stream for what it managed to send', () => {
        const { res, buffered } = run();
        res.write(Buffer.alloc(500));
        // No end() — the connection dropped.
        finish(res);

        expect(
            usageOf(buffered[0]!.usages, 'egress:bytes')!.usageAmount,
        ).toBeGreaterThan(500);
    });

    it('bills the object-store requests made while serving the response', () => {
        const { req, res, buffered } = run();
        (req as Request).storageOps = { write: 3, read: 2, delete: 5 };
        res.end('x');
        finish(res);

        const usages = buffered[0]!.usages;
        expect(usageOf(usages, 'storage:write:ops')).toMatchObject({
            usageAmount: 3,
            costOverride: STORAGE_OP_COSTS['storage:write:ops'] * 3,
        });
        expect(usageOf(usages, 'storage:read:ops')).toMatchObject({
            usageAmount: 2,
        });
        // Removals are counted but free.
        expect(usageOf(usages, 'storage:delete:ops')).toMatchObject({
            usageAmount: 5,
            costOverride: 0,
        });
    });

    it('bills `egressActor` ahead of the requesting actor', () => {
        const owner = actor('owner-1');
        const { res, buffered } = run({
            subdomains: ['some-site'],
            actor: undefined,
            egressActor: owner,
        });
        res.end('hello');
        finish(res);

        expect(buffered[0]!.actor).toBe(owner);
    });

    it('meters a host it otherwise ignores once a billing target is named', () => {
        const { res, buffered } = run({
            subdomains: [],
            egressActor: actor('owner-1'),
        });
        res.end('hello');
        finish(res);

        expect(buffered).toHaveLength(1);
    });

    it('leaves first-party asset traffic unmetered', () => {
        for (const subdomains of [[], ['js'], ['docs']]) {
            const { res, bufferIncrementUsages } = run({ subdomains });
            res.end(Buffer.alloc(5_000_000));
            finish(res);
            expect(bufferIncrementUsages).not.toHaveBeenCalled();
        }
    });

    it('meters the dav surface alongside the api', () => {
        const { res, bufferIncrementUsages } = run({ subdomains: ['dav'] });
        res.end('hello');
        finish(res);
        expect(bufferIncrementUsages).toHaveBeenCalledOnce();
    });

    it('skips requests with no actor and the system actor', () => {
        for (const req of [
            { actor: undefined },
            { actor: { user: {} } as Actor },
            { actor: SYSTEM_ACTOR },
        ]) {
            const { res, bufferIncrementUsages } = run(req);
            res.end('hello');
            finish(res);
            expect(bufferIncrementUsages).not.toHaveBeenCalled();
        }
    });

    it('records nothing when metering is not installed', () => {
        const middleware = createEgressMeteringMiddleware({ services: {} });
        const req = {
            subdomains: ['api'],
            actor: actor(),
        } as unknown as Request;
        const res = makeRes();
        const next = vi.fn();

        middleware(req, res, next);
        res.end('hello');
        expect(() => finish(res)).not.toThrow();
        expect(next).toHaveBeenCalledOnce();
    });

    it('never lets a metering failure escape into the response path', () => {
        const bufferIncrementUsages = vi.fn(() => {
            throw new Error('metering down');
        });
        const middleware = createEgressMeteringMiddleware({
            services: { metering: { bufferIncrementUsages } },
        });
        const req = {
            subdomains: ['api'],
            actor: actor(),
        } as unknown as Request;
        const res = makeRes();

        middleware(req, res, vi.fn());
        res.end('hello');
        expect(() => finish(res)).not.toThrow();
    });
});
