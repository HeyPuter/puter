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
const flush = async () => {
    for ( let i = 0; i < 5; i++ ) await settle();
};
const nameField = () => $('.dashboard-form-input[name="name"]');
const status = () => $('.dashboard-form-status').text();

const submitWith = async (name) => {
    if ( name !== undefined ) nameField().val(name);
    $('.dashboard-form-dialog').trigger('submit');
    await flush();
};

const json = (code, data) => new Response(JSON.stringify(data), {
    status: code,
    headers: { 'Content-Type': 'application/json' },
});

/**
 * Stands in for the `/custom-domains` API. The list call answers with
 * `list`; anything else with its entry in `routes` (keyed `METHOD /path`),
 * or a 404.
 */
const serveDomains = ({ list = { items: [], canAdd: true, pricing: { amount: 0.5, currency: 'USD' } }, routes = {} } = {}) => {
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
        const key = `${opts.method ?? 'GET'} ${String(url).split('/custom-domains')[1]}`;
        if ( key === 'GET ' ) return json(200, typeof list === 'function' ? list() : list);
        return routes[key]?.(opts.body ? JSON.parse(opts.body) : undefined) ?? json(404, {});
    });
};
const requests = (method) => fetch.mock.calls
    .filter(([, opts = {}]) => (opts.method ?? 'GET') === method)
    .map(([url, opts]) => ({ path: String(url).split('/custom-domains')[1], body: opts.body ? JSON.parse(opts.body) : undefined }));

const pendingDomain = (overrides = {}) => ({
    uuid: 'd1',
    hostname: 'www.example.com',
    site: 'my-site',
    status: 'pending',
    isApex: false,
    records: [{ type: 'CNAME', name: 'www', value: 'my-site.puter.site', purpose: 'routing', required: true }],
    ...overrides,
});

const domainSwitch = () => $('.dashboard-form-input[name="useDomain"]');
const domainField = () => $('.dashboard-form-input[name="domain"]');
const shown = (name) => $(`.dashboard-form-field[data-field="${name}"]`).prop('hidden') === false;
const submitLabel = () => $('.dashboard-form-submit-label').text();
const turnOnDomain = () => domainSwitch().prop('checked', true).trigger('change');

