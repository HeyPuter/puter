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

import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { Context } from '../../context';
import { createRequestContextMiddleware } from './requestContext';

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('createRequestContextMiddleware', () => {
    it("snapshots req.actor into Context so downstream code can read it via Context.get('actor')", () => {
        const middleware = createRequestContextMiddleware();
        const req = {
            actor: { user: { uuid: 'u-1' } },
        } as unknown as Request;

        let actorInside: unknown;
        let reqInside: unknown;
        let requestIdInside: unknown;
        middleware(req, {} as Response, () => {
            actorInside = Context.get('actor');
            reqInside = Context.get('req');
            requestIdInside = Context.get('requestId');
        });

        expect(actorInside).toBe(req.actor);
        expect(reqInside).toBe(req);
        expect(typeof requestIdInside).toBe('string');
        expect(requestIdInside as string).toMatch(UUID_REGEX);
    });

    it('mints a fresh requestId per call — two requests get distinct ids', () => {
        const middleware = createRequestContextMiddleware();
        const seen: string[] = [];
        for (let i = 0; i < 2; i++) {
            middleware({} as Request, {} as Response, () => {
                seen.push(Context.get('requestId') as string);
            });
        }
        expect(seen[0]).not.toBe(seen[1]);
        expect(seen[0]).toMatch(UUID_REGEX);
        expect(seen[1]).toMatch(UUID_REGEX);
    });

    it("propagates context through async/await boundaries (it's AsyncLocalStorage-backed)", async () => {
        const middleware = createRequestContextMiddleware();
        const req = { actor: { user: { uuid: 'async-user' } } } as unknown as Request;

        let actorAfterAwait: unknown;
        await new Promise<void>((resolve) => {
            middleware(req, {} as Response, async () => {
                // Yield to the microtask queue — a naive `let` wouldn't survive this.
                await Promise.resolve();
                actorAfterAwait = Context.get('actor');
                resolve();
            });
        });
        expect(actorAfterAwait).toBe(req.actor);
    });

    it("leaves Context undefined outside the request scope (no leakage)", () => {
        // Context is only set inside the runWithContext callback. Outside,
        // accessing it must return undefined — otherwise we'd leak request
        // state across requests.
        const middleware = createRequestContextMiddleware();
        middleware(
            { actor: { user: { uuid: 'u' } } } as unknown as Request,
            {} as Response,
            () => {},
        );
        expect(Context.get('actor')).toBeUndefined();
        expect(Context.current()).toBeUndefined();
    });
});
