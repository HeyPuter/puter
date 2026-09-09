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

/**
 * Two teams side by side, plus a user in neither: an unscoped query still
 * returns the right rows when only one exists, so one gives false confidence.
 */

import { v4 as uuidv4 } from 'uuid';
import type { IConfig } from '../types';
import { setupPuterTestEnv, type PuterTestEnv } from '../testUtil.js';

/** An account that can call the API: verified, with a session token. */
export type FixtureUser = {
    userId: number;
    username: string;
    token: string;
};

export type FixtureTeam = {
    uid: string;
    handle: string;
    name: string;
    /** Owns the team and pays for it; `org_owned = 0`. */
    owner: FixtureUser;
    /** Provisioned seats, activated so they can make requests. */
    seats: FixtureUser[];
};

export type TwoTeams = {
    env: PuterTestEnv;
    a: FixtureTeam;
    b: FixtureTeam;
    /** Signed in, in no team at all. */
    outsider: FixtureUser;
    call: (
        method: string,
        path: string,
        token: string,
        body?: unknown,
    ) => Promise<Response>;
    shutdown: () => Promise<void>;
};

const rand = () => Math.random().toString(36).slice(2, 10);

/** Seats per team. Two is enough to tell "this one" from "all of them". */
const SEATS_PER_TEAM = 2;

/** Own owner per team, so this runs against the real cap. */
export const setupTwoTeams = async (
    configOverrides: Partial<IConfig> = {},
): Promise<TwoTeams> => {
    const env = await setupPuterTestEnv({
        teams_enabled: true,
        ...configOverrides,
    } as IConfig);

    const call = (
        method: string,
        path: string,
        token: string,
        body?: unknown,
    ) =>
        fetch(new URL(path, env.apiOrigin), {
            method,
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

    const tokenFor = async (userId: number): Promise<string> => {
        const row = await env.server.stores.user.getById(userId);
        const { token } = await env.server.services.auth.createSessionToken(
            row!,
        );
        return token;
    };

    const makeUser = async (): Promise<FixtureUser> => {
        const username = `fx_${rand()}`;
        const created = (await env.server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            // `requireVerified` rejects an unconfirmed account outright.
            email_confirmed: true,
        })) as unknown as { id: number };
        return {
            userId: created.id,
            username,
            token: await tokenFor(created.id),
        };
    };

    /** Provisioning leaves the seat unconfirmed and mid-password-change. */
    const activate = async (username: string): Promise<FixtureUser> => {
        const seat = await env.server.stores.user.getByUsername(username);
        await env.server.stores.user.update(seat!.id, {
            email_confirmed: 1,
            requires_email_confirmation: 0,
            requires_password_change: 0,
        });
        return {
            userId: seat!.id,
            username,
            token: await tokenFor(seat!.id),
        };
    };

    const expectOk = async (res: Response, what: string) => {
        if (res.status !== 200) {
            throw new Error(
                `fixture: ${what} failed with ${res.status}: ${await res.text()}`,
            );
        }
        return res;
    };

    const makeTeam = async (name: string): Promise<FixtureTeam> => {
        const owner = await makeUser();
        const handle = `ws-${rand()}`;

        const res = await expectOk(
            await call('POST', '/teams', owner.token, { name, handle }),
            `creating ${name}`,
        );
        const team = (await res.json()) as { uid: string };

        const seats: FixtureUser[] = [];
        for (let i = 0; i < SEATS_PER_TEAM; i++) {
            const username = `st_${rand()}`;
            await expectOk(
                await call('POST', `/teams/${team.uid}/members`, owner.token, {
                    username,
                    email: `${username}@test.local`,
                }),
                `provisioning into ${name}`,
            );
            seats.push(await activate(username));
        }

        return { uid: team.uid, handle, name, owner, seats };
    };

    const a = await makeTeam('Team A');
    const b = await makeTeam('Team B');
    const outsider = await makeUser();

    return { env, a, b, outsider, call, shutdown: () => env.shutdown() };
};
