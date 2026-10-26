// @vitest-environment jsdom
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const client = () => ({ enable: vi.fn(), disable: vi.fn(), status: vi.fn() });

let mod;
const registry = new Map();

beforeEach(async () => {
    registry.clear();
    globalThis.def = (value, id) => registry.set(id, value);
    vi.resetModules();
    mod = await import('./pushClient.js');
});

afterEach(() => {
    delete globalThis.def;
});

describe('push client registry', () => {
    it('has no client until one registers', () => {
        expect(mod.getPushClient()).toBeNull();
    });

    it('keeps the registered client and announces it', () => {
        const announced = vi.fn();
        window.addEventListener(mod.PUSH_CLIENT_REGISTERED_EVENT, announced);
        const first = client();
        const second = client();

        expect(mod.registerPushClient(first)).toBe(true);
        expect(mod.registerPushClient(second)).toBe(true);

        expect(mod.getPushClient()).toBe(second);
        expect(announced).toHaveBeenCalledTimes(2);
        window.removeEventListener(mod.PUSH_CLIENT_REGISTERED_EVENT, announced);
    });

    it('refuses a client missing a method', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(mod.registerPushClient({ enable () {}, status () {} })).toBe(false);
        expect(mod.registerPushClient(null)).toBe(false);
        expect(mod.getPushClient()).toBeNull();
        warn.mockRestore();
    });

    it('is reachable from service scripts as push.registerPushClient', () => {
        const registered = client();
        registry.get('push.registerPushClient')(registered);
        expect(mod.getPushClient()).toBe(registered);
    });
});
