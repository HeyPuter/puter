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
import { v4 as uuidv4, validate as validateUuid } from 'uuid';
import type { SignInDevice } from '../../services/auth/SignInService.js';
import type { TokenService } from '../../services/auth/TokenService.js';
import type { SystemKVStore } from '../../stores/systemKv/SystemKVStore.js';
import type { IConfig } from '../../types.js';
import { sessionCookieFlags } from '../../util/cookieFlags.js';

/**
 * Known devices: a signed HttpOnly cookie holds a random device id, and the
 * system KV keeps one record per (account, device) that completed a sign-in,
 * plus a marker that the account has any. Each lives a year past its last
 * renewal. A missing or unreadable record only makes a device read as new.
 */

export const KNOWN_DEVICE_COOKIE_NAME = 'puter_device';

// Its own scope and `purpose`, and no auth `type` claim, so the auth probe
// never accepts the cookie as a session token.
const DEVICE_TOKEN_SCOPE = 'known-device';
const DEVICE_TOKEN_PURPOSE = 'known-device';
const COOKIE_TTL_SECONDS = 2 * 365 * 24 * 60 * 60;
const RECORD_TTL_SECONDS = 365 * 24 * 60 * 60;
/** A cookie or record this old is renewed on its next use, so both slide. */
const RENEW_AFTER_SECONDS = 30 * 24 * 60 * 60;

export const knownDeviceKey = (userUuid: string, deviceId: string): string =>
    `known-device:${userUuid}:${deviceId}`;

/** Present while the account has at least one recorded device. */
export const knownDevicesMarkerKey = (userUuid: string): string =>
    `known-devices-any:${userUuid}`;

export interface KnownDeviceDeps {
    token: TokenService;
    kv: SystemKVStore;
}

interface DeviceRecord {
    /** Unix seconds the record was last renewed. */
    seenAt: number;
}

/** The device id the request's cookie carries, or null when absent or not ours. */
export function readDeviceCookie(
    req: Request,
    token: TokenService,
): { deviceId: string; issuedAt: number } | null {
    const raw = req.cookies?.[KNOWN_DEVICE_COOKIE_NAME];
    if (typeof raw !== 'string' || !raw) return null;
    try {
        const claims = token.verify<{
            purpose?: unknown;
            device_id?: unknown;
            iat?: unknown;
        }>(DEVICE_TOKEN_SCOPE, raw);
        if (
            claims.purpose !== DEVICE_TOKEN_PURPOSE ||
            typeof claims.device_id !== 'string' ||
            !validateUuid(claims.device_id)
        ) {
            return null;
        }
        return {
            deviceId: claims.device_id,
            issuedAt: typeof claims.iat === 'number' ? claims.iat : 0,
        };
    } catch {
        return null;
    }
}

const parseRecord = (value: unknown): DeviceRecord | null =>
    typeof (value as DeviceRecord | null)?.seenAt === 'number'
        ? (value as DeviceRecord)
        : null;

interface AccountDevices {
    /** The record of the request's cookie device; null without one. */
    device: DeviceRecord | null;
    marker: DeviceRecord | null;
}

// One read per request and account (the device record and the marker in one
// batch), shared by the lockout check, the sign-in, and whatever else asks
// during that request. Null when it failed.
const accountReads = new WeakMap<
    Request,
    Map<string, Promise<AccountDevices | null>>
>();

function readAccountDevices(
    req: Request,
    userUuid: string,
    deps: KnownDeviceDeps,
): Promise<AccountDevices | null> {
    let reads = accountReads.get(req);
    if (!reads) {
        reads = new Map();
        accountReads.set(req, reads);
    }
    let read = reads.get(userUuid);
    if (!read) {
        const deviceId = readDeviceCookie(req, deps.token)?.deviceId;
        read = (async () => {
            try {
                if (!deviceId) {
                    const { res } = await deps.kv.get({
                        key: knownDevicesMarkerKey(userUuid),
                    });
                    return { device: null, marker: parseRecord(res) };
                }
                const { res } = await deps.kv.get({
                    key: [
                        knownDeviceKey(userUuid, deviceId),
                        knownDevicesMarkerKey(userUuid),
                    ],
                });
                const [device, marker] = (res as unknown[]).map(parseRecord);
                return { device: device ?? null, marker: marker ?? null };
            } catch (e) {
                console.warn('[known-device] record read failed:', e);
                return null;
            }
        })();
        reads.set(userUuid, read);
    }
    return read;
}

/**
 * What the account's records say about the request's device. An unreadable
 * record reads as no devices at all.
 */
export async function knownDeviceStatus(
    req: Request,
    userUuid: string,
    deps: KnownDeviceDeps,
): Promise<SignInDevice> {
    const read = await readAccountDevices(req, userUuid, deps);
    return {
        known: Boolean(read?.device),
        anyRecorded: Boolean(read?.device || read?.marker),
    };
}

