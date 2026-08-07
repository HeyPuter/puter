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

import { describe, expect, it } from 'vitest';
import {
    asRecord,
    fsEntryMimeType,
    getBoolean,
    getString,
    loadLegacyAssociatedApps,
    signEntryThumbnail,
    signingConfigFromAppConfig,
    toLegacyEntry,
} from './legacyFsHelpers.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';

const entryWithApp = (associatedAppId: number): FSEntry =>
    ({ associatedAppId }) as unknown as FSEntry;

const appRow = (
    overrides: Record<string, unknown>,
): Record<string, unknown> => ({
    id: 1,
    uid: 'app-1',
    owner_user_id: 99,
    app_owner: 99,
    icon: 'icon',
    name: 'an-app',
    title: 'An App',
    description: 'desc',
    godmode: 1,
    maximize_on_start: 1,
    index_url: 'https://an-app.puter.site/',
    background: 1,
    metadata: { secret: true },
    is_private: 0,
    protected: 0,
    ...overrides,
});

const fakeStore = (row: Record<string, unknown>) => ({
    getByIds: async (ids: number[]) =>
        new Map(ids.map((id) => [id, { ...row, id }])),
});

describe('loadLegacyAssociatedApps associated_app redaction', () => {
    it('never leaks owner identifiers, even for public apps', async () => {
        const out = await loadLegacyAssociatedApps(
            fakeStore(appRow({ is_private: 0, protected: 0 })),
            [entryWithApp(1)],
        );
        const app = out.get(1)!;
        expect(app).not.toHaveProperty('owner_user_id');
        expect(app).not.toHaveProperty('app_owner');
    });

    it('passes through hosting + capability fields for public apps', async () => {
        const out = await loadLegacyAssociatedApps(
            fakeStore(appRow({ is_private: 0, protected: 0, godmode: 1 })),
            [entryWithApp(1)],
        );
        const app = out.get(1)!;
        expect(app.index_url).toBe('https://an-app.puter.site/');
        expect(app.godmode).toBe(1);
        expect(app.maximize_on_start).toBe(1);
    });

    it('redacts hosting + capability fields for private apps', async () => {
        const out = await loadLegacyAssociatedApps(
            fakeStore(appRow({ is_private: 1, godmode: 1 })),
            [entryWithApp(1)],
        );
        const app = out.get(1)!;
        // Existence + display fields still surface...
        expect(app.uid).toBe('app-1');
        expect(app.name).toBe('an-app');
        expect(app.is_private).toBe(1);
        // ...but the sensitive bits are stripped.
        expect(app.index_url).toBeNull();
        expect(app.godmode).toBe(0);
        expect(app.maximize_on_start).toBe(0);
        expect(app.background).toBe(0);
        expect(app.metadata).toBeNull();
        expect(app).not.toHaveProperty('owner_user_id');
    });

    it('redacts the same fields for protected apps', async () => {
        const out = await loadLegacyAssociatedApps(
            fakeStore(appRow({ is_private: 0, protected: 1, godmode: 1 })),
            [entryWithApp(1)],
        );
        const app = out.get(1)!;
        expect(app.protected).toBe(1);
        expect(app.index_url).toBeNull();
        expect(app.godmode).toBe(0);
    });
});

describe('asRecord', () => {
    it.each([
        ['null', null],
        ['undefined', undefined],
        ['a number', 42],
        ['a string', 'nope'],
        ['an array', [1, 2]],
    ])('returns an empty record for %s', (_label, value) => {
        expect(asRecord(value)).toEqual({});
    });

    it('passes an object through unchanged', () => {
        const source = { a: 1 };
        expect(asRecord(source)).toBe(source);
    });
});

describe('getString', () => {
    it('returns the first non-empty string among the candidate keys', () => {
        expect(getString({ a: '', b: 'second' }, 'a', 'b')).toBe('second');
    });

    it('ignores non-string values', () => {
        expect(getString({ a: 5, b: true }, 'a', 'b')).toBeUndefined();
    });

    it('returns undefined when no key matches', () => {
        expect(getString({}, 'missing')).toBeUndefined();
    });
});

