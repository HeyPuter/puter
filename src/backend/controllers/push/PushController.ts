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
import type { Actor } from '../../core/actor.js';
import { Controller, Delete, Get, Post } from '../../core/http/decorators.js';
import { HttpError } from '../../core/http/HttpError.js';
import { bodyRecord } from '../../core/http/requestBody.js';
import { NOTIFICATIONS_PUSH_PERMISSION } from '../../services/push/pushConsent.js';
import {
    PUSH_DEVICE_LABEL_MAX_LENGTH,
    PUSH_DEVICE_USER_AGENT_MAX_LENGTH,
    type PushDevice,
    type PushPlatform,
} from '../../stores/push/PushDeviceStore.js';
import { getAppIconUrl } from '../../util/appIcon.js';
import { PuterController } from '../types.js';

const PLATFORMS: ReadonlySet<string> = new Set<PushPlatform>([
    'web',
    'ios',
    'android',
]);
const TOKEN_MAX_LENGTH = 4096;
const LIST_LIMIT = 50;
const APP_LIST_LIMIT = 200;
const APP_ICON_SIZE = 64;
const WHITESPACE_OR_CONTROL = /[\s\p{Cc}]/u;

/** A device as the routes return it; the provider token never leaves. */
export interface PublicPushDevice {
    uid: string;
    platform: PushPlatform;
    label: string | null;
    user_agent: string | null;
    created_at: number;
    last_seen_at: number;
    /** Registered from the session making this request. */
    current: boolean;
}

/** An app the user lets send pushes. */
export interface PushApp {
    uid: string;
    name: string;
    title: string;
    icon: string | null;
}

const badRequest = (message: string) =>
    new HttpError(400, message, { legacyCode: 'bad_request' });

const toPublicDevice = (
    device: PushDevice,
    sessionUid: string,
): PublicPushDevice => ({
    uid: device.uid,
    platform: device.platform,
    label: device.label,
    user_agent: device.userAgent,
    created_at: device.createdAt,
    last_seen_at: device.lastSeenAt,
    current: device.sessionUid === sessionUid,
});

/** Push devices of the signed-in user, for Puter's own web and mobile apps. */
@Controller('/push')
export class PushController extends PuterController {
    /** POST /push/devices `{ platform, token, label? }` — add or refresh. */
    @Post('/devices', {
        subdomain: 'api',
        requireUserActor: true,
        bodyJson: { limit: '8kb' },
        rateLimit: {
            scope: 'push-device-register',
            limit: 30,
            window: 60_000,
            key: 'user',
        },
    })
    async register(req: Request, res: Response): Promise<void> {
        const { userId, sessionUid } = this.#signedIn(req.actor);
        this.#requireEnabled();

        const body = bodyRecord(req);
        const { platform, token, label } = body;
        if (typeof platform !== 'string' || !PLATFORMS.has(platform)) {
            throw badRequest('`platform` must be one of web, ios, android');
        }
        if (
            typeof token !== 'string' ||
            token.length === 0 ||
            token.length > TOKEN_MAX_LENGTH ||
            WHITESPACE_OR_CONTROL.test(token)
        ) {
            throw badRequest(
                `\`token\` must be 1 to ${TOKEN_MAX_LENGTH} characters with no whitespace`,
            );
        }
        if (label !== undefined && label !== null && typeof label !== 'string')
            throw badRequest('`label` must be a string');
        const trimmedLabel = typeof label === 'string' ? label.trim() : '';
        if (trimmedLabel.length > PUSH_DEVICE_LABEL_MAX_LENGTH) {
            throw badRequest(
                `\`label\` must be at most ${PUSH_DEVICE_LABEL_MAX_LENGTH} characters`,
            );
        }

        const userAgent = req
            .get('user-agent')
            ?.slice(0, PUSH_DEVICE_USER_AGENT_MAX_LENGTH);
        const device = await this.services.push.registerDevice({
            userId,
            sessionUid,
            platform: platform as PushPlatform,
            token,
            label: trimmedLabel || null,
            userAgent: userAgent || null,
        });
        res.json({ device: toPublicDevice(device, sessionUid) });
    }

