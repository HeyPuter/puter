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

import type { Request, RequestHandler } from 'express';
import { actorUid } from '../actor';
import type { EventClient } from '../../clients/event/EventClient';
import type { RouteMethod } from './types';

type RoutePathValue = string | RegExp | Array<string | RegExp> | undefined;

/**
 * Normalize a route path into a dot-separated key segment so lifecycle events
 * can be scoped per endpoint. Strips slashes and param markers so the key is
 * stable (`/drivers/call` -> `drivers.call`, `/foo/:id` -> `foo.id`).
 * Non-string paths (RegExp / arrays) collapse to a single `_` placeholder.
 */
export const pathKeySegment = (fullPath: RoutePathValue): string => {
    if (typeof fullPath !== 'string') return '_';
    const seg = fullPath
        .split('/')
        .filter(Boolean)
        .map((p) => p.replace(/^:/, '').replace(/[^A-Za-z0-9_-]/g, '_'))
        .join('.');
    return seg || 'root';
};

/**
 * Scoped event-key base for a route: `route.<method>.<normalized-path>`.
 * Callers append `.before` / `.after` / `.error` / `.reject`.
 */
export const routeEventKeyBase = (
    method: RouteMethod,
    fullPath: RoutePathValue,
): `route.${string}` => `route.${method}.${pathKeySegment(fullPath)}`;

/**
 * Build the per-endpoint lifecycle middleware for one route.
 *
 * On each request it: emits `before` (awaited, so a listener may veto by
 * setting `allow = false`), times the handler, and emits a single terminal
 * event when the response finishes or the connection closes — `after` on a
 * clean response, `error` on an abort or a >=500, `reject` only when a
 * listener vetoes (it then answers 403 and the handler never runs). A listener
 * that writes its own response without vetoing terminates as `after`/`error`
 * keyed off the real status, not `reject`.
 *
 * Subscribers can listen on `route.*`, `route.<method>.*`, or the exact key.
 */
export const createRouteLifecycleMiddleware = (
    events: EventClient,
    method: RouteMethod,
    fullPath: RoutePathValue,
): RequestHandler => {
    const pathLabel =
        typeof fullPath === 'string' ? fullPath : String(fullPath);
    const keyBase = routeEventKeyBase(method, fullPath);

    return async (req: Request, res, next) => {
        const actor = req.actor ? actorUid(req.actor) : undefined;
        const startedAt = Date.now();
        const base = {
            method,
            path: pathLabel,
            req,
            res,
            actor: req.actor,
            actorUid: actor,
        };

        const beforeEvent = {
            phase: 'before' as const,
            ...base,
            allow: true as boolean,
            rejectReason: undefined as string | undefined,
        };
        await events.emitAndWait(`${keyBase}.before`, beforeEvent, {});

        // Explicit veto: a listener set `allow = false`. Emit `reject` and
        // answer 403 — unless the listener already wrote its own response, in
        // which case we report that status rather than a misleading 403.
        if (beforeEvent.allow === false) {
            events.emit(
                `${keyBase}.reject`,
                {
                    phase: 'reject',
                    ...base,
                    statusCode: res.headersSent ? res.statusCode : 403,
                    durationMs: Date.now() - startedAt,
                    rejectReason: beforeEvent.rejectReason,
                },
                {},
            );
            if (!res.headersSent) {
                res.status(403).json({
                    error: {
                        code: 'forbidden',
                        message:
                            beforeEvent.rejectReason ?? 'Blocked by policy',
                    },
                });
            }
            return;
        }

        // A listener answered the request itself without vetoing (it wrote a
        // response in the `before` hook). That's a normal terminal outcome,
        // not a reject — emit `after`/`error` keyed off the real status.
        if (res.headersSent) {
            const statusCode = res.statusCode;
            const isError = statusCode >= 500;
            events.emit(
                `${keyBase}.${isError ? 'error' : 'after'}`,
                {
                    phase: isError ? 'error' : 'after',
                    ...base,
                    statusCode,
                    durationMs: Date.now() - startedAt,
                },
                {},
            );
            return;
        }

        let settled = false;
        const settle = (aborted: boolean) => {
            if (settled) return;
            settled = true;
            const statusCode = res.statusCode;
            const isError = aborted || statusCode >= 500;
            events.emit(
                `${keyBase}.${isError ? 'error' : 'after'}`,
                {
                    phase: isError ? 'error' : 'after',
                    ...base,
                    statusCode,
                    durationMs: Date.now() - startedAt,
                    ...(aborted ? { error: new Error('request aborted') } : {}),
                },
                {},
            );
        };
        res.once('finish', () => settle(false));
        res.once('close', () => settle(!res.writableFinished));
        next();
    };
};