/**
 * Whether the request comes from a device that completed a sign-in on this
 * account. False when there is no valid cookie or the record can't be read.
 */
export async function isKnownDevice(
    req: Request,
    userUuid: string,
    deps: KnownDeviceDeps,
): Promise<boolean> {
    if (!readDeviceCookie(req, deps.token)) return false;
    return (await knownDeviceStatus(req, userUuid, deps)).known;
}

/**
 * The request's device id, issuing or renewing its cookie. Records nothing: the
 * id only counts once {@link rememberDevice} or {@link recordKnownDevice} puts it
 * on an account.
 */
export function issueDeviceCookie(
    req: Request,
    res: Response,
    deps: Pick<KnownDeviceDeps, 'token'> & { config: IConfig },
): string {
    const now = Math.floor(Date.now() / 1000);
    const cookie = readDeviceCookie(req, deps.token);
    const deviceId = cookie?.deviceId ?? uuidv4();
    if (!cookie || now - cookie.issuedAt >= RENEW_AFTER_SECONDS) {
        res.cookie(
            KNOWN_DEVICE_COOKIE_NAME,
            deps.token.sign(
                DEVICE_TOKEN_SCOPE,
                { purpose: DEVICE_TOKEN_PURPOSE, device_id: deviceId },
                { expiresIn: COOKIE_TTL_SECONDS },
            ),
            {
                ...sessionCookieFlags(deps.config, { crossSite: false }),
                httpOnly: true,
                maxAge: COOKIE_TTL_SECONDS * 1000,
            },
        );
    }
    return deviceId;
}

/**
 * Record a device on the account by id, for a request that doesn't carry its
 * cookie. Same records as {@link rememberDevice}.
 */
export async function recordKnownDevice(
    userUuid: string,
    deviceId: string,
    deps: Pick<KnownDeviceDeps, 'kv'>,
): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const fresh: DeviceRecord = { seenAt: now };
    const expireAt = now + RECORD_TTL_SECONDS;
    try {
        await Promise.all([
            deps.kv.set({
                key: knownDeviceKey(userUuid, deviceId),
                value: fresh,
                expireAt,
            }),
            deps.kv.updateReservedItemIf(
                knownDevicesMarkerKey(userUuid),
                { set: { value: fresh, ttl: expireAt } },
                'attribute_not_exists(#ttl) OR #ttl < :ttl',
                { ':ttl': expireAt },
                { '#ttl': 'ttl' },
            ),
        ]);
    } catch (e) {
        console.warn('[known-device] record update failed:', e);
    }
}

/**
 * Record the request's device on the account, issuing or renewing its cookie.
 * Call only once the request has proved the account (a completed sign-in, or a
 * session it already holds). The cookie is set before the first await, so a
 * caller may leave the record update running. Resolves to whether the device
 * was already recorded; a device recorded and renewed recently costs one read
 * and no write.
 */
export async function rememberDevice(
    req: Request,
    res: Response,
    userUuid: string,
    deps: KnownDeviceDeps & { config: IConfig },
): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const cookie = readDeviceCookie(req, deps.token);
    const deviceId = issueDeviceCookie(req, res, deps);
    // Without a cookie the device is new, and only the marker was read.
    const read = await readAccountDevices(req, userUuid, deps);
    const device = cookie ? (read?.device ?? null) : null;
    const stale = (record: DeviceRecord | null | undefined) =>
        !record || now - record.seenAt >= RENEW_AFTER_SECONDS;
    // Each write touches only this device's record and the marker, so
    // concurrent sign-ins never drop each other's devices. The marker is
    // rewritten with every device record, so it never expires first.
    const fresh: DeviceRecord = { seenAt: now };
    const expireAt = now + RECORD_TTL_SECONDS;
    const writeDevice = stale(device);
    const writeMarker = writeDevice || stale(read?.marker);
    if (!writeDevice && !writeMarker) return true;
    try {
        await Promise.all([
            writeDevice &&
                deps.kv.set({
                    key: knownDeviceKey(userUuid, deviceId),
                    value: fresh,
                    expireAt,
                }),
            // Only ever extends it: an older sign-in landing last is refused.
            writeMarker &&
                deps.kv.updateReservedItemIf(
                    knownDevicesMarkerKey(userUuid),
                    { set: { value: fresh, ttl: expireAt } },
                    'attribute_not_exists(#ttl) OR #ttl < :ttl',
                    { ':ttl': expireAt },
                    { '#ttl': 'ttl' },
                ),
        ]);
        accountReads.get(req)?.set(
            userUuid,
            Promise.resolve({
                device: writeDevice ? fresh : device,
                marker: writeMarker ? fresh : (read?.marker ?? null),
            }),
        );
    } catch (e) {
        console.warn('[known-device] record update failed:', e);
    }
    return Boolean(device);
}
