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

import type { Request, Response } from 'express';
import { CALL_GROUP_PATTERN } from '../../clients/alarm/severity.js';
import { HttpError } from '../../core/http/HttpError.js';
import { Controller, Get } from '../../core/http/decorators.js';
import type { ActiveCall } from '../../services/alarm/AlarmCallService.js';
import { PuterController } from '../types.js';

// Monitors tend to keep a failing response only while it is short.
const MAX_BODY_LENGTH = 480;
const MAX_LINE_MESSAGE = 120;

@Controller('/alarms')
export class AlarmController extends PuterController {
    /**
     * GET /alarms/calls?group= — for an uptime monitor to turn into a phone
     * call: 503 while an alarm in `group` (any group when omitted) is calling,
     * or when the listing couldn't be finished, 200 otherwise. The body is
     * plain text, one line per call.
     */
    @Get('/calls', {
        subdomain: 'api',
        internalAuth: (config) => config.pager?.calls?.secret,
        // The secret gates the route; this only bounds guessing.
        rateLimit: {
            scope: 'alarm-calls',
            limit: 600,
            window: 60_000,
            key: 'ip',
        },
    })
    async listCalls(req: Request, res: Response): Promise<void> {
        const { calls, complete } = await this.services.alarmCalls.listActive(
            parseGroup(req.query.group),
        );
        res.set('Cache-Control', 'no-store');
        res.type('text/plain');
        res.status(calls.length > 0 || !complete ? 503 : 200).send(
            formatCalls(calls, complete),
        );
    }
}

function parseGroup(raw: unknown): string | undefined {
    if (raw === undefined) return undefined;
    if (typeof raw === 'string' && CALL_GROUP_PATTERN.test(raw)) return raw;
    throw new HttpError(400, 'Invalid `group`', { legacyCode: 'bad_request' });
}

/** An incomplete listing reads as at least what it found. */
export function formatCalls(calls: ActiveCall[], complete = true): string {
    if (calls.length === 0) {
        return complete ? 'no active calls' : 'call listing incomplete';
    }

    const count = `${calls.length}${complete ? '' : '+'}`;
    let body = `${count} active call${calls.length === 1 ? '' : 's'}`;
    for (const [i, call] of calls.entries()) {
        const message =
            call.message.length > MAX_LINE_MESSAGE
                ? `${call.message.slice(0, MAX_LINE_MESSAGE - 1)}…`
                : call.message;
        const repeat = call.count > 1 ? ` (x${call.count})` : '';
        const where = call.links[0] ?? call.shortId;
        const line = `\n[${call.group}] ${message}${repeat} ${where}`;
        const more = `\n+${calls.length - i} more`;
        if (body.length + line.length + more.length > MAX_BODY_LENGTH) {
            return body + more;
        }
        body += line;
    }
    return body;
}
