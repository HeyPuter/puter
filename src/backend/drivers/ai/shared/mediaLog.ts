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

import { randomUUID } from 'node:crypto';
import type { EventClient } from '../../../clients/event/EventClient.js';
import type { AiMediaKind } from '../../../clients/event/types.js';
import type { Actor } from '../../../core/actor.js';
import { tieChargesToMediaLog } from '../../../util/aiCostFactor.js';

// Deep enough for every file field the media interfaces take.
const MAX_DEPTH = 4;

/**
 * A request as listeners record it: data URIs and byte buffers become a short
 * description, so a file's bytes never reach a log.
 */
export function loggedParameters(value: unknown, depth = 0): unknown {
    if (typeof value === 'string') {
        if (!value.startsWith('data:')) return value;
        const end = value.search(/[;,]/);
        const type = value.slice(5, end === -1 ? 5 : Math.min(end, 105));
        return `[data URI ${type || 'unknown'}, ${value.length} chars]`;
    }
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        return `[${value.byteLength} bytes]`;
    }
    if (!value || typeof value !== 'object' || depth >= MAX_DEPTH) return value;
    if (Array.isArray(value)) {
        return value.map((item) => loggedParameters(item, depth + 1));
    }
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
            key,
            loggedParameters(item, depth + 1),
        ]),
    );
}

/**
 * Reports one media request to `ai.log.media` listeners, before its upstream
 * call. The charges the request then records follow on `ai.log.media.cost`.
 */
export function emitMediaLog(
    events: EventClient,
    entry: {
        kind: AiMediaKind;
        actor: Actor;
        parameters: object;
        model: string | null;
        provider: string;
    },
): void {
    const completionId = randomUUID().replaceAll('-', '').slice(0, 25);
    events.emit(
        'ai.log.media',
        {
            kind: entry.kind,
            actor: entry.actor,
            completionId,
            parameters: loggedParameters(entry.parameters),
            model_used: entry.model,
            service_used: entry.provider,
        },
        {},
    );
    tieChargesToMediaLog(completionId);
}
