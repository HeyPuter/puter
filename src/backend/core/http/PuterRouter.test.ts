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

import type { RequestHandler } from 'express';
import { describe, expect, it } from 'vitest';
import { PuterRouter } from './PuterRouter.ts';
import type { RouteMethod } from './types';

const handler = (() => undefined) as unknown as RequestHandler;
const other = (() => undefined) as unknown as RequestHandler;

// Every verb the collector exposes, plus the WebDAV extensions.
const VERBS = [
    'all',
    'get',
    'head',
    'post',
    'put',
    'delete',
    'patch',
    'options',
    'lock',
    'unlock',
    'propfind',
    'proppatch',
    'mkcol',
    'copy',
    'move',
] as const;

describe('PuterRouter', () => {
    it('defaults to an empty prefix and no routes', () => {
        const router = new PuterRouter();
        expect(router.prefix).toBe('');
        expect(router.routes).toEqual([]);
    });

    it('keeps the prefix it was constructed with', () => {
        expect(new PuterRouter('/api/v2').prefix).toBe('/api/v2');
    });

    it.each(VERBS)(
        '%s(path, handler) records the method with empty options',
        (verb) => {
            const router = new PuterRouter();
            router[verb]('/thing', handler);
            expect(router.routes).toEqual([
                {
                    method: verb as RouteMethod,
                    path: '/thing',
                    options: {},
                    handler,
                },
            ]);
        },
    );

    it.each(VERBS)('%s(path, options, handler) carries the options', (verb) => {
        const router = new PuterRouter();
        const options = { subdomain: 'api', requireAuth: true } as const;
        router[verb]('/thing', options, handler as never);
        expect(router.routes[0]).toEqual({
            method: verb as RouteMethod,
            path: '/thing',
            options,
            handler,
        });
    });

    it('substitutes empty options when a nullish options argument is passed', () => {
        const router = new PuterRouter();
        router.get('/thing', undefined as never, handler as never);
        expect(router.routes[0]).toEqual({
            method: 'get',
            path: '/thing',
            options: {},
            handler,
        });
    });

    it('returns itself so registrations can chain', () => {
        const router = new PuterRouter();
        const returned = router.get('/a', handler).post('/b', handler);
        expect(returned).toBe(router);
        expect(
            router.routes.map((r) => `${r.method} ${String(r.path)}`),
        ).toEqual(['get /a', 'post /b']);
    });

    it('preserves registration order, including duplicate path+method pairs', () => {
        const router = new PuterRouter();
        router.get('/x', handler);
        router.get('/x', other);
        expect(router.routes).toHaveLength(2);
        expect(router.routes[0].handler).toBe(handler);
        expect(router.routes[1].handler).toBe(other);
    });

    describe('use', () => {
        it('use(handler) registers pathless global middleware', () => {
            const router = new PuterRouter();
            router.use(handler);
            expect(router.routes[0]).toEqual({
                method: 'use',
                options: {},
                handler,
            });
            expect(router.routes[0].path).toBeUndefined();
        });

        it('use(options, handler) stays pathless but keeps the options', () => {
            const router = new PuterRouter();
            const options = { bodyJson: true } as const;
            router.use(options, handler);
            expect(router.routes[0]).toEqual({
                method: 'use',
                options,
                handler,
            });
            expect(router.routes[0].path).toBeUndefined();
        });

        it('use(path, handler) treats a string first argument as the path', () => {
            const router = new PuterRouter();
            router.use('/mount', handler);
            expect(router.routes[0]).toEqual({
                method: 'use',
                path: '/mount',
                options: {},
                handler,
            });
        });

        it('use(path, handler) accepts a RegExp path', () => {
            const router = new PuterRouter();
            const path = /^\/mount/u;
            router.use(path, handler);
            expect(router.routes[0]).toMatchObject({
                method: 'use',
                path,
                options: {},
            });
        });

        it('use(path, handler) accepts an array of paths', () => {
            const router = new PuterRouter();
            router.use(['/a', '/b'], handler);
            expect(router.routes[0]).toMatchObject({
                method: 'use',
                path: ['/a', '/b'],
                options: {},
            });
        });

        it('use(path, options, handler) keeps both', () => {
            const router = new PuterRouter();
            const options = { subdomain: 'api' } as const;
            router.use('/mount', options, handler);
            expect(router.routes[0]).toEqual({
                method: 'use',
                path: '/mount',
                options,
                handler,
            });
        });

        it('substitutes empty options when the middle argument is nullish', () => {
            const router = new PuterRouter();
            router.use('/mount', undefined as never, handler);
            expect(router.routes[0]).toEqual({
                method: 'use',
                path: '/mount',
                options: {},
                handler,
            });
            const pathless = new PuterRouter();
            pathless.use(undefined as never, handler);
            expect(pathless.routes[0]).toEqual({
                method: 'use',
                options: {},
                handler,
            });
        });
    });
});
