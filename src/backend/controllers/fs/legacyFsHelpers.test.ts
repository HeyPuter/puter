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

import { describe, expect, it } from 'vitest';
import { loadLegacyAssociatedApps } from './legacyFsHelpers.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';

const entryWithApp = (associatedAppId: number): FSEntry =>
    ({ associatedAppId }) as unknown as FSEntry;

const appRow = (overrides: Record<string, unknown>): Record<string, unknown> => ({
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
