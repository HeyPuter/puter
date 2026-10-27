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

import { installSeatStub } from '../testFixtures/seatStub.js';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { configContainer } from '../exports.js';
import { PuterServer } from '../server.js';
import { setupTestServer } from '../testUtil.js';
import type { IConfig } from '../types.js';
import { buildUserDetails, scrubSensitive } from './userDetails.js';
import { generateDefaultFsentries } from './userProvisioning.js';

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer({
        feature_flags: { create_shortcut: 'yes', payment_bypass: true },
    } as never);
});

afterAll(async () => {
    await server?.shutdown();
});

const deps = () => ({
    config: configContainer as IConfig,
    clients: server.clients,
    stores: server.stores,
    services: server.services,
});

const makeUser = async () => {
    const username = `ud_${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: 'hashed',
        email: `${username}@test.local`,
        phone: '+15550100',
    });
    await generateDefaultFsentries(
        server.clients.db,
        server.stores.user,
        created,
    );
    return (await server.stores.user.getById(created.id, { force: true }))!;
};

describe('buildUserDetails', () => {
    it('builds the desktop payload for a user actor', async () => {
        const user = await makeUser();
        const details = await buildUserDetails(user, deps(), {
            isUser: true,
        });

        expect(details).toMatchObject({
            username: user.username,
            uuid: user.uuid,
            email: user.email,
            unconfirmed_email: user.email,
            is_temp: false,
            oidc_only: false,
            feature_flags: { create_shortcut: true },
        });
        expect(details).not.toHaveProperty('phone');
        expect(details.feature_flags).not.toHaveProperty('payment_bypass');
        expect(details.directories).toMatchObject({
            [`/${user.username}/Desktop`]: user.desktop_uuid,
            [`/${user.username}/Trash`]: user.trash_uuid,
        });
        expect(Array.isArray(details.taskbar_items)).toBe(true);
    });

    it('leaves the desktop-only parts out for an app actor', async () => {
        const user = await makeUser();
        const details = await buildUserDetails(user, deps(), {
            isUser: false,
        });
        expect(details).not.toHaveProperty('taskbar_items');
        expect(details).not.toHaveProperty('directories');
        expect(details.card_fallback_available).toBe(false);
    });
});

describe('buildUserDetails lookups', () => {
    /** A dependency answer that records when it was asked and answered. */
    const timed = <T>(
        events: string[],
        label: string,
        ms: number,
        answer: () => T,
    ) =>
        new Promise<T>((resolve, reject) => {
            events.push(`${label}:start`);
            setTimeout(() => {
                events.push(`${label}:end`);
                try {
                    resolve(answer());
                } catch (error) {
                    reject(error);
                }
            }, ms);
        });

    const tailKeys = (details: Record<string, unknown>) => {
        const keys = Object.keys(details);
        return keys.slice(keys.indexOf('hasDevAccountAccess') + 1);
    };

    it('reads the linked provider, taskbar and seat together, listed in a fixed order', async () => {
        const user = {
            ...(await makeUser()),
            password: null,
            last_activity_ts: '2026-01-02 03:04:05',
        };
        const events: string[] = [];
        const d = deps();
        const details = await buildUserDetails(
            user,
            {
                ...d,
                config: { ...d.config, teams_enabled: true },
                services: {
                    oidc: {
                        getLinkedProviderForUser: () =>
                            timed(events, 'oidc', 30, () => 'google'),
                    },
                },
                stores: Object.assign(Object.create(d.stores), {
                    team: {
                        getOrgSeat: () =>
                            timed(events, 'seat', 10, () => ({
                                team_uid: 'team-1',
                                team_name: 'Team One',
                            })),
                    },
                }),
            },
            { isUser: true },
        );

        // The seat was asked for before the slower provider answered.
        expect(events.indexOf('seat:start')).toBeLessThan(
            events.indexOf('oidc:end'),
        );
        expect(tailKeys(details)).toEqual([
            'oidc_revalidate_url',
            'taskbar_items',
            'directories',
            'team',
            'last_activity_ts',
        ]);
        expect(details.oidc_revalidate_url).toContain(
            '/auth/oidc/google/start?flow=revalidate',
        );
        expect(details.team).toEqual({ uid: 'team-1', name: 'Team One' });
    });

    it('keeps each failure to its own part, warning in payload order', async () => {
        const user = {
            ...(await makeUser()),
            password: null,
            taskbar_items: JSON.stringify([{ type: 'app', name: 'editor' }]),
            last_activity_ts: '2026-01-02 03:04:05',
        };
        const events: string[] = [];
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const d = deps();
        let details: Record<string, unknown>;
        try {
            details = await buildUserDetails(
                user,
                {
                    ...d,
                    config: { ...d.config, teams_enabled: true },
                    services: {
                        oidc: {
                            getLinkedProviderForUser: () =>
                                timed(events, 'oidc', 1, () => {
                                    throw new Error('oidc down');
                                }),
                        },
                    },
                    stores: Object.assign(Object.create(d.stores), {
                        app: {
                            getByNames: () =>
                                timed(events, 'taskbar', 20, () => {
                                    throw new Error('taskbar down');
                                }),
                            getByUids: async () => new Map(),
                            getByIds: async () => new Map(),
                        },
                        // Fails first, but is reported after the taskbar.
                        team: {
                            getOrgSeat: () =>
                                timed(events, 'seat', 5, () => {
                                    throw new Error('seat down');
                                }),
                        },
                    }),
                },
                { isUser: true },
            );
            expect(warn.mock.calls).toEqual([
                ['[user-details] taskbar_items failed:', expect.any(Error)],
                ['[user-details] team lookup failed:', expect.any(Error)],
            ]);
        } finally {
            warn.mockRestore();
        }
        expect(tailKeys(details)).toEqual([
            'taskbar_items',
            'directories',
            'last_activity_ts',
        ]);
        expect(details.taskbar_items).toEqual([]);
    });
});

describe('the team a seat belongs to', () => {
    it('names it for the account itself', async () => {
        const user = await makeUser();
        installSeatStub(server as never, [user.id], {
            teamUid: 'team-xyz',
            teamName: 'Acme Corp',
        });
        (deps().config as { teams_enabled?: boolean }).teams_enabled = true;

        const details = await buildUserDetails(user, deps(), { isUser: true });
        expect(details.team).toEqual({ uid: 'team-xyz', name: 'Acme Corp' });
    });

    it('withholds it from an app actor', async () => {
        // Same class as the phone number: a seat's employer is not an app's
        // business.
        const user = await makeUser();
        installSeatStub(server as never, [user.id], { teamName: 'Acme Corp' });
        (deps().config as { teams_enabled?: boolean }).teams_enabled = true;

        const details = await buildUserDetails(user, deps(), { isUser: false });
        expect(details).not.toHaveProperty('team');
    });

    it('names none where teams is not installed', async () => {
        const user = await makeUser();
        (deps().config as { teams_enabled?: boolean }).teams_enabled = true;

        const details = await buildUserDetails(user, deps(), { isUser: true });
        expect(details).not.toHaveProperty('team');
    });
});

describe('scrubSensitive', () => {
    it('removes credentials and identifiers at any depth', () => {
        const payload = {
            username: 'u',
            phone: '+1',
            metadata: { tmp_password: 'x', nested: [{ otp_secret: 'y' }] },
        };
        scrubSensitive(payload);
        expect(payload).toEqual({
            username: 'u',
            metadata: { nested: [{}] },
        });
    });
});
