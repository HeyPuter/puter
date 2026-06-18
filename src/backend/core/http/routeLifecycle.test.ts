/**
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
import { describe, expect, it } from 'vitest';
import { EventClient } from '../../clients/event/EventClient';
import type {
    EventMap,
    RouteLifecycleEvent,
} from '../../clients/event/types';
import type { IConfig } from '../../types';
import {
    createRouteLifecycleMiddleware,
    pathKeySegment,
    routeEventKeyBase,
} from './routeLifecycle';

// -- Fakes --
//
// EventClient is a pure in-memory bus (no external deps), so we use the real
// one and register real listeners. The request/response are the boundary we
// fake: a minimal `res` that is an EventEmitter (for `finish`/`close`) and
// records status/body.

const makeEvents = () => new EventClient({} as IConfig);

class FakeRes extends EventEmitter {
    statusCode = 200;
    writableFinished = false;
    headersSent = false;
    body: unknown;
    status(code: number) {
        this.statusCode = code;
        return this;
    }
    json(b: unknown) {
        this.body = b;
        return this;
    }
}

const makeReq = (actorUuid?: string): Request =>
    ({
        actor: actorUuid ? { user: { uuid: actorUuid } } : undefined,
    }) as unknown as Request;

// Collect every emit on a given key into an array for assertions.
const record = (events: EventClient, key: keyof EventMap) => {
    const seen: RouteLifecycleEvent[] = [];
    events.on(key as never, (_k, data) =>
        seen.push(data as RouteLifecycleEvent),
    );
    return seen;
};

const POST = 'post' as const;
const PATH = '/fs/completeBatchWrite';
const BASE = 'route.post.fs.completeBatchWrite';

describe('pathKeySegment', () => {
    it('joins path parts with dots and drops slashes', () => {
        expect(pathKeySegment('/fs/completeBatchWrite')).toBe(
            'fs.completeBatchWrite',
        );
    });

    it('strips the leading colon from path params', () => {
        expect(pathKeySegment('/foo/:id')).toBe('foo.id');
    });

    it('maps the root path and non-string paths to placeholders', () => {
        expect(pathKeySegment('/')).toBe('root');
        expect(pathKeySegment(/^\/x/)).toBe('_');
    });
});

describe('routeEventKeyBase', () => {
    it('scopes the key to method + normalized path', () => {
        expect(routeEventKeyBase(POST, PATH)).toBe(BASE);
    });
});

describe('createRouteLifecycleMiddleware', () => {
    it('emits before, then after on a clean finish', async () => {
        const events = makeEvents();
        const before = record(events, `${BASE}.before` as keyof EventMap);
        const after = record(events, `${BASE}.after` as keyof EventMap);
        const error = record(events, `${BASE}.error` as keyof EventMap);

        const mw = createRouteLifecycleMiddleware(events, POST, PATH);
        const req = makeReq('u-1');
        const res = new FakeRes();
        let nextCalled = false;

        await mw(req, res as unknown as Response, () => {
            nextCalled = true;
        });

        expect(nextCalled).toBe(true);
        expect(before).toHaveLength(1);
        expect(before[0]).toMatchObject({
            phase: 'before',
            method: 'post',
            path: PATH,
            actor: { user: { uuid: 'u-1' } },
            actorUid: 'user:u-1',
        });
        // The live req/res are exposed so listeners can read the body or
        // respond themselves.
        expect(before[0].req).toBe(req);
        expect(before[0].res).toBe(res);

        res.statusCode = 200;
        res.writableFinished = true;
        res.emit('finish');

        expect(after).toHaveLength(1);
        expect(after[0]).toMatchObject({ phase: 'after', statusCode: 200 });
        expect(typeof after[0].durationMs).toBe('number');
        expect(error).toHaveLength(0);
    });

    it('emits error (not after) when the response is a 5xx', async () => {
        const events = makeEvents();
        const after = record(events, `${BASE}.after` as keyof EventMap);
        const error = record(events, `${BASE}.error` as keyof EventMap);

        const mw = createRouteLifecycleMiddleware(events, POST, PATH);
        const res = new FakeRes();
        await mw(makeReq(), res as unknown as Response, () => {});

        res.statusCode = 500;
        res.writableFinished = true;
        res.emit('finish');

        expect(after).toHaveLength(0);
        expect(error).toHaveLength(1);
        expect(error[0]).toMatchObject({ phase: 'error', statusCode: 500 });
    });

    it('emits error when the connection closes without finishing (abort)', async () => {
        const events = makeEvents();
        const error = record(events, `${BASE}.error` as keyof EventMap);

        const mw = createRouteLifecycleMiddleware(events, POST, PATH);
        const res = new FakeRes();
        await mw(makeReq(), res as unknown as Response, () => {});

        res.writableFinished = false;
        res.emit('close');

        expect(error).toHaveLength(1);
        expect(error[0].phase).toBe('error');
        expect(error[0].error).toBeInstanceOf(Error);
    });

    it('emits a terminal event only once across finish + close', async () => {
        const events = makeEvents();
        const after = record(events, `${BASE}.after` as keyof EventMap);
        const error = record(events, `${BASE}.error` as keyof EventMap);

        const mw = createRouteLifecycleMiddleware(events, POST, PATH);
        const res = new FakeRes();
        await mw(makeReq(), res as unknown as Response, () => {});

        res.statusCode = 200;
        res.writableFinished = true;
        res.emit('finish');
        res.emit('close');

        expect(after).toHaveLength(1);
        expect(error).toHaveLength(0);
    });

    it('vetoes the request when a before listener sets allow=false', async () => {
        const events = makeEvents();
        events.on(`${BASE}.before` as never, (_k, data) => {
            (data as RouteLifecycleEvent).allow = false;
            (data as RouteLifecycleEvent).rejectReason = 'quota exceeded';
        });
        const reject = record(events, `${BASE}.reject` as keyof EventMap);
        const after = record(events, `${BASE}.after` as keyof EventMap);

        const mw = createRouteLifecycleMiddleware(events, POST, PATH);
        const res = new FakeRes();
        let nextCalled = false;
        await mw(makeReq('u-9'), res as unknown as Response, () => {
            nextCalled = true;
        });

        expect(nextCalled).toBe(false);
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({
            error: { code: 'forbidden', message: 'quota exceeded' },
        });
        expect(reject).toHaveLength(1);
        expect(reject[0]).toMatchObject({
            phase: 'reject',
            statusCode: 403,
            rejectReason: 'quota exceeded',
        });
        // A vetoed request never runs, so no terminal after fires.
        res.emit('finish');
        expect(after).toHaveLength(0);
    });

    it('treats a listener-sent response as a terminal after (not a reject) with the real status', async () => {
        const events = makeEvents();
        events.on(`${BASE}.before` as never, (_k, data) => {
            // Listener answers the request itself without vetoing.
            const e = data as RouteLifecycleEvent;
            (e.res as unknown as FakeRes).headersSent = true;
            e.res.status(418).json({ teapot: true });
        });
        const reject = record(events, `${BASE}.reject` as keyof EventMap);
        const after = record(events, `${BASE}.after` as keyof EventMap);

        const mw = createRouteLifecycleMiddleware(events, POST, PATH);
        const res = new FakeRes();
        let nextCalled = false;
        await mw(makeReq(), res as unknown as Response, () => {
            nextCalled = true;
        });

        expect(nextCalled).toBe(false);
        // Listener's own 418 stands; the middleware doesn't clobber it with 403.
        expect(res.statusCode).toBe(418);
        expect(res.body).toEqual({ teapot: true });
        // Not a veto, so no reject — a terminal `after` keyed off the real 418.
        expect(reject).toHaveLength(0);
        expect(after).toHaveLength(1);
        expect(after[0]).toMatchObject({ phase: 'after', statusCode: 418 });
    });
});
