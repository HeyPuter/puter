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
import { Controller, Post } from '../../core/http/decorators.js';
import { HttpError } from '../../core/http/HttpError.js';
import { PuterController } from '../types.js';

/** Both routes fire per interaction; the ceiling catches a loop, not a user. */
const MARK_ROUTE_OPTIONS = {
    subdomain: 'api',
    requireUserActor: true,
    allowFullAccessToken: true,
    rateLimit: {
        scope: 'notification-mark',
        limit: 300,
        window: 60_000,
        key: 'user',
    },
} as const;

/** The uid and owner a mark names, or the 400/401 the request earns. */
const markTarget = (req: Request): { uid: string; userId: number } => {
    const uid = req.body?.uid;
    if (typeof uid !== 'string' || uid.length === 0) {
        throw new HttpError(400, '`uid` must be a non-empty string', {
            legacyCode: 'bad_request',
        });
    }
    const userId = req.actor?.user?.id;
    if (!userId)
        throw new HttpError(401, 'Unauthorized', {
            legacyCode: 'unauthorized',
        });
    return { uid, userId };
};

/**
 * GUI-facing notification endpoints. Supplement the `puter-notifications`
 * driver (which handles reads via `/drivers/call`) with the mutations the puter
 * desktop client calls directly.
 *
 * Each goes through the NotificationService, which tells the user's other open
 * tabs (`notif.ack`, `notif.removed`) so they update immediately.
 */
@Controller('/notif')
export class NotificationController extends PuterController {
    /**
     * POST /notif/mark-ack — user dismissed a notification. Sets `acknowledged`
     * timestamp; pushes ack event to sockets.
     */
    @Post('/mark-ack', MARK_ROUTE_OPTIONS)
    async markAck(req: Request, res: Response): Promise<void> {
        const { uid, userId } = markTarget(req);
        await this.services.notification.markAcknowledged(uid, userId);
        res.json({});
    }

    /**
     * POST /notif/delete — user removed a notification from their history. A
     * uid naming none of their rows succeeds too: it is gone either way.
     */
    @Post('/delete', MARK_ROUTE_OPTIONS)
    async remove(req: Request, res: Response): Promise<void> {
        const { uid, userId } = markTarget(req);
        await this.services.notification.remove(uid, userId);
        res.json({});
    }
}