/** Opens the website dialog and waits for the custom domain list. */
const openWebsite = async () => {
    await openPublishWebsiteDialog({ name: 'Site', path: '/alice/Site' });
    await flush();
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
    window.api_origin = 'https://api.puter.test';
    delete window.UIUpgradeAccount;
    // A Puter without custom domains, unless a test serves them.
    globalThis.fetch = vi.fn(async () => json(404, {}));
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

describe('publish website on a custom domain', () => {
    it('leaves the option out where the server has no custom domains', async () => {
        await openWebsite();
        expect(shown('useDomain')).toBe(false);
        expect(shown('domain')).toBe(false);
        await submitWith('my-site');
        expect(puter.hosting.create).toHaveBeenCalledWith('my-site', '/alice/Site');
        expect(requests('POST')).toEqual([]);
    });

    it('asks for the domain once the switch is on, with what it costs', async () => {
        serveDomains();
        await openWebsite();
        expect(shown('useDomain')).toBe(true);
        expect(shown('domain')).toBe(false);

        turnOnDomain();

        expect(shown('domain')).toBe(true);
        expect(document.activeElement).toBe(domainField().get(0));
        expect($('.dashboard-form-field[data-field="domain"] .dashboard-form-hint').text())
            .toBe('publish_custom_domain_dns_hint custom_domain_price_note');
        expect($('.dashboard-publish-upsell').prop('hidden')).toBe(true);
    });

    it('publishes the site, adds the domain, and shows the records to set', async () => {
        serveDomains({ routes: { 'POST ': () => json(201, pendingDomain()) } });
        await openWebsite();
        turnOnDomain();
        domainField().val('https://WWW.Example.com/about');

        await submitWith('my-site');

        expect(puter.hosting.create).toHaveBeenCalledWith('my-site', '/alice/Site');
        expect(requests('POST')).toEqual([{ path: '', body: { site: 'my-site', hostname: 'www.example.com' } }]);
        expect($('.dashboard-form-done p').text()).toBe('website_published');
        expect($('.dashboard-copy-value').first().val()).toBe('https://my-site.puter.site');
        expect($('.dashboard-publish-domain-host').text()).toBe('www.example.com');
        expect($('.dashboard-publish-domain-badge').attr('data-status')).toBe('pending');
        expect($('.dashboard-dns-record-type').text()).toBe('CNAME');
        expect($('.dashboard-dns-record .dashboard-copy-value').map((_, el) => el.value).get())
            .toEqual(['www', 'my-site.puter.site']);
    });

    it('keeps the records up through a stray click outside the card', async () => {
        serveDomains({ routes: { 'POST ': () => json(201, pendingDomain()) } });
        await openWebsite();
        turnOnDomain();
        domainField().val('www.example.com');
        await submitWith('my-site');

        const $backdrop = $('.dashboard-dialog-overlay');
        $backdrop.trigger('mousedown').trigger('click');
        await flush();
        expect($backdrop.hasClass('dashboard-dialog-show')).toBe(true);
        expect($('.dashboard-dns-record')).toHaveLength(1);
    });

    it('checks the domain again and shows its address once connected', async () => {
        serveDomains({
            routes: {
                'POST ': () => json(201, pendingDomain()),
                'GET /d1': () => json(200, pendingDomain({ status: 'active', records: [] })),
            },
        });
        await openWebsite();
        turnOnDomain();
        domainField().val('www.example.com');
        await submitWith('my-site');

        $('.dashboard-publish-domain-check').trigger('click');
        await flush();

        expect(requests('GET').map((r) => r.path)).toContain('/d1');
        expect($('.dashboard-publish-domain-badge').attr('data-status')).toBe('active');
        expect($('.dashboard-publish-domain .dashboard-copy-value').val()).toBe('https://www.example.com');
        expect($('.dashboard-publish-domain-status').text()).toBe('custom_domain_success_note');
        expect($('.dashboard-publish-domain-check')).toHaveLength(0);
    });

    it('announces a check in the status region already on screen', async () => {
        serveDomains({
            routes: {
                'POST ': () => json(201, pendingDomain()),
                'GET /d1': () => json(200, pendingDomain()),
            },
        });
        await openWebsite();
        turnOnDomain();
        domainField().val('www.example.com');
        await submitWith('my-site');
        const el_status = $('.dashboard-publish-domain-status').get(0);

        $('.dashboard-publish-domain-check').trigger('click');
        await flush();

        expect($('.dashboard-publish-domain-status').get(0)).toBe(el_status);
        expect(el_status.textContent).toBe('custom_domain_status_pending');
        // The redrawn records are not read out again.
        expect($('.dashboard-dns-record').closest('[aria-live]').attr('aria-live')).toBe('off');
    });

    it('runs one domain action at a time on the done screen', async () => {
        let answer_check;
        serveDomains({
            routes: {
                'POST ': () => json(201, pendingDomain({ hostname: 'example.com', isApex: true })),
                'GET /d1': () => new Promise((resolve) => {
                    answer_check = () => resolve(json(200, pendingDomain({ hostname: 'example.com', isApex: true })));
                }),
                'POST /d1/use-www': () => json(200, pendingDomain({ redirectFrom: 'example.com' })),
            },
        });
        await openWebsite();
        turnOnDomain();
        domainField().val('example.com');
        await submitWith('my-site');

        $('.dashboard-publish-domain-check').trigger('click');
        await flush();
        expect($('.dashboard-publish-domain-www').prop('disabled')).toBe(true);
        $('.dashboard-publish-domain-www').trigger('click');
        await flush();
        expect(requests('POST').map((r) => r.path)).not.toContain('/d1/use-www');

        answer_check();
        await flush();
        expect($('.dashboard-publish-domain-www').prop('disabled')).toBe(false);
    });

    it('stops before publishing when the domain is not one', async () => {
        serveDomains();
        await openWebsite();
        turnOnDomain();
        domainField().val('localhost');

        await submitWith('my-site');

        expect(status()).toBe('custom_domain_error_invalid');
        expect(domainField().attr('aria-invalid')).toBe('true');
        expect(puter.hosting.create).not.toHaveBeenCalled();
    });

    it('keeps the live site and retries only the domain when adding it fails', async () => {
        const add = vi.fn()
            .mockReturnValueOnce(json(409, { code: 'custom_domain_taken', message: 'That hostname is already in use' }))
            .mockReturnValueOnce(json(201, pendingDomain({ hostname: 'www.example.org' })));
        serveDomains({ routes: { 'POST ': add } });
        await openWebsite();
        turnOnDomain();
        domainField().val('www.example.com');

        await submitWith('my-site');

        expect(status()).toBe('publish_domain_failed\ncustom_domain_error_taken');
        expect(domainField().attr('aria-invalid')).toBe('true');
        expect(nameField().prop('readOnly')).toBe(true);
        expect(submitLabel()).toBe('custom_domain_add');
        // Published now, so the hint no longer speaks of "after publishing".
        expect($('.dashboard-form-field[data-field="domain"] .dashboard-form-hint').text()).toBe('custom_domain_price_note');

        domainField().val('www.example.org');
        await submitWith();

        expect(puter.hosting.create).toHaveBeenCalledTimes(1);
        expect(add).toHaveBeenLastCalledWith({ site: 'my-site', hostname: 'www.example.org' });
        expect($('.dashboard-publish-domain-host').text()).toBe('www.example.org');
    });

    it('finishes with just the site when the domain is turned off after a failure', async () => {
        serveDomains({ routes: { 'POST ': () => json(409, { code: 'custom_domain_taken' }) } });
        await openWebsite();
        turnOnDomain();
        domainField().val('www.example.com');
        await submitWith('my-site');

        domainSwitch().prop('checked', false).trigger('change');
        expect(submitLabel()).toBe('done');
        await submitWith();

        expect(puter.hosting.create).toHaveBeenCalledTimes(1);
        expect($('.dashboard-form-done p').text()).toBe('website_published');
        expect($('.dashboard-publish-domain')).toHaveLength(0);
    });

    it('moves a domain already on the account instead of adding it again', async () => {
        serveDomains({
            list: { items: [pendingDomain({ site: 'old-site', status: 'active' })], canAdd: true },
            routes: { 'PATCH /d1': () => json(200, pendingDomain({ status: 'active' })) },
        });
        await openWebsite();
        turnOnDomain();
        expect($(`#${domainField().attr('list')} option`).map((_, el) => el.value).get()).toEqual(['www.example.com']);
        domainField().val('www.example.com').trigger('input');
        expect($('.dashboard-form-field[data-field="domain"] .dashboard-form-hint').text()).toBe('publish_custom_domain_moves');

        await submitWith('my-site');

        expect(requests('POST')).toEqual([]);
        expect(requests('PATCH')).toEqual([{ path: '/d1', body: { site: 'my-site' } }]);
        expect($('.dashboard-publish-domain-badge').attr('data-status')).toBe('active');
    });

    it('says the www hostname serves the site and the root domain forwards to it', async () => {
        serveDomains({
            routes: {
                'POST ': () => json(201, pendingDomain({
                    redirectFrom: 'example.com',
                    records: [
                        { type: 'CNAME', name: 'www', value: 'my-site.puter.site', purpose: 'routing', required: true },
                        { type: 'A', name: '@', value: '192.0.2.1', purpose: 'redirect', required: true },
                    ],
                })),
            },
        });
        await openWebsite();
        turnOnDomain();
        domainField().val('www.example.com');
        const i18n_stub = globalThis.i18n;
        globalThis.i18n = (key, replacements) => (Array.isArray(replacements) && replacements.length ? `${key}:${replacements.join('|')}` : key);
        try {
            await submitWith('my-site');
        } finally {
            globalThis.i18n = i18n_stub;
        }

        expect($('.dashboard-publish-domain .dashboard-form-hint').last().text())
            .toBe('custom_domain_redirect_note:www.example.com|example.com');
    });

    it('shows the ownership record for a domain held by another account', async () => {
        const add = vi.fn(() => json(409, {
            code: 'custom_domain_claim_required',
            verification: { name: '_puter.www.example.com', value: 'token-1' },
        }));
        serveDomains({ routes: { 'POST ': add } });
        await openWebsite();
        turnOnDomain();
        domainField().val('www.example.com');

        await submitWith('my-site');

        expect($('.dashboard-publish-claim').prop('hidden')).toBe(false);
        expect($('.dashboard-publish-claim .dashboard-dns-record-type').text()).toBe('TXT');
        expect($('.dashboard-publish-claim .dashboard-copy-value').map((_, el) => el.value).get())
            .toEqual(['_puter.www.example.com', 'token-1']);
        expect(submitLabel()).toBe('custom_domain_verify_and_add');
        expect(status()).toBe('publish_site_live');

        await submitWith();
        expect(status()).toBe('publish_domain_failed\ncustom_domain_claim_not_found');

        // A claim is for one hostname; editing it starts over.
        domainField().val('www.example.net').trigger('input');
        expect($('.dashboard-publish-claim').prop('hidden')).toBe(true);
        expect(submitLabel()).toBe('custom_domain_add');

        // Back to the claimed hostname, its record and the verify step return together.
        domainField().val('www.example.com').trigger('input');
        expect($('.dashboard-publish-claim').prop('hidden')).toBe(false);
        expect(submitLabel()).toBe('custom_domain_verify_and_add');
    });

    describe('on a plan without custom domains', () => {
        beforeEach(() => {
            window.UIUpgradeAccount = vi.fn(function () {
                this.open_as_window = vi.fn();
            });
        });

        it('offers the upgrade in place of the field, leaving focus on the switch', async () => {
            serveDomains({ list: { items: [], canAdd: false } });
            await openWebsite();
            domainSwitch().get(0).focus();
            turnOnDomain();

            expect(shown('domain')).toBe(false);
            expect($('.dashboard-publish-upsell').prop('hidden')).toBe(false);
            expect(document.activeElement).toBe(domainSwitch().get(0));
            $('.dashboard-publish-upgrade').trigger('click');
            expect(window.UIUpgradeAccount).toHaveBeenCalled();
        });

        it('does not publish while the switch asks for a domain it cannot add', async () => {
            serveDomains({ list: { items: [], canAdd: false } });
            await openWebsite();
            turnOnDomain();
            await submitWith('my-site');
            expect(status()).toBe('publish_custom_domain_needs_plan');
            expect(puter.hosting.create).not.toHaveBeenCalled();
        });

        it('unlocks the field once the upgrade goes through', async () => {
            let can_add = false;
            serveDomains({ list: () => ({ items: [], canAdd: can_add }) });
            await openWebsite();
            turnOnDomain();
            $('.dashboard-publish-upgrade').trigger('click');

            can_add = true;
            window.dispatchEvent(new CustomEvent('puter:subscription:changed'));
            await flush();

            expect(shown('domain')).toBe(true);
            expect($('.dashboard-publish-upsell').prop('hidden')).toBe(true);
            expect(document.activeElement).toBe(domainField().get(0));
        });

        it('only listens for a plan change once it has offered the upgrade', async () => {
            serveDomains({ list: { items: [], canAdd: false } });
            const listen = vi.spyOn(window, 'addEventListener');
            try {
                await openWebsite();
                turnOnDomain();
                expect(listen.mock.calls.map(([type]) => type)).not.toContain('puter:subscription:changed');
                $('.dashboard-publish-upgrade').trigger('click');
                expect(listen.mock.calls.map(([type]) => type)).toContain('puter:subscription:changed');
            } finally {
                listen.mockRestore();
            }
        });

        it('explains the plan without a button where there is no upgrade flow', async () => {
            delete window.UIUpgradeAccount;
            serveDomains({ list: { items: [], canAdd: false } });
            await openWebsite();
            turnOnDomain();
            expect($('.dashboard-publish-upgrade')).toHaveLength(0);
            await submitWith('my-site');
            expect(status()).toBe('custom_domain_error_plan');
        });

        it('finishes with the live site when adding the domain turns out to need a plan', async () => {
            serveDomains({ routes: { 'POST ': () => json(402, { code: 'subscription_required' }) } });
            await openWebsite();
            turnOnDomain();
            domainField().val('www.example.com');
            await submitWith('my-site');

            expect(status()).toBe('publish_domain_failed\ncustom_domain_error_plan');
            expect($('.dashboard-publish-upsell').prop('hidden')).toBe(false);
            expect(submitLabel()).toBe('done');

            await submitWith();
            expect(puter.hosting.create).toHaveBeenCalledTimes(1);
            expect(requests('POST')).toHaveLength(1);
            expect($('.dashboard-form-done p').text()).toBe('website_published');
            expect($('.dashboard-publish-domain')).toHaveLength(0);
        });
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
