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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { permissionDialog } = vi.hoisted(() => ({ permissionDialog: vi.fn() }));
vi.mock('../UI/UIPermissionDialog.js', () => ({ default: permissionDialog }));

const { askPushPermission } = await import('./askPushPermission.js');
const { registerPushClient } = await import('./pushClient.js');

let browser;

beforeEach(() => {
    permissionDialog.mockReset();
    globalThis.gui_params = { pushEnabled: true };
    browser = { permission: 'granted', registered: false };
    registerPushClient({
        enable: async () => ({ deviceUid: 'd-1' }),
        disable: async () => {},
        status: async () => ({ ...browser }),
    });
});

describe('askPushPermission', () => {
    it('asks for a website by its origin, and is on once Allow`s registration settles', async () => {
        permissionDialog.mockImplementation(async (options) => {
            options.on_push_enable(Promise.resolve(true).then(() => {
                browser.registered = true;
            }));
            return true;
        });
        await expect(askPushPermission({ origin: 'https://site.example' })).resolves.toBe('on');
        expect(permissionDialog).toHaveBeenCalledWith(expect.objectContaining({ origin: 'https://site.example', permission: 'notifications:push' }));
    });

    it('is off when denied, and asks nothing without a requester or where push can`t turn on', async () => {
        permissionDialog.mockResolvedValue(false);
        await expect(askPushPermission({ origin: 'https://site.example' })).resolves.toBe('off');
        await expect(askPushPermission({})).resolves.toBe('unavailable');
        browser.permission = 'denied';
        await expect(askPushPermission({ origin: 'https://site.example' })).resolves.toBe('blocked');
        expect(permissionDialog).toHaveBeenCalledTimes(1);
    });
});
