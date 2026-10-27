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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('../../helpers/ensureCanPublish.js', () => ({ default: vi.fn(async () => true) }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = (key, replacements) => (Array.isArray(replacements) || replacements === undefined ? key : `${key}:${replacements}`);
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
window.html_encode = globalThis.html_encode;
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.matchMedia = () => ({ matches: false });

const { openPublishWebsiteDialog, openPublishWorkerDialog } = await import('./UIPublishDialogs.js');
const { default: ensure_can_publish } = await import('../../helpers/ensureCanPublish.js');

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const nameField = () => $('.dashboard-form-input[name="name"]');
const status = () => $('.dashboard-form-status').text();

const submitWith = async (name) => {
    if ( name !== undefined ) nameField().val(name);
    $('.dashboard-form-dialog').trigger('submit');
    for ( let i = 0; i < 5; i++ ) await settle();
};

const addRow = (path) => {
    $('body').append(`<div class="item" data-path="${path}" data-has_website="0" data-is_worker="0">`
        + '<img class="item-has-website-badge" style="display:none"><img class="item-has-website-url-badge" style="display:none">'
        + '<img class="item-is-worker" style="display:none"></div>');
    return $('.item').last();
};

beforeEach(() => {
    document.body.innerHTML = '';
    ensure_can_publish.mockClear();
    ensure_can_publish.mockResolvedValue(true);
    window.hosting_domain = 'puter.site';
    window.generate_identifier = () => 'clever-idea-42';
    window.update_sites_cache = vi.fn();
    window.require_email_verification_to_publish_website = false;
    globalThis.puter = {
        fsCacheKey: (kind, path) => `${kind}:${path}`,
        _cache: { del: vi.fn() },
        hosting: { create: vi.fn(async () => ({})) },
        workers: { create: vi.fn(async (name) => ({ success: true, url: `https://${name}.puter.work` })) },
    };
});

describe('publish website', () => {
    it('names the folder and suggests an address on the hosting domain', async () => {
        await openPublishWebsiteDialog({ name: 'Site <1>', path: '/alice/Site' });
        expect($('.dashboard-dialog-message').html()).toContain('<strong>Site &lt;1&gt;</strong>');
        expect(nameField().val()).toBe('clever-idea-42');
        expect($('.dashboard-form-suffix').text()).toBe('.puter.site');
    });

    it('publishes the folder, shows the live address, and badges its rows', async () => {
        const $folder = addRow('/alice/Site');
        const $child = addRow('/alice/Site/index.html');
        await openPublishWebsiteDialog({ name: 'Site', path: '/alice/Site' });

        await submitWith(' -My Site- ');

        expect(puter.hosting.create).toHaveBeenCalledWith('my-site', '/alice/Site');
        expect($('.dashboard-form-done p').text()).toBe('website_published');
        expect($('.dashboard-copy-value').val()).toBe('https://my-site.puter.site');
        expect($('.dashboard-publish-open').attr('href')).toBe('https://my-site.puter.site');
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        $('.dashboard-copy-btn').trigger('click');
        await settle();
        expect(writeText).toHaveBeenCalledWith('https://my-site.puter.site');
        expect($('.dashboard-copy-btn').attr('aria-label')).toBe('copied');
        expect($folder.attr('data-has_website')).toBe('1');
        expect($folder.find('.item-has-website-badge').css('display')).not.toBe('none');
        expect($child.attr('data-website_url')).toBe('https://my-site.puter.site/index.html');
        expect(window.update_sites_cache).toHaveBeenCalled();
        // Its row in /alice, when not on screen, is listed afresh next time.
        expect(puter._cache.del).toHaveBeenCalledWith('readdir:/alice');
    });

    it("links to the server's address for the site when it sends one", async () => {
        puter.hosting.create.mockResolvedValueOnce({
            subdomain: 'docs',
            root_dir: { subdomains: [{ subdomain: 'docs', address: 'http://docs.site.example.test' }] },
        });
        await openPublishWebsiteDialog({ name: 'Site', path: '/alice/Site' });
        await submitWith('docs');
        expect($('.dashboard-copy-value').val()).toBe('http://docs.site.example.test');
        expect($('.dashboard-publish-open').attr('href')).toBe('http://docs.site.example.test');
    });

    it('shapes the address as it is typed', async () => {
        await openPublishWebsiteDialog({ name: 'Site', path: '/alice/Site' });
        nameField().val('My_Site 2!').trigger('input');
        expect(nameField().val()).toBe('my-site-2');
    });

    it('leaves text being composed alone and shapes it once composed', async () => {
        await openPublishWebsiteDialog({ name: 'Site', path: '/alice/Site' });
        nameField().val('caf\u00B4');
        nameField().get(0).dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
        expect(nameField().val()).toBe('caf\u00B4');
        nameField().val('café').trigger('compositionend');
        expect(nameField().val()).toBe('cafe');
    });

        it('asks for an address when nothing usable was typed', async () => {
        await openPublishWebsiteDialog({ name: 'Site', path: '/alice/Site' });
        await submitWith('---');
        expect(status()).toBe('publish_name_required');
        expect(nameField().attr('aria-invalid')).toBe('true');
        expect(puter.hosting.create).not.toHaveBeenCalled();
    });

    it('shows why publishing failed and lets the user try again', async () => {
        puter.hosting.create.mockRejectedValueOnce({ error: { code: 'internal_error', message: 'Something broke' } });
        await openPublishWebsiteDialog({ name: 'Site', path: '/alice/Site' });
        await submitWith('fine');
        expect(status()).toBe('Something broke');
        expect(nameField().prop('disabled')).toBe(false);
        expect(nameField().attr('aria-invalid')).toBeUndefined();
    });

    it.each([
        ['conflict', 'A site with this subdomain already exists'],
        ['subdomain_reserved', "Subdomain 'www' is reserved"],
    ])('points a %s rejection at the address field', async (code, message) => {
        puter.hosting.create.mockRejectedValueOnce({ error: { code, message }, code, message });
        await openPublishWebsiteDialog({ name: 'Site', path: '/alice/Site' });
        await submitWith('www');
        expect(status()).toBe(message);
        expect(nameField().attr('aria-invalid')).toBe('true');
        expect(document.activeElement).toBe(nameField().get(0));
    });

    it('asks for verification only when the deployment needs it', async () => {
        window.require_email_verification_to_publish_website = true;
        ensure_can_publish.mockResolvedValueOnce(false);
        await openPublishWebsiteDialog({ name: 'Site', path: '/alice/Site' });
        expect(ensure_can_publish).toHaveBeenCalledWith(true);
        expect($('.dashboard-form-dialog')).toHaveLength(0);
    });
});

describe('publish worker', () => {
    it('always needs a verified account', async () => {
        await openPublishWorkerDialog({ name: 'api.js', path: '/alice/api.js' });
        expect(ensure_can_publish).toHaveBeenCalledWith(true);
    });

    it('deploys sandboxed by default and badges the file', async () => {
        const $file = addRow('/alice/api.js');
        const fsentry = { path: '/alice/api.js', workers: [] };
        $file.data('fsentry', fsentry);
        await openPublishWorkerDialog({ name: 'api.js', path: '/alice/api.js' });
        expect($('.dashboard-form-suffix').text()).toBe('.puter.work');

        await submitWith('my_api');

        expect(puter.workers.create).toHaveBeenCalledWith('my_api', '/alice/api.js', { sandbox: true });
        expect($('.dashboard-copy-value').val()).toBe('https://my_api.puter.work');
        expect($file.attr('data-is_worker')).toBe('1');
        expect($file.attr('data-worker_url')).toBe('https://my_api.puter.work');
        // What the next listing of the folder draws the row from.
        expect(fsentry.workers).toEqual([{ address: 'https://my_api.puter.work' }]);
    });

    it('deploys unsandboxed when the switch is off', async () => {
        await openPublishWorkerDialog({ name: 'api.js', path: '/alice/api.js' });
        $('.dashboard-form-input[name="sandboxed"]').prop('checked', false);
        await submitWith('api');
        expect(puter.workers.create).toHaveBeenCalledWith('api', '/alice/api.js', { sandbox: false });
    });

    it('shows a failed build in the status line', async () => {
        puter.workers.create.mockRejectedValueOnce(new Error('SyntaxError: Unexpected token'));
        await openPublishWorkerDialog({ name: 'api.js', path: '/alice/api.js' });
        await submitWith('api');
        expect(status()).toBe('SyntaxError: Unexpected token');
        expect(nameField().attr('aria-invalid')).toBeUndefined();
    });

    it('points a taken worker name at the address field', async () => {
        puter.workers.create.mockRejectedValueOnce({ error: { code: 'conflict', message: 'Worker name is already in use' } });
        await openPublishWorkerDialog({ name: 'api.js', path: '/alice/api.js' });
        await submitWith('api');
        expect(status()).toBe('Worker name is already in use');
        expect(nameField().attr('aria-invalid')).toBe('true');
    });
});
