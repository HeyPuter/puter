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
import type { EventMap } from '../../clients/event/types.js';
import { checkRateLimit } from '../../core/http/middleware/rateLimit.js';
import {
    hashPushToken,
    type PushDeliveryTarget,
    type PushDevice,
    type PushDeviceRegistration,
} from '../../stores/push/PushDeviceStore.js';
import { runWithConcurrencyLimitSettled } from '../../util/concurrency.js';
import {
    APP_MESSAGE_TYPE,
    appMessageSender,
} from '../notification/appMessage.js';
import { PuterService } from '../types.js';
import { hasPushConsent } from './pushConsent.js';
import { buildPushMessage, fitPushMessage } from './pushMessage.js';
import { isConnectedHere, isUserConnected } from './pushPresence.js';
import {
    PUSH_FAILURE_CODES,
    type PushFailureCode,
    type PushMessage,
    type PushPlatform,
    type PushProvider,
    type PushResult,
} from './types.js';

/** Most tokens one provider call takes. */
export const PUSH_BATCH_SIZE = 100;
/** Most devices one notification goes to. */
const MAX_DEVICES_PER_PUSH = 1000;
/** Provider calls one notification has open at once. */
const BATCH_CONCURRENCY = 4;
/** Notifications this node delivers at once; past it, a push is skipped. */
const MAX_IN_FLIGHT = 64;
/** At most one warning per window for each reason pushes are skipped. */
const SKIP_WARN_INTERVAL_MS = 60_000;
/** A provider call still open after this counts as failed. */
const SEND_TIMEOUT_MS = 30_000;
const DEFAULT_APP_PUSHES_PER_MINUTE = 1;
const MINUTE_MS = 60_000;

/** User metadata key for pushes of Puter's own notifications; absent is on. */
export const PUTER_PUSH_PREFERENCE_KEY = 'pushPuter';

/** A later test push replaces an earlier one still on screen. */
export const PUSH_TEST_GROUP = 'puter-push-test';
const PUSH_TEST_TTL_SECONDS = 60;

export type PushTestResult =
    'delivered' | 'not_found' | 'no_provider' | 'unregistered' | 'failed';

/** Which devices a send reached, by device uid. */
interface PushSendOutcome {
    delivered: string[];
    unregistered: string[];
    failed: string[];
}

type WrittenNotification = EventMap['notif.written'];

const DEFAULT_DEVICE_RETENTION_DAYS = 60;
const STALE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** Rows one delete takes. Small enough not to hold a lock anyone waits on. */
const STALE_BATCH_SIZE = 500;
/** Batches one sweep takes, so a large backlog drains over several passes. */
const STALE_MAX_BATCHES = 50;
const MAX_DEVICES_PER_USER = 20;

