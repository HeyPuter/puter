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

import type { EventMap } from '../../clients/event/types.js';
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
import { isUserConnected } from './pushPresence.js';
import type {
    PushMessage,
    PushPlatform,
    PushProvider,
    PushResult,
} from './types.js';

/** Most tokens one provider call takes. */
export const PUSH_BATCH_SIZE = 100;
/** Most devices one notification goes to. */
const MAX_DEVICES_PER_PUSH = 1000;
/** Provider calls one notification has open at once. */
const BATCH_CONCURRENCY = 4;
/** Notifications this node delivers at once; past it, a push is skipped. */
const MAX_IN_FLIGHT = 64;
/** A provider call still open after this counts as failed. */
const SEND_TIMEOUT_MS = 30_000;

/** User metadata key for pushes of Puter's own notifications; absent is on. */
export const PUTER_PUSH_PREFERENCE_KEY = 'pushPuter';

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
    #stopping = false;

    override onServerStart(): void {
        this.#armStaleSweep();

        this.clients.event.on('notif.written', (_key, data) => {
            if (this.config.push?.enabled !== true) return;
            if (this.#providers.size === 0) return;
            if (this.#inFlight >= MAX_IN_FLIGHT) {
                console.warn('[push] too many pushes in flight, skipped one');
                return;
            }
            this.#inFlight++;
            void this.#deliver(data)
                .catch((err: unknown) => {
                    console.warn('[push] delivery failed', err);
                })
                .finally(() => {
                    this.#inFlight--;
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
        const { userId, uid, type, value } = written;
        const fromApp = type === APP_MESSAGE_TYPE;
        const appUid = fromApp ? (written.appUid ?? null) : null;
        if (fromApp && !appUid) return;

        const devices = (
            await this.stores.pushDevice.listForDelivery(userId, appUid, {
                limit: MAX_DEVICES_PER_PUSH,
            })
        ).filter((device) => this.#providers.has(device.platform));
        if (devices.length === 0) return;

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
        const message = fitPushMessage(built);
        if (!message) {
            console.warn('[push] message over the size budget, not sent', {
                uid,
                type,
            });
            return;
        }

        await this.#send(userId, devices, message);
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
        const user = await this.stores.user.getById(userId);
        if (!user) return false;
        return user.metadata?.[PUTER_PUSH_PREFERENCE_KEY] !== false;
    }

    /** One call per platform batch; each device's result is recorded once. */
    async #send(
        userId: number,
        devices: PushDeliveryTarget[],
        message: PushMessage,
    ): Promise<void> {
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
        const unregistered: string[] = [];
        const reasons = new Set<string>();
        settled.forEach((outcome, index) => {
            let results: Array<PushResult | undefined> = [];
            if (outcome.status === 'rejected') {
                reasons.add(errorName(outcome.reason));
            } else if (Array.isArray(outcome.value)) {
                results = outcome.value;
            }
            batches[index].devices.forEach((device, i) => {
                const result = results[i];
                if (result?.status === 'delivered') {
                    delivered.push(device.uid);
                } else if (result?.status === 'unregistered') {
                    unregistered.push(hashPushToken(device.token));
                } else {
                    failed.push(device.uid);
                    if (result?.status === 'failed' && result.reason) {
                        reasons.add(
                            String(result.reason)
                                .split(device.token)
                                .join('<token>')
                                .slice(0, 120),
                        );
                    }
                }
            });
        });

        if (failed.length > 0) {
            console.warn('[push] not delivered to some devices', {
                uid: message.uid,
                devices: failed.length,
                reasons: [...reasons].slice(0, 5),
            });
        }
        await Promise.all([
            this.stores.pushDevice.touch(userId, delivered),
            this.stores.pushDevice.recordFailure(userId, failed),
            this.stores.pushDevice.removeByTokenHashes(unregistered),
        ]);
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

const withTimeout = <T>(promise: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
            () => reject(new Error('push provider timed out')),
            SEND_TIMEOUT_MS,
        );
        timer.unref?.();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/** Only the error's name: a provider's message may carry tokens. */
const errorName = (err: unknown): string =>
    err instanceof Error ? err.name || 'Error' : 'error';