describe('getBoolean', () => {
    it.each([
        [true, true],
        [false, false],
        [1, true],
        [0, false],
        ['1', true],
        ['TRUE', true],
        [' yes ', true],
        ['on', true],
        ['0', false],
        ['false', false],
        ['no', false],
        ['off', false],
    ])('coerces %o to %s', (input, expected) => {
        expect(getBoolean({ flag: input }, 'flag')).toBe(expected);
    });

    it.each([[2], ['maybe'], [null], [{}]])(
        'returns undefined for the uncoercible value %o',
        (input) => {
            expect(getBoolean({ flag: input }, 'flag')).toBeUndefined();
        },
    );

    it('falls through to a later alias when the first key is absent', () => {
        expect(
            getBoolean({ change_name: true }, 'dedupe_name', 'change_name'),
        ).toBe(true);
    });
});

describe('fsEntryMimeType', () => {
    it('reports directories as "folder"', () => {
        expect(fsEntryMimeType({ isDir: true, name: 'Documents' })).toBe(
            'folder',
        );
    });

    it('derives a MIME type with charset from the file name', () => {
        expect(fsEntryMimeType({ isDir: false, name: 'a.png' })).toBe(
            'image/png',
        );
        expect(fsEntryMimeType({ isDir: false, name: 'a.txt' })).toContain(
            'text/plain',
        );
    });

    it('returns null for an extensionless name', () => {
        expect(fsEntryMimeType({ isDir: false, name: 'LICENSE' })).toBeNull();
    });
});

describe('signEntryThumbnail', () => {
    it('returns the input untouched when there is no event client', async () => {
        expect(
            await signEntryThumbnail(undefined, 'uuid-1', 's3://bucket/key'),
        ).toBe('s3://bucket/key');
    });

    it('normalizes a missing thumbnail to null', async () => {
        expect(await signEntryThumbnail(undefined, 'uuid-1', null)).toBeNull();
    });

    it('returns the URL the listener rewrote onto the payload', async () => {
        const eventClient = {
            emitAndWait: async (
                _key: string,
                payload: { thumbnail: string },
            ) => {
                payload.thumbnail = 'https://signed.test/thumb.png';
            },
        } as never;
        expect(
            await signEntryThumbnail(eventClient, 'uuid-1', 's3://bucket/key'),
        ).toBe('https://signed.test/thumb.png');
    });

    it('returns null when the listener blanks the thumbnail', async () => {
        const eventClient = {
            emitAndWait: async (
                _key: string,
                payload: { thumbnail: string },
            ) => {
                payload.thumbnail = '';
            },
        } as never;
        expect(
            await signEntryThumbnail(eventClient, 'uuid-1', 's3://bucket/key'),
        ).toBeNull();
    });

    it('keeps the original value when the listener throws', async () => {
        const eventClient = {
            emitAndWait: async () => {
                throw new Error('extension down');
            },
        } as never;
        expect(
            await signEntryThumbnail(eventClient, 'uuid-1', 's3://bucket/key'),
        ).toBe('s3://bucket/key');
    });
});

describe('signingConfigFromAppConfig', () => {
    it('returns the secret and api base url when both are set', () => {
        expect(
            signingConfigFromAppConfig({
                url_signature_secret: 's3cret',
                api_base_url: 'https://api.test',
            } as never),
        ).toEqual({ secret: 's3cret', apiBaseUrl: 'https://api.test' });
    });

    it('fails loudly when the signing secret is missing', () => {
        expect(() =>
            signingConfigFromAppConfig({
                api_base_url: 'https://api.test',
            } as never),
        ).toThrowError(/url_signature_secret not set/);
    });

    it('fails loudly when the api base url is missing', () => {
        expect(() =>
            signingConfigFromAppConfig({
                url_signature_secret: 's3cret',
            } as never),
        ).toThrowError(/api_base_url not set/);
    });
});

