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
import { Readable } from 'node:stream';
import type { puterClients } from '../../../clients';
import type { puterServices } from '../../../services';
import type { puterStores } from '../../../stores';
import type { IConfig, LayerInstances } from '../../../types';

interface Layers {
    clients: LayerInstances<typeof puterClients>;
    stores: LayerInstances<typeof puterStores>;
    services: LayerInstances<typeof puterServices>;
}

// Local analogue of the production `<name>.puter.work` worker domain. Requests
// to `<name>.workers.puter.localhost` are dispatched into a Miniflare instance
// by `LocalWorkerService`, which mirrors the real Cloudflare dispatch path.
const WORKER_HOST_SUFFIX = 'workers.puter.localhost';

// Minimal WHATWG-Response shape we consume from Miniflare's `dispatchFetch`.
// It isn't the Node global `Response`, so we type it structurally rather than
// importing Miniflare's classes into the HTTP layer.
interface FetchResponse {
    status: number;
    headers: { forEach(cb: (value: string, key: string) => void): void };
    body: ReadableStream<Uint8Array> | null;
}

function normalizeHost(value: string | undefined | null): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().toLowerCase().replace(/^\./, '');
    if (!trimmed) return null;
    return trimmed.split(':')[0] || null;
}

// `<name>.workers.puter.localhost` → `name`. Returns null for the bare zone or
// any host outside it. Flip this if your dev DNS puts the name elsewhere.
function workerNameFromHost(host: string): string | null {
    if (host === WORKER_HOST_SUFFIX) return null;
    if (!host.endsWith(`.${WORKER_HOST_SUFFIX}`)) return null;
    const prefix = host.slice(0, host.length - WORKER_HOST_SUFFIX.length - 1);
    return prefix.split('.')[0] || null;
}

// Express (Node) request → WHATWG Request the Worker's `fetch(request)` sees.
// Must run BEFORE any body-parsing middleware so `req` is still an unconsumed
// stream; otherwise the Worker gets an empty body on POST/PUT.
function toFetchRequest(req: Parameters<RequestHandler>[0]): Request {
    const url = `http://${req.headers.host ?? WORKER_HOST_SUFFIX}${req.originalUrl}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) {
            for (const v of value) headers.append(key, v);
        } else if (value != null) {
            headers.set(key, value);
        }
    }

    const method = (req.method ?? 'GET').toUpperCase();
    const hasBody = method !== 'GET' && method !== 'HEAD';

    return new Request(url, {
        method,
        headers,
        // `duplex: 'half'` is required by undici whenever a stream body is set.
        body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
        ...(hasBody ? { duplex: 'half' } : {}),
    } as RequestInit);
}

// WHATWG Response from the Worker → Express response.
function sendFetchResponse(
    res: Parameters<RequestHandler>[1],
    response: FetchResponse,
): void {
    res.status(response.status);
    response.headers.forEach((value, key) => {
        // Node manages framing headers itself; forwarding them corrupts the
        // response (double content-length, stale transfer-encoding).
        const lower = key.toLowerCase();
        if (lower === 'content-length' || lower === 'transfer-encoding') return;
        res.setHeader(key, value);
    });

    if (!response.body) {
        res.end();
        return;
    }

    const nodeStream = Readable.fromWeb(response.body as never);
    nodeStream.on('error', () => res.destroy());
    nodeStream.pipe(res);
}

/**
 * Serves local Workers on `*.workers.puter.localhost` by dispatching into
 * Miniflare via `LocalWorkerService`. No-op unless `config.workers.localServer`
 * is set — production keeps hitting real Cloudflare through `WorkerDriver`.
 *
 * Mount this BEFORE the body-parsing middleware in `server.ts` so the Worker
 * receives the raw request stream.
 */
export const createLocalWorkerProxyMiddleware = (
    config: IConfig,
    layers: Layers,
): RequestHandler => {
    if (!config.workers?.localServer) {
        return (_req, _res, next) => next();
    }

    const localWorkerService = layers.services.localworkerservice;

    return async (req, res, next) => {
        const host = normalizeHost(req.hostname);
        if (!host) return next();

        const workerName = workerNameFromHost(host);
        if (!workerName) return next();

        try {
            const fetchRequest = toFetchRequest(req);
            const response = (await localWorkerService.cfCallLocal(
                workerName,
                fetchRequest,
            )) as unknown as FetchResponse;
            sendFetchResponse(res, response);
        } catch (err) {
            next(err);
        }
    };
};
