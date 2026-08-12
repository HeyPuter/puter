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

import type { Request, RequestHandler, Response } from 'express';
import type { Actor } from '../../actor';
import { isSystemActor } from '../../actor';
import type { StorageOpClass } from '../../storageOps';
import {
    EGRESS_COSTS,
    STORAGE_OP_COSTS,
    STORAGE_OP_USAGE_TYPES,
} from '../../../services/metering/costs.js';
import type { UsageInput } from '../../../services/metering/types';
import '../expressAugmentation';

/**
 * Subset of the metering service this middleware needs. Metering is optional
 * from here — a deployment without it still serves traffic.
 */
interface MeteringLike {
    bufferIncrementUsages?: (actor: Actor, usages: UsageInput[]) => void;
}

interface Layers {
    services: { metering?: MeteringLike };
}

/**
 * Hosts whose responses are a user's own data or an account's app traffic, and
 * so are billed to that account. Everything else the origin serves — the
 * desktop shell, the SDK, the homepage, static assets — is Puter's own cost of
 * being reachable and is deliberately not charged to whoever happens to be
 * signed in while loading it.
 *
 * Hosted sites are not in here: they arrive on a per-site subdomain and opt in
 * by naming who to bill (`req.egressActor`).
 */
const METERED_SUBDOMAINS = new Set(['api', 'dav']);

/**
 * Rough size of the status line and headers, which never reach `res.write` and
 * so can only be estimated. Sized as `NAME: value\r\n` per header plus the
 * status line and the blank line that ends the block. Small next to any real
 * payload, but responses that are almost all headers (a 204, a redirect) are
 * common enough that ignoring it would under-count a chatty client by a wide
 * margin.
 */
const estimateHeaderBytes = (res: Response): number => {
    // "HTTP/1.1 200 OK\r\n" plus the "\r\n" that terminates the block.
    let bytes = 19;
    let headers: ReturnType<Response['getHeaders']>;
    try {
        headers = res.getHeaders();
    } catch {
        return bytes;
    }
    for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        const rendered = Array.isArray(value)
            ? value.join(', ')
            : String(value);
        bytes += name.length + rendered.length + 4;
    }
    return bytes;
};

const chunkBytes = (chunk: unknown, encoding: unknown): number => {
    if (typeof chunk === 'string') {
        return Buffer.byteLength(
            chunk,
            typeof encoding === 'string'
                ? (encoding as BufferEncoding)
                : 'utf8',
        );
    }
    if (chunk instanceof Uint8Array || Buffer.isBuffer(chunk)) {
        return chunk.byteLength;
    }
    return 0;
};

/** Who the response's bytes are billed to, or undefined if nobody. */
const resolveEgressActor = (req: Request): Actor | undefined => {
    const actor = req.egressActor ?? req.actor;
    if (!actor?.user?.uuid) return undefined;
    if (isSystemActor(actor)) return undefined;
    return actor;
};

const isMeteredHost = (req: Request): boolean => {
    // An explicit billing target is the opt-in for hosts that aren't metered
    // by default, so honour it whatever the subdomain says.
    if (req.egressActor) return true;
    const subdomain = req.subdomains?.[req.subdomains.length - 1];
    return !!subdomain && METERED_SUBDOMAINS.has(subdomain);
};

const storageOpUsages = (req: Request): UsageInput[] => {
    const ops = req.storageOps;
    if (!ops) return [];
    const usages: UsageInput[] = [];
    for (const [opClass, count] of Object.entries(ops)) {
        if (!count || count <= 0) continue;
        const usageType = STORAGE_OP_USAGE_TYPES[opClass as StorageOpClass];
        if (!usageType) continue;
        usages.push({
            usageType,
            usageAmount: count,
            costOverride: STORAGE_OP_COSTS[usageType] * count,
        });
    }
    return usages;
};

/**
 * Meters what a request actually costs to serve: every byte written back to the
 * client, plus the object-store requests made on its behalf.
 *
 * This is the only place egress is counted. Handlers that stream file content
 * used to meter their own bytes, which measured the payload they handed to
 * express rather than what left the process, missed every other response, and
 * charged an increment per download. Counting here instead means one rule for
 * all traffic, and bytes counted after compression has had its say.
 *
 * Install FIRST, ahead of the compression middleware: middleware that wraps
 * `res.write` later ends up wrapping this one, so anything installed after
 * compression sees the payload before it is compressed. The actor is read at
 * the end of the response rather than here, by which time the auth probe has
 * run.
 *
 * Never rejects, never delays the response: increments are handed to metering
 * once the response is over, and metering buffers them rather than writing per
 * request.
 */
export const createEgressMeteringMiddleware = (
    layers: Layers,
): RequestHandler => {
    return (req, res, next) => {
        const metering = layers.services.metering;
        if (!metering?.bufferIncrementUsages) {
            next();
            return;
        }

        let bodyBytes = 0;

        const write = res.write.bind(res);
        const end = res.end.bind(res);

        res.write = ((
            chunk: unknown,
            encoding?: unknown,
            callback?: unknown,
        ) => {
            bodyBytes += chunkBytes(chunk, encoding);
            return (write as (...args: unknown[]) => boolean)(
                chunk,
                encoding,
                callback,
            );
        }) as Response['write'];

        res.end = ((
            chunk?: unknown,
            encoding?: unknown,
            callback?: unknown,
        ) => {
            // `end()` also takes a callback in the first or second slot.
            if (typeof chunk !== 'function') {
                bodyBytes += chunkBytes(chunk, encoding);
            }
            return (end as (...args: unknown[]) => Response)(
                chunk,
                encoding,
                callback,
            );
        }) as Response['end'];

        // 'close' rather than 'finish': it fires for a response that completed
        // AND for one whose connection died mid-stream, and an aborted download
        // still sent whatever it sent.
        res.once('close', () => {
            try {
                if (!isMeteredHost(req)) return;
                const actor = resolveEgressActor(req);
                if (!actor) return;

                const usages = storageOpUsages(req);
                const bytes = bodyBytes + estimateHeaderBytes(res);
                if (bytes > 0) {
                    usages.push({
                        usageType: 'egress:bytes',
                        usageAmount: bytes,
                        costOverride: EGRESS_COSTS['egress:bytes'] * bytes,
                    });
                }
                if (usages.length === 0) return;

                metering.bufferIncrementUsages!(actor, usages);
            } catch (e) {
                // Metering is never worth failing a request that already
                // succeeded over.
                console.warn(
                    `[metering] egress metering failed: ${(e as Error).message}`,
                );
            }
        });

        next();
    };
};