describe('toLegacyEntry', () => {
    const baseEntry = (overrides: Partial<FSEntry> = {}): FSEntry =>
        ({
            uuid: 'uuid-1',
            parentUid: 'parent-1',
            path: '/alice/Documents/report.pdf',
            name: 'report.pdf',
            isDir: false,
            isShortcut: false,
            shortcutTo: null,
            isSymlink: false,
            symlinkPath: null,
            isPublic: false,
            thumbnail: null,
            immutable: false,
            metadata: null,
            modified: 1000,
            created: 900,
            accessed: 950,
            size: 12,
            layout: null,
            subdomains: [],
            workers: [],
            suggestedApps: [],
            associatedAppId: null,
            userId: 7,
            ...overrides,
        }) as unknown as FSEntry;

    it('produces the snake_case v1 shape for a file', async () => {
        const shaped = await toLegacyEntry(undefined, baseEntry());
        expect(shaped).toMatchObject({
            id: 'uuid-1',
            uid: 'uuid-1',
            uuid: 'uuid-1',
            parent_id: 'parent-1',
            parent_uid: 'parent-1',
            dirname: '/alice/Documents',
            dirpath: '/alice/Documents',
            is_dir: false,
            is_shortcut: 0,
            is_symlink: 0,
            has_website: false,
            is_empty: false,
            associated_app: null,
            appdata_app: undefined,
        });
        expect(shaped.type).toContain('application/pdf');
    });

    it('names the owning app for an AppData path', async () => {
        const shaped = await toLegacyEntry(
            undefined,
            baseEntry({ path: '/alice/AppData/app-42/state.json' }),
        );
        expect(shaped.appdata_app).toBe('app-42');
    });

    it('reports has_website when the entry carries a subdomain', async () => {
        const shaped = await toLegacyEntry(
            undefined,
            baseEntry({
                subdomains: [{ subdomain: 'site' }] as never,
            }),
        );
        expect(shaped.has_website).toBe(true);
    });

    it('probes for children to set is_empty on a directory', async () => {
        const fsEntryStore = {
            listChildren: async () => [{ uuid: 'child' }],
        } as never;
        const shaped = await toLegacyEntry(
            undefined,
            baseEntry({ isDir: true, name: 'Documents' }),
            { fsEntryStore },
        );
        expect(shaped.is_empty).toBe(false);
        expect(shaped.type).toBe('folder');
    });

    it('treats a failed child probe as non-empty rather than throwing', async () => {
        const fsEntryStore = {
            listChildren: async () => {
                throw new Error('db down');
            },
        } as never;
        const shaped = await toLegacyEntry(
            undefined,
            baseEntry({ isDir: true }),
            { fsEntryStore },
        );
        expect(shaped.is_empty).toBe(false);
    });

    it('hydrates the owner as a username-only object', async () => {
        const userStore = {
            getById: async () => ({ username: 'alice', email: 'a@b.test' }),
        };
        const shaped = await toLegacyEntry(undefined, baseEntry(), {
            userStore,
        });
        // Username only — the rest of the user row must not ride along.
        expect(shaped.owner).toEqual({ username: 'alice' });
    });

    it('omits the owner when the lookup fails', async () => {
        const userStore = {
            getById: async () => {
                throw new Error('db down');
            },
        };
        const shaped = await toLegacyEntry(undefined, baseEntry(), {
            userStore,
        });
        expect(shaped).not.toHaveProperty('owner');
    });

    it('embeds associated_app from the prebuilt map', async () => {
        const appsById = new Map([[3, { uid: 'app-3', name: 'Editor' }]]);
        const shaped = await toLegacyEntry(
            undefined,
            baseEntry({ associatedAppId: 3 }),
            { appsById },
        );
        expect(shaped.associated_app).toEqual({ uid: 'app-3', name: 'Editor' });
    });

    it('emits a null associated_app when the id is not in the map', async () => {
        const shaped = await toLegacyEntry(
            undefined,
            baseEntry({ associatedAppId: 9 }),
            { appsById: new Map() },
        );
        expect(shaped.associated_app).toBeNull();
    });
});

describe('loadLegacyAssociatedApps short-circuit', () => {
    it('makes no store call when no entry carries an app id', async () => {
        let calls = 0;
        const store = {
            getByIds: async () => {
                calls += 1;
                return new Map();
            },
        };
        const out = await loadLegacyAssociatedApps(store, [
            { associatedAppId: null } as unknown as FSEntry,
        ]);
        expect(out.size).toBe(0);
        expect(calls).toBe(0);
    });

    it('dedupes repeated app ids into a single lookup', async () => {
        const seen: number[][] = [];
        const store = {
            getByIds: async (ids: number[]) => {
                seen.push(ids);
                return new Map(ids.map((id) => [id, appRow({ id })]));
            },
        };
        await loadLegacyAssociatedApps(store, [
            entryWithApp(4),
            entryWithApp(4),
            entryWithApp(5),
        ]);
        expect(seen).toEqual([[4, 5]]);
    });
});
