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
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('./UIWindow.js', () => ({
    default: vi.fn(async (opts) => {
        const el = document.createElement('div');
        el.className = `window ${opts.window_class}`;
        el.innerHTML = opts.body_content;
        document.body.append(el);
        return el;
    }),
}));

globalThis.def = globalThis.def ?? (value => value);

const { default: UIWindowAuthMe } = await import('./UIWindowAuthMe.js');

const RELAY = 'https://mcp.puter.test/oauth/callback?flow=x&forwards_to=client.example';

/** Opens the dialog and returns the destination box once it has rendered. */
const openDialog = async (options) => {
    const result = UIWindowAuthMe(options);
    await vi.waitFor(() => expect(jQuery('.window-authme')).toHaveLength(1));
    const box = jQuery('.window-authme strong').first().parent();
    return { result, host: box.find('strong').text(), detail: box.find('div').text() };
};

beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.$ = jQuery;
    jQuery.fn.close = function () {
        this.remove();
        return this;
    };
    globalThis.i18n = (key, vars) =>
        vars ? `${key}(${Object.values(vars).join(',')})` : key;
    globalThis.html_encode = (value) =>
        String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;');
});

describe('UIWindowAuthMe destination', () => {
    it('leads with the host a relay passes the grant on to, and names the relay under it', async () => {
        const { host, detail } = await openDialog({
            redirect_url: RELAY,
            forwards_to: 'client.example',
        });
        expect(host).toBe('client.example');
        expect(detail).toBe('authme_forwarded_through(mcp.puter.test)');
    });

    it('shows the redirect itself when nothing is passed on', async () => {
        const { host, detail } = await openDialog({
            redirect_url: 'https://app.example/cb?x=1',
        });
        expect(host).toBe('app.example');
        expect(detail).toBe('https://app.example/cb');
    });

    it('approves on click and resolves true', async () => {
        const { result } = await openDialog({
            redirect_url: RELAY,
            forwards_to: 'client.example',
        });
        jQuery('.authme-approve').trigger('click');
        expect(await result).toBe(true);
    });
});
