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

import { createHash } from 'node:crypto';
import type { AlarmCall } from '../../clients/alarm/types';
import type { PagerSeverity } from '../../types';
import { BoundedTtlMap } from '../../util/boundedTtlMap';
import { PuterService } from '../types';

const PARTITION = 'alarmCalls';
export const DEFAULT_CALL_TTL_MS = 30 * 60 * 1000;
/** Comfortably above the alarm client's one-minute refresh of an open call. */
export const MIN_CALL_TTL_MS = 5 * 60 * 1000;
export const MAX_LISTED_CALLS = 50;
/**
 * Listing pages to read through expired rows the store hasn't swept yet. Each
 * page reads up to `MAX_LISTED_CALLS` rows per round trip.
 */
const MAX_LIST_ROUNDS = 5;
const MAX_MESSAGE_LENGTH = 200;
const MAX_REFRESH_ENTRIES = 1000;

export interface ActiveCall {
    group: string;
    id: string;
    shortId: string;
    message: string;
    severity: PagerSeverity;
    /** Occurrences seen by the node that last refreshed the call. */
    count: number;
    links: string[];
    /** Epoch ms of the occurrence that last refreshed the call. */
    at: number;
}

export interface ActiveCalls {
    calls: ActiveCall[];
    /** False when the listing gave up before reading every row. */
    complete: boolean;
}

/**
 * Keeps alarms that phone someone in the system KV store, where any node can
 * list them, until they go quiet for `pager.calls.ttlMs`.
 */
export class AlarmCallService extends PuterService {
    #ttlMs: number;
    // Key -> links last written. A hot alarm reports far more often than its
    // record needs refreshing; a new link is written straight away.
    #written: BoundedTtlMap<string, string>;

    // Registered at construction rather than on start, so alarms the stores
    // raise while starting up can call too.
    constructor(...args: ConstructorParameters<typeof PuterService>) {
        super(...args);
        const calls = this.config.pager?.calls;
        this.#ttlMs = callTtlMs(calls?.ttlMs);
        this.#written = new BoundedTtlMap({
            maxEntries: MAX_REFRESH_ENTRIES,
            ttlMs: this.#ttlMs / 3,
        });
        if (!calls?.rules) return;
        // Nothing can read a call without the secret, so don't record any.
        if (!calls.secret) {
            console.warn('[alarm] pager.calls has rules but no secret');
            return;
        }
        this.clients.alarm.addCallHandler((call) => this.record(call));
    }

    async record({ group, alert, links }: AlarmCall): Promise<void> {
        // Ids embed users and keys and can outgrow a KV key; the group prefix
        // is what listing filters on.
        const idHash = createHash('sha256')
            .update(alert.id)
            .digest('hex')
            .slice(0, 32);
        const key = `${group}:${idHash}`;
        const linkSignature = links.join(' ');
        if (this.#written.get(key) === linkSignature) return;

        const now = Date.now();
        const value: ActiveCall = {
            group,
            id: alert.id,
            shortId: alert.shortId,
            message: alert.message.slice(0, MAX_MESSAGE_LENGTH),
            severity: alert.severity,
            count: alert.repeatCount,
            links,
            at: now,
        };
        await this.stores.kv.set(
            { key, value, expireAt: Math.ceil((now + this.#ttlMs) / 1000) },
            { systemPartition: PARTITION },
        );
        this.#written.set(key, linkSignature);
    }

    /** Active calls, newest first; all groups when `group` is omitted. */
    async listActive(group?: string): Promise<ActiveCalls> {
        const calls: ActiveCall[] = [];
        let cursor: string | undefined;
        for (let round = 0; round < MAX_LIST_ROUNDS; round++) {
            const { res } = await this.stores.kv.list(
                {
                    as: 'values',
                    limit: MAX_LISTED_CALLS - calls.length,
                    fetchUntilFull: true,
                    ...(cursor ? { cursor } : {}),
                    ...(group ? { keyPrefix: `${group}:` } : {}),
                },
                { systemPartition: PARTITION },
            );
            const page = res as { items: ActiveCall[]; cursor?: string };
            calls.push(...page.items);
            cursor = page.cursor;
            if (!cursor || calls.length >= MAX_LISTED_CALLS) {
                return { calls: newestFirst(calls), complete: true };
            }
        }
        console.warn(
            `[alarm] listing calls${group ? ` for ${group}` : ''} stopped after ${MAX_LIST_ROUNDS} rounds`,
        );
        return { calls: newestFirst(calls), complete: false };
    }
}

const newestFirst = (calls: ActiveCall[]): ActiveCall[] =>
    calls.sort((a, b) => b.at - a.at);

/** The configured ttl, defaulted, and floored at `MIN_CALL_TTL_MS`. */
const callTtlMs = (value: number | undefined): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.max(value, MIN_CALL_TTL_MS)
        : DEFAULT_CALL_TTL_MS;