/** Pushes new notifications to devices; device cleanup runs with push off. */
export class PushService extends PuterService {
    #staleSweep: ReturnType<typeof setInterval> | null = null;
    readonly #providers = new Map<PushPlatform, PushProvider>();
    #inFlight = 0;
    readonly #capSkips = new SkipLog(
        '[push] at the in-flight cap, pushes skipped',
    );
    readonly #limitSkips = new SkipLog(
        '[push] over the app push limit, pushes skipped',
    );
    #stopping = false;

    override onServerStart(): void {
        this.#armStaleSweep();

        this.clients.event.on('notif.written', (_key, data) => {
            if (this.#stopping) return;
            if (this.config.push?.enabled !== true) return;
            if (this.#providers.size === 0) return;
            void this.#deliver(data).catch((err: unknown) => {
                console.warn('[push] delivery failed', err);
            });
        });

        this.clients.event.on(
            'outer.auth.sessions.revoked',
            (_key: string, data: unknown, meta: unknown) => {
                // The node that revoked the sessions already removed the rows.
                if ((meta as { from_outside?: boolean })?.from_outside) return;
                const { user_id, session_uids } = data as {
                    user_id?: number;
                    session_uids?: string[];
                };
                if (!user_id || !session_uids?.length) return;
                void this.stores.pushDevice
                    .removeBySessions(user_id, session_uids)
                    .catch((err: unknown) => {
                        console.warn(
                            '[push] session device cleanup failed',
                            err,
                        );
                    });
            },
        );
    }

    override onServerPrepareShutdown(): void {
        this.#stopping = true;
        if (this.#staleSweep) clearInterval(this.#staleSweep);
        this.#staleSweep = null;
    }

    /** A new device past 20 per user removes the least recently seen. */
    async registerDevice(
        registration: PushDeviceRegistration,
    ): Promise<PushDevice> {
        const device = await this.stores.pushDevice.register(registration);
        await this.stores.pushDevice.removeOldestBeyond(
            registration.userId,
            MAX_DEVICES_PER_USER,
        );
        return device;
    }

    /** Whether Puter's own notifications go out as pushes; false for no user. */
    async puterPushEnabled(userId: number): Promise<boolean> {
        const user = await this.stores.user.getById(userId);
        if (!user) return false;
        return user.metadata?.[PUTER_PUSH_PREFERENCE_KEY] !== false;
    }

    async setPuterPushEnabled(userId: number, enabled: boolean): Promise<void> {
        await this.stores.user.setMetadataKey(
            userId,
            PUTER_PUSH_PREFERENCE_KEY,
            enabled,
        );
    }

    /** A fixed push to one device, ignoring presence and preference. */
    async sendTest(userId: number, deviceUid: string): Promise<PushTestResult> {
        const device = await this.stores.pushDevice.getDeliveryTarget(
            userId,
            deviceUid,
        );
        if (!device) return 'not_found';
        if (!this.#providers.has(device.platform)) return 'no_provider';

        const outcome = await this.#send(userId, [device], {
            uid: randomUUID(),
            title: 'Push is on for this browser',
            body: 'Notifications from Puter will show up here.',
            group: PUSH_TEST_GROUP,
            ttl: PUSH_TEST_TTL_SECONDS,
            priority: 'normal',
        });
        if (outcome.delivered.length > 0) return 'delivered';
        if (outcome.unregistered.length > 0) return 'unregistered';
        return 'failed';
    }

    // -- Extension hooks ----------------------------------------------

    /** The latest provider registered for a platform carries its pushes. */
    registerProvider(provider: PushProvider): void {
        for (const platform of provider.platforms) {
            this.#providers.set(platform, provider);
        }
    }

    // -- Delivery -----------------------------------------------------

    /** Only `app.message` is an app's; every other type goes to Puter devices. */
    async #deliver(written: WrittenNotification): Promise<void> {
        const { userId, type } = written;
        const fromApp = type === APP_MESSAGE_TYPE;
        const appUid = fromApp ? (written.appUid ?? null) : null;
        if (fromApp && !appUid) return;

        const socket = this.services.socket;
        if (isConnectedHere(socket, userId, null)) return;
        if (appUid && isConnectedHere(socket, userId, appUid)) return;

        const devices = (
            await this.stores.pushDevice.listForDelivery(userId, appUid, {
                limit: MAX_DEVICES_PER_PUSH,
            })
        ).filter((device) => this.#providers.has(device.platform));
        if (devices.length === 0 || this.#stopping) return;

        if (this.#inFlight >= MAX_IN_FLIGHT) {
            this.#capSkips.note();
            return;
        }
        this.#inFlight++;
        try {
            await this.#deliverTo(written, appUid, devices);
        } finally {
            this.#inFlight--;
        }
    }

    async #deliverTo(
        written: WrittenNotification,
        appUid: string | null,
        devices: PushDeliveryTarget[],
    ): Promise<void> {
        const { userId, uid, type, value } = written;
        if (!(await this.#allowed(userId, appUid))) return;

        const presence = {
            socket: this.services.socket,
            eventForward: this.services.eventForward,
        };
        if (await isUserConnected(presence, userId, null)) return;
        if (appUid && (await isUserConnected(presence, userId, appUid))) return;

        const appName = appUid ? await this.#appName(appUid, value) : null;
        if (appUid && !appName) return;
        const built = buildPushMessage(
            { uid, type, value },
            appUid && appName ? { uid: appUid, name: appName } : null,
        );
        if (!built) return;
        if (written.updated) built.replace = true;
        const message = fitPushMessage(built);
        if (!message) {
            console.warn('[push] message over the size budget, not sent', {
                uid,
                type,
            });
            return;
        }
        if (appUid && !(await this.#withinAppPushLimit(userId, appUid))) {
            this.#limitSkips.note();
            return;
        }

        await this.#send(userId, devices, message);
    }

    /** Spends one push from the app's budget for this user; fails open. */
    async #withinAppPushLimit(
        userId: number,
        appUid: string,
    ): Promise<boolean> {
        const perMinute =
            this.config.push?.appPushesPerMinute ??
            DEFAULT_APP_PUSHES_PER_MINUTE;
        if (!(perMinute > 0)) return true;
        return checkRateLimit(
            `push:app:${userId}:${appUid}`,
            perMinute,
            MINUTE_MS,
        );
    }

    /** The name the server stamped on the message, else the app row's. */
    async #appName(
        appUid: string,
        value: Record<string, unknown>,
    ): Promise<string | null> {
        const stamped = (value.app as { name?: unknown } | undefined)?.name;
        if (typeof stamped === 'string' && stamped) return stamped;
        const row = await this.stores.app.getByUid(appUid);
        return row ? (appMessageSender(appUid, row).name ?? null) : null;
    }

    /** The user's consent for the app, or their Puter preference without one. */
    async #allowed(userId: number, appUid: string | null): Promise<boolean> {
        if (appUid) {
            return hasPushConsent(
                { stores: this.stores, services: this.services },
                userId,
                appUid,
            );
        }
        return this.puterPushEnabled(userId);
    }

    /** One call per platform batch; each device's result is recorded once. */
    async #send(
        userId: number,
        devices: PushDeliveryTarget[],
        message: PushMessage,
    ): Promise<PushSendOutcome> {
        const byPlatform = new Map<PushPlatform, PushDeliveryTarget[]>();
        for (const device of devices) {
            const list = byPlatform.get(device.platform) ?? [];
            list.push(device);
            byPlatform.set(device.platform, list);
        }
        const batches: Array<{
            platform: PushPlatform;
            devices: PushDeliveryTarget[];
        }> = [];
        for (const [platform, list] of byPlatform) {
            for (let i = 0; i < list.length; i += PUSH_BATCH_SIZE) {
                batches.push({
                    platform,
                    devices: list.slice(i, i + PUSH_BATCH_SIZE),
                });
            }
        }

        const settled = await runWithConcurrencyLimitSettled(
            batches,
            BATCH_CONCURRENCY,
            (batch) =>
                withTimeout(
                    this.#providers.get(batch.platform)!.send({
                        platform: batch.platform,
                        tokens: batch.devices.map((device) => device.token),
                        message,
                    }),
                ),
        );

        const delivered: string[] = [];
        const failed: string[] = [];
        const unregistered: PushDeliveryTarget[] = [];
        const codes: Partial<Record<PushFailureCode, number>> = {};
        settled.forEach((outcome, index) => {
            let results: Array<PushResult | undefined> = [];
            let batchCode: PushFailureCode = 'unknown';
            if (outcome.status === 'rejected') {
                batchCode =
                    outcome.reason instanceof PushTimeoutError
                        ? 'timeout'
                        : 'provider_error';
            } else if (Array.isArray(outcome.value)) {
                results = outcome.value;
            }
            batches[index].devices.forEach((device, i) => {
                const result = results[i];
                if (result?.status === 'delivered') {
                    delivered.push(device.uid);
                } else if (result?.status === 'unregistered') {
                    unregistered.push(device);
                } else {
                    failed.push(device.uid);
                    const code = failureCode(result, batchCode);
                    codes[code] = (codes[code] ?? 0) + 1;
                }
            });
        });

        if (failed.length > 0) {
            console.warn('[push] not delivered to some devices', {
                uid: message.uid,
                status: 'failed',
                devices: failed.length,
                codes,
            });
        }
        await Promise.all([
            this.stores.pushDevice.touch(userId, delivered),
            this.stores.pushDevice.recordFailure(userId, failed),
            this.stores.pushDevice.removeByTokenHashes(
                unregistered.map((device) => hashPushToken(device.token)),
            ),
        ]);
        return {
            delivered,
            unregistered: unregistered.map((device) => device.uid),
            failed,
        };
    }

    /** Every node sweeps; an overlap costs only empty indexed batches. */
    async sweepStaleDevices(): Promise<number> {
        const days = this.#retentionDays();
        if (days <= 0) return 0;
        const cutoff = Math.floor(Date.now() / 1000) - days * 86_400;

        let removed = 0;
        for (let pass = 0; pass < STALE_MAX_BATCHES; pass++) {
            if (this.#stopping) break;
            const batch = await this.stores.pushDevice.removeUnseenSince(
                cutoff,
                { limit: STALE_BATCH_SIZE },
            );
            removed += batch;
            if (batch < STALE_BATCH_SIZE) break;
        }
        return removed;
    }

    #retentionDays(): number {
        const configured = Number(
            this.config.push?.deviceRetentionDays ??
                DEFAULT_DEVICE_RETENTION_DAYS,
        );
        return Number.isFinite(configured) && configured > 0 ? configured : 0;
    }

    #armStaleSweep(): void {
        if (this.#retentionDays() <= 0) return;
        const sweep = setInterval(() => {
            void this.sweepStaleDevices().catch((err) => {
                console.warn('[push] stale device sweep failed', err);
            });
        }, STALE_SWEEP_INTERVAL_MS);
        sweep.unref?.();
        this.#staleSweep = sweep;
    }
}

class PushTimeoutError extends Error {}

/** Counts skipped pushes; warns with the count at most once a window. */
class SkipLog {
    #skipped = 0;
    #lastWarn = 0;
    constructor(readonly message: string) {}

    note(): void {
        this.#skipped++;
        const now = Date.now();
        if (now - this.#lastWarn < SKIP_WARN_INTERVAL_MS) return;
        console.warn(this.message, { skipped: this.#skipped });
        this.#skipped = 0;
        this.#lastWarn = now;
    }
}

/** A provider's own code when it is a known one, never its text. */
const failureCode = (
    result: PushResult | undefined,
    fallback: PushFailureCode,
): PushFailureCode => {
    if (result?.status !== 'failed') return fallback;
    const code = result.code;
    return code && PUSH_FAILURE_CODES.includes(code) ? code : 'unknown';
};

const withTimeout = <T>(promise: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
            () => reject(new PushTimeoutError('push provider timed out')),
            SEND_TIMEOUT_MS,
        );
        timer.unref?.();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};
