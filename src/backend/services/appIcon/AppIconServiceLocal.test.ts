/**
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

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PuterServer } from '../../server.js';
import type { IConfig } from '../../types.js';
import { setupTestServer } from '../../testUtil.js';
import type { AppIconService } from './AppIconService.js';

// Own file (own in-process caches) so the admin lookup genuinely misses —
// a server booted alongside one that provisioned an admin would read it
// back out of the shared user cache.
let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
}, 60_000);

afterAll(async () => {
    await server?.shutdown();
}, 60_000);

describe('AppIconService — before the admin user exists', () => {
    it('defers the icons directory setup instead of failing boot', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            // The admin owns the icons directory, so without it there is
            // nothing to hang the `puter-app-icons` subdomain off; the
            // bootstrap backs off and retries on the next icon.
            await server.services.appIcon.ensureIconsDirectory();
            expect(warn).toHaveBeenCalledWith(
                '[app-icon] admin user not found; deferring icons directory setup',
            );
            expect(
                await server.stores.subdomain.existsBySubdomain(
                    'puter-app-icons',
                ),
            ).toBe(false);
        } finally {
            warn.mockRestore();
        }
    });

    it('makes the icon pipeline a no-op rather than a crash', async () => {
        const uid = `app-${uuidv4()}`;
        await expect(
            server.clients.event.emitAndWait(
                'app.new-icon',
                {
                    app_uid: uid,
                    data_url:
                        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=',
                },
                {},
            ),
        ).resolves.not.toThrow();
        expect(
            await server.stores.fsEntry.getEntryByPath(
                `/system/app_icons/${uid}.png`,
            ),
        ).toBeNull();
    });
});

// -- URL helpers and the icon pipeline (sqlite) ------------------------

const PNG_2X2_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=';
const PNG_DATA_URL = `data:image/png;base64,${PNG_2X2_BASE64}`;
const ICONS_PATH = '/system/app_icons';

describe('AppIconService', () => {
    let server: PuterServer;
    let appIcon: AppIconService;

    beforeAll(async () => {
        server = await setupTestServer({
            no_default_user: false,
            api_base_url: 'http://api.puter.localhost:4100',
        } as unknown as IConfig);
        appIcon = server.services.appIcon as unknown as AppIconService;
    }, 60_000);

    afterAll(async () => {
        await server?.shutdown();
    }, 60_000);

    const makeApp = async (icon?: string) => {
        const name = `icon-${uuidv4()}`;
        return (
            server.stores.app.create as unknown as (
                f: Record<string, unknown>,
                o: { ownerUserId: number },
            ) => Promise<{ id: number; uid: string; icon?: string }>
        )(
            {
                name,
                title: 'Icon test',
                index_url: `https://${name}.test/`,
                ...(icon ? { icon } : {}),
            },
            { ownerUserId: 1 },
        );
    };

    describe('canonical URLs', () => {
        it('serves sized and original icons off the app-icons subdomain', () => {
            expect(appIcon.getIconUrl('app-abc', 64)).toBe(
                'http://puter-app-icons.site.puter.localhost/app-abc-64.png',
            );
            expect(appIcon.getOriginalIconUrl('app-abc')).toBe(
                'http://puter-app-icons.site.puter.localhost/app-abc.png',
            );
        });

        it('normalizes a uid that is missing the app- prefix', () => {
            expect(appIcon.getIconUrl('abc', 16)).toBe(
                'http://puter-app-icons.site.puter.localhost/app-abc-16.png',
            );
            expect(appIcon.getOriginalIconUrl('abc')).toBe(
                'http://puter-app-icons.site.puter.localhost/app-abc.png',
            );
        });

        it('appends a non-standard public port and omits 80/443', () => {
            const cfg = (
                appIcon as unknown as { config: Record<string, unknown> }
            ).config;
            cfg.pub_port = 8080;
            expect(appIcon.getIconUrl('app-abc', 32)).toContain(
                'site.puter.localhost:8080/',
            );
            cfg.pub_port = 443;
            expect(appIcon.getIconUrl('app-abc', 32)).toContain(
                'site.puter.localhost/',
            );
            delete cfg.pub_port;
        });

        it('falls back to the alternate hosting domain, and gives up without either', async () => {
            const cfg = (
                appIcon as unknown as { config: Record<string, unknown> }
            ).config;
            const primary = cfg.static_hosting_domain;
            cfg.static_hosting_domain = undefined;
            expect(appIcon.getIconUrl('app-abc', 32)).toBe(
                'http://puter-app-icons.host.puter.localhost/app-abc-32.png',
            );

            const alt = cfg.static_hosting_domain_alt;
            cfg.static_hosting_domain_alt = undefined;
            expect(appIcon.getIconUrl('app-abc', 32)).toBeNull();
            expect(appIcon.getOriginalIconUrl('app-abc')).toBeNull();
            expect(
                await appIcon.resolveIconRedirectUrl('app-abc', 32),
            ).toBeNull();

            cfg.static_hosting_domain = primary;
            cfg.static_hosting_domain_alt = alt;
        });
    });

    describe('resolveIconRedirectUrl', () => {
        it('returns null when neither the sized nor the original file exists', async () => {
            expect(
                await appIcon.resolveIconRedirectUrl(`app-${uuidv4()}`, 64),
            ).toBeNull();
        });

        it('prefers the sized variant, and falls back to the original', async () => {
            const app = await makeApp();
            await server.clients.event.emitAndWait(
                'app.new-icon',
                { app_uid: app.uid, data_url: PNG_DATA_URL },
                {},
            );

            expect(await appIcon.resolveIconRedirectUrl(app.uid, 64)).toBe(
                `http://puter-app-icons.site.puter.localhost/${app.uid}-64.png`,
            );

            // No 999px variant is generated — fall back to the original.
            expect(await appIcon.resolveIconRedirectUrl(app.uid, 999)).toBe(
                `http://puter-app-icons.site.puter.localhost/${app.uid}.png`,
            );
        });
    });

    describe('icon pipeline', () => {
        it('writes the original plus every standard size and rewrites the icon column', async () => {
            const app = await makeApp(PNG_DATA_URL);
            const migrated: unknown[] = [];
            const onChanged = (_k: string, data: unknown) => {
                const d = data as { app_uid?: string; action?: string };
                if (d?.app_uid === app.uid && d.action === 'icon-migrated') {
                    migrated.push(d);
                }
            };
            server.clients.event.on('app.changed', onChanged);

            await server.clients.event.emitAndWait(
                'app.new-icon',
                { appUid: app.uid, dataUrl: PNG_DATA_URL },
                {},
            );

            for (const size of [16, 32, 64, 128, 256, 512]) {
                const entry = await server.stores.fsEntry.getEntryByPath(
                    `${ICONS_PATH}/${app.uid}-${size}.png`,
                );
                expect(entry, `missing ${size}px icon`).toBeTruthy();
            }
            expect(
                await server.stores.fsEntry.getEntryByPath(
                    `${ICONS_PATH}/${app.uid}.png`,
                ),
            ).toBeTruthy();

            // The DB icon column no longer carries the base64 payload.
            const fresh = await server.stores.app.getByUid(app.uid);
            expect(fresh?.icon).toBe(
                `http://api.puter.localhost:4100/app-icon/${app.uid}`,
            );
            await vi.waitFor(() => expect(migrated).toHaveLength(1));
            server.clients.event.off('app.changed', onChanged);
        });

        it('lazily migrates an app whose icon was written as a data URL elsewhere', async () => {
            const app = await makeApp(PNG_DATA_URL);
            await server.clients.event.emitAndWait(
                'app.changed',
                { app_uid: app.uid, action: 'updated' },
                {},
            );
            const fresh = await server.stores.app.getByUid(app.uid);
            expect(fresh?.icon).toBe(
                `http://api.puter.localhost:4100/app-icon/${app.uid}`,
            );
        });

        it('does not re-enter on its own icon-migrated notice', async () => {
            const app = await makeApp(PNG_DATA_URL);
            await server.clients.event.emitAndWait(
                'app.changed',
                { app_uid: app.uid, action: 'icon-migrated' },
                {},
            );
            const fresh = await server.stores.app.getByUid(app.uid);
            expect(fresh?.icon).toBe(PNG_DATA_URL);
        });

        it('ignores a change notice with no app and an app whose icon is a URL', async () => {
            const app = await makeApp('https://cdn.example/icon.png');
            await server.clients.event.emitAndWait('app.changed', {}, {});
            await server.clients.event.emitAndWait(
                'app.changed',
                { app_uid: app.uid, action: 'updated' },
                {},
            );
            const fresh = await server.stores.app.getByUid(app.uid);
            expect(fresh?.icon).toBe('https://cdn.example/icon.png');
        });

        it('skips a payload with no uid, no data, an unparsable data URL, or empty bytes', async () => {
            const app = await makeApp();
            const before = await server.stores.app.getByUid(app.uid);
            for (const payload of [
                { app_uid: app.uid },
                { data_url: PNG_DATA_URL },
                { app_uid: app.uid, data_url: 'data-url-with-no-comma' },
                { app_uid: app.uid, data_url: 'data:image/png;base64,' },
            ]) {
                await server.clients.event.emitAndWait(
                    'app.new-icon',
                    payload,
                    {},
                );
            }
            expect(
                await server.stores.fsEntry.getEntryByPath(
                    `${ICONS_PATH}/${app.uid}.png`,
                ),
            ).toBeNull();
            expect((await server.stores.app.getByUid(app.uid))?.icon).toBe(
                before?.icon ?? null,
            );
        });

        it('logs and swallows a failure inside the pipeline', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const app = await makeApp();
            const realWrite = server.clients.db.write.bind(server.clients.db);
            const writeSpy = vi
                .spyOn(server.clients.db, 'write')
                .mockImplementation(async (sql: string, params?: unknown[]) => {
                    if (String(sql).includes('UPDATE `apps` SET `icon`')) {
                        throw new Error('db unavailable');
                    }
                    return realWrite(sql, params);
                });
            try {
                await expect(
                    server.clients.event.emitAndWait(
                        'app.new-icon',
                        { app_uid: app.uid, data_url: PNG_DATA_URL },
                        {},
                    ),
                ).resolves.not.toThrow();
                expect(warn).toHaveBeenCalledWith(
                    '[app-icon] icon processing failed',
                    expect.anything(),
                );
            } finally {
                writeSpy.mockRestore();
                warn.mockRestore();
            }
        });
    });
});
