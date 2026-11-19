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
import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { signStepUpToken } from '../../core/http/middleware/stepUpSession.js';
import { configContainer } from '../../exports.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import {
    isKnownDevice,
    KNOWN_DEVICE_COOKIE_NAME,
    knownDeviceKey,
    knownDevicesMarkerKey,
    knownDeviceStatus,
    readDeviceCookie,
    rememberDevice,
} from './knownDevice.js';

/** `name=value` of the device cookie a response sets, if it sets one. */
const deviceCookieOf = (response: globalThis.Response): string | undefined =>
    response.headers
        .getSetCookie()
        .join(', ')
        .match(
            new RegExp(`(?:^|,\\s*)(${KNOWN_DEVICE_COOKIE_NAME}=[^;]+)`),
        )?.[1];

describe('known devices', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);
    afterAll(async () => {
        await env?.shutdown();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const deps = () => ({
        config: configContainer as IConfig,
        token: env.server.services.token,
        kv: env.server.stores.kv,
    });

    /** A request carrying `cookies`, and a response that keeps what it sets. */
    const exchange = (cookies: Record<string, string> = {}) => {
        const set: Record<string, { value: string; opts: unknown }> = {};
        const req = { cookies, headers: {} } as unknown as Request;
        const res = {
            cookie: (name: string, value: string, opts: unknown) => {
                set[name] = { value, opts };
            },
        } as unknown as Response;
        return { req, res, set };
    };

    const deviceIdOf = (cookie: string) =>
        readDeviceCookie(
            exchange({ [KNOWN_DEVICE_COOKIE_NAME]: cookie }).req,
            env.server.services.token,
        )!.deviceId;

    /** The account's record of the device behind `cookie`, if any. */
    const recorded = async (userUuid: string, cookie: string) =>
        (
            await env.server.stores.kv.get({
                key: knownDeviceKey(userUuid, deviceIdOf(cookie)),
            })
        ).res as { seenAt: number } | null;

    const signedInDevice = async (userUuid: string) => {
        const first = exchange();
        await rememberDevice(first.req, first.res, userUuid, deps());
        return first.set[KNOWN_DEVICE_COOKIE_NAME]!.value;
    };

    const isKnown = (userUuid: string, cookie: string) =>
        isKnownDevice(
            exchange({ [KNOWN_DEVICE_COOKIE_NAME]: cookie }).req,
            userUuid,
            deps(),
        );

    it('issues an HttpOnly, SameSite=Lax, long-lived cookie and records the device', async () => {
        const userUuid = uuidv4();
        const { req, res, set } = exchange();
        expect(await rememberDevice(req, res, userUuid, deps())).toBe(false);

        const cookie = set[KNOWN_DEVICE_COOKIE_NAME]!;
        expect(cookie.opts).toMatchObject({
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 2 * 365 * 24 * 60 * 60 * 1000,
        });
        expect(await recorded(userUuid, cookie.value)).toEqual({
            seenAt: expect.any(Number),
        });
        expect(
            (
                await env.server.stores.kv.get({
                    key: knownDevicesMarkerKey(userUuid),
                })
            ).res,
        ).toBeTruthy();
    });

    it('a recorded device costs one read and no write, and keeps its cookie', async () => {
        const userUuid = uuidv4();
        const value = await signedInDevice(userUuid);
        const get = vi.spyOn(env.server.stores.kv, 'get');
        const writes = [
            vi.spyOn(env.server.stores.kv, 'set'),
            vi.spyOn(env.server.stores.kv, 'batchPut'),
            vi.spyOn(env.server.stores.kv, 'updateReservedItemIf'),
        ];

        const again = exchange({ [KNOWN_DEVICE_COOKIE_NAME]: value });
        expect(await isKnownDevice(again.req, userUuid, deps())).toBe(true);
        expect(
            await rememberDevice(again.req, again.res, userUuid, deps()),
        ).toBe(true);
        expect(get).toHaveBeenCalledTimes(1);
        for (const write of writes) expect(write).not.toHaveBeenCalled();
        expect(again.set).toEqual({});
    });

    it('renews the cookie and the record once they are a month old', async () => {
        const userUuid = uuidv4();
        const value = await signedInDevice(userUuid);
        const before = await recorded(userUuid, value);

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);
        const later = exchange({ [KNOWN_DEVICE_COOKIE_NAME]: value });
        expect(
            await rememberDevice(later.req, later.res, userUuid, deps()),
        ).toBe(true);
        expect(later.set[KNOWN_DEVICE_COOKIE_NAME]).toBeDefined();
        const after = await recorded(userUuid, value);
        expect(after!.seenAt).toBeGreaterThan(before!.seenAt);
    });

    it('keeps every device of concurrent sign-ins to one account', async () => {
        const userUuid = uuidv4();
        await signedInDevice(userUuid);
        const a = exchange();
        const b = exchange();
        // Both read the account's devices before either records its own.
        await Promise.all([
            knownDeviceStatus(a.req, userUuid, deps()),
            knownDeviceStatus(b.req, userUuid, deps()),
        ]);
        await Promise.all([
            rememberDevice(a.req, a.res, userUuid, deps()),
            rememberDevice(b.req, b.res, userUuid, deps()),
        ]);
        for (const { set } of [a, b]) {
            expect(
                await isKnown(userUuid, set[KNOWN_DEVICE_COOKIE_NAME]!.value),
            ).toBe(true);
        }
    });

    it('keeps any number of devices, each for a year after it last renewed', async () => {
        const userUuid = uuidv4();
        const first = await signedInDevice(userUuid);
        for (let i = 0; i < 24; i++) await signedInDevice(userUuid);
        expect(await isKnown(userUuid, first)).toBe(true);

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 366 * 24 * 60 * 60 * 1000);
        expect(await isKnown(userUuid, first)).toBe(false);
    });

    it('keeps the account marker as long as its newest device', async () => {
        const userUuid = uuidv4();
        await signedInDevice(userUuid);
        vi.useFakeTimers({ toFake: ['Date'] });
        // The marker is too fresh to renew on its own by then.
        vi.setSystemTime(Date.now() + 20 * 24 * 60 * 60 * 1000);
        await signedInDevice(userUuid);

        vi.setSystemTime(Date.now() + 350 * 24 * 60 * 60 * 1000);
        const newBrowser = exchange();
        expect(
            await knownDeviceStatus(newBrowser.req, userUuid, deps()),
        ).toEqual({ known: false, anyRecorded: true });
    });

    it('never shortens the account marker when an older sign-in records last', async () => {
        const userUuid = uuidv4();
        const dynamo = env.server.clients.dynamo;
        let holding = true;
        let releaseOlder!: () => void;
        const older = new Promise<void>((resolve) => {
            releaseOlder = resolve;
        });
        const held = vi.fn();
        for (const method of ['put', 'batchPut', 'update'] as const) {
            const write = dynamo[method].bind(dynamo) as (
                ...args: unknown[]
            ) => Promise<unknown>;
            vi.spyOn(dynamo, method).mockImplementation((async (
                ...args: unknown[]
            ) => {
                if (holding) {
                    held();
                    await older;
                }
                return write(...args);
            }) as never);
        }

        const start = Date.now();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(start);
        const a = exchange();
        const first = rememberDevice(a.req, a.res, userUuid, deps());
        await vi.waitFor(() => expect(held).toHaveBeenCalled());

        holding = false;
        vi.setSystemTime(start + 60_000);
        const b = exchange();
        await rememberDevice(b.req, b.res, userUuid, deps());
        releaseOlder();
        await first;

        // Past the older sign-in's year, inside the newer one's.
        vi.setSystemTime(start + 365 * 24 * 60 * 60 * 1000 + 30_000);
        expect(
            await knownDeviceStatus(exchange().req, userUuid, deps()),
        ).toEqual({ known: false, anyRecorded: true });
    });

    it('keeps devices per account', async () => {
        const value = await signedInDevice(uuidv4());
        const other = exchange({ [KNOWN_DEVICE_COOKIE_NAME]: value });
        expect(await isKnownDevice(other.req, uuidv4(), deps())).toBe(false);
    });

    it('reads only cookies it signed for this purpose', async () => {
        const token = env.server.services.token;
        const value = await signedInDevice(uuidv4());
        const forged = `${value.slice(0, -4)}AAAA`;
        const stepUp = signStepUpToken(token, { uuid: uuidv4() });
        const session = env.users.user.token;
        const unsigned = token.sign('known-device', {
            purpose: 'known-device',
            device_id: 'not-a-uuid',
        });
        for (const cookie of [forged, stepUp, session, unsigned]) {
            expect(
                readDeviceCookie(
                    exchange({ [KNOWN_DEVICE_COOKIE_NAME]: cookie }).req,
                    token,
                ),
            ).toBeNull();
        }
    });

    it('answers unknown when the record cannot be read', async () => {
        const userUuid = uuidv4();
        const value = await signedInDevice(userUuid);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(env.server.stores.kv, 'get').mockRejectedValue(
            new Error('kv down'),
        );
        const { req } = exchange({ [KNOWN_DEVICE_COOKIE_NAME]: value });
        expect(await isKnownDevice(req, userUuid, deps())).toBe(false);
    });

    it('reports whether the device and any device are recorded', async () => {
        const userUuid = uuidv4();
        const status = (cookies: Record<string, string> = {}) =>
            knownDeviceStatus(exchange(cookies).req, userUuid, deps());
        expect(await status()).toEqual({ known: false, anyRecorded: false });

        const value = await signedInDevice(userUuid);
        expect(await status()).toEqual({ known: false, anyRecorded: true });
        expect(await status({ [KNOWN_DEVICE_COOKIE_NAME]: value })).toEqual({
            known: true,
            anyRecorded: true,
        });

        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(env.server.stores.kv, 'get').mockRejectedValue(
            new Error('kv down'),
        );
        expect(await status({ [KNOWN_DEVICE_COOKIE_NAME]: value })).toEqual({
            known: false,
            anyRecorded: false,
        });
    });

    describe('signed-in page loads', () => {
        const load = (cookie: string, dest = 'document') =>
            fetch(new URL('/', env.origin), {
                headers: { cookie, 'sec-fetch-dest': dest },
            });

        const account = async () => {
            const username = `device_${uuidv4().slice(0, 8)}`;
            const { token } = await createTestUser(env.server, {
                username,
                password: 'device-page-password',
            });
            const user =
                (await env.server.stores.user.getByUsername(username))!;
            return { session: `puter_auth_token=${token}`, uuid: user.uuid };
        };

        it('record a browser that signed in before devices were recorded', async () => {
            const { session, uuid } = await account();
            const first = await load(session);
            expect(first.status).toBe(200);
            const device = deviceCookieOf(first);
            expect(device).toBeDefined();
            const cookieValue = device!.slice(
                `${KNOWN_DEVICE_COOKIE_NAME}=`.length,
            );
            await vi.waitFor(async () =>
                expect(await recorded(uuid, cookieValue)).toBeTruthy(),
            );

            const read = vi.spyOn(env.server.stores.kv, 'get');
            const deviceWrite = vi.spyOn(env.server.stores.kv, 'set');
            const markerWrite = vi.spyOn(
                env.server.stores.kv,
                'updateReservedItemIf',
            );
            const again = await load(`${session}; ${device}`);
            expect(again.status).toBe(200);
            expect(deviceCookieOf(again)).toBeUndefined();
            const deviceKey = knownDeviceKey(uuid, deviceIdOf(cookieValue));
            const ofDevice = ([arg]: [{ key: string | string[] }]) =>
                [arg.key].flat().includes(deviceKey);
            await vi.waitFor(() =>
                expect(read.mock.calls.filter(ofDevice)).toHaveLength(1),
            );
            // Lets a write that would follow the read land before checking.
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(read.mock.calls.filter(ofDevice)).toHaveLength(1);
            expect(
                deviceWrite.mock.calls.filter(([arg]) => arg.key === deviceKey),
            ).toHaveLength(0);
            expect(
                markerWrite.mock.calls.filter(
                    ([key]) => key === knownDevicesMarkerKey(uuid),
                ),
            ).toHaveLength(0);
        });

        it('leave framed and anonymous loads alone', async () => {
            const { session, uuid } = await account();
            const framed = await load(session, 'iframe');
            expect(deviceCookieOf(framed)).toBeUndefined();
            const anonymous = await load('', 'document');
            expect(deviceCookieOf(anonymous)).toBeUndefined();
            expect(
                (
                    await env.server.stores.kv.get({
                        key: knownDevicesMarkerKey(uuid),
                    })
                ).res,
            ).toBeNull();
        });
    });
});