    /** GET /push/devices — the caller's devices, newest first. */
    @Get('/devices', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: {
            scope: 'push-device-list',
            limit: 60,
            window: 60_000,
            key: 'user',
        },
    })
    async list(req: Request, res: Response): Promise<void> {
        const { userId, sessionUid } = this.#signedIn(req.actor);
        const devices = await this.stores.pushDevice.listByUser(userId, {
            limit: LIST_LIMIT,
        });
        res.json({
            devices: devices.map((d) => toPublicDevice(d, sessionUid)),
        });
    }

    /** DELETE /push/devices/:uid — 404 unless the device is the caller's. */
    @Delete('/devices/:uid', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: {
            scope: 'push-device-remove',
            limit: 30,
            window: 60_000,
            key: 'user',
        },
    })
    async remove(req: Request, res: Response): Promise<void> {
        const { userId } = this.#signedIn(req.actor);
        const uid = String(req.params.uid ?? '');
        const removed = await this.stores.pushDevice.removeByUid(userId, uid);
        if (!removed) {
            throw new HttpError(404, 'Device not found', {
                legacyCode: 'not_found',
            });
        }
        res.json({ removed: true });
    }

    /** POST /push/devices/:uid/test — one fixed push to the caller's device. */
    @Post('/devices/:uid/test', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: {
            scope: 'push-device-test',
            limit: 3,
            window: 10 * 60_000,
            key: 'user',
        },
    })
    async test(req: Request, res: Response): Promise<void> {
        const { userId } = this.#signedIn(req.actor);
        this.#requireEnabled();
        const uid = String(req.params.uid ?? '');
        const result = await this.services.push.sendTest(userId, uid);
        switch (result) {
            case 'delivered':
                res.json({ sent: true });
                return;
            case 'not_found':
                throw new HttpError(404, 'Device not found', {
                    legacyCode: 'not_found',
                });
            case 'no_provider':
                throw new HttpError(
                    503,
                    'Push notifications are not available for this device',
                    { legacyCode: 'push_unavailable' },
                );
            case 'unregistered':
                throw new HttpError(
                    410,
                    'This device no longer receives push notifications',
                    { legacyCode: 'push_device_unregistered' },
                );
            default:
                throw new HttpError(502, 'The test notification was not sent', {
                    legacyCode: 'push_test_failed',
                });
        }
    }

    /** GET /push/apps — apps the caller lets send pushes, by title. */
    @Get('/apps', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: {
            scope: 'push-app-list',
            limit: 60,
            window: 60_000,
            key: 'user',
        },
    })
    async listApps(req: Request, res: Response): Promise<void> {
        const { userId } = this.#signedIn(req.actor);
        const rows = await this.stores.permission.listAppsWithUserAppPerm(
            userId,
            NOTIFICATIONS_PUSH_PERMISSION,
            { limit: APP_LIST_LIMIT },
        );
        const apiBaseUrl = this.config.api_base_url as string | undefined;
        const apps: PushApp[] = rows.map((row) => ({
            uid: row.uid,
            name: row.name,
            title: row.title,
            icon: getAppIconUrl(row, { apiBaseUrl }, APP_ICON_SIZE),
        }));
        res.json({ apps });
    }

    /** GET /push/preferences — `{ puter }`: pushes of Puter's own notifications. */
    @Get('/preferences', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: {
            scope: 'push-preferences-read',
            limit: 60,
            window: 60_000,
            key: 'user',
        },
    })
    async getPreferences(req: Request, res: Response): Promise<void> {
        const { userId } = this.#signedIn(req.actor);
        res.json({ puter: await this.services.push.puterPushEnabled(userId) });
    }

    /** POST /push/preferences `{ puter: boolean }`. */
    @Post('/preferences', {
        subdomain: 'api',
        requireUserActor: true,
        bodyJson: { limit: '1kb' },
        rateLimit: {
            scope: 'push-preferences-write',
            limit: 30,
            window: 60_000,
            key: 'user',
        },
    })
    async setPreferences(req: Request, res: Response): Promise<void> {
        const { userId } = this.#signedIn(req.actor);
        const { puter } = bodyRecord(req);
        if (typeof puter !== 'boolean') {
            throw badRequest('`puter` must be a boolean');
        }
        await this.services.push.setPuterPushEnabled(userId, puter);
        res.json({ puter });
    }

    #requireEnabled(): void {
        if (this.config.push?.enabled !== true) {
            throw new HttpError(503, 'Push notifications are not enabled', {
                legacyCode: 'push_disabled',
            });
        }
    }

    #signedIn(actor: Actor | undefined): {
        userId: number;
        sessionUid: string;
    } {
        const userId = actor?.user?.id;
        if (!userId) {
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });
        }
        const session = actor.session;
        if (!session?.uid || session.kind !== 'web') {
            throw new HttpError(
                403,
                'Devices can only be managed from a signed-in Puter session',
                { legacyCode: 'forbidden' },
            );
        }
        return { userId, sessionUid: session.uid };
    }
}
