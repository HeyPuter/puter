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

// The custom domain part of the Publish Website dialog: a switch that asks
// for a domain, an upgrade prompt where the plan doesn't include one, and,
// once the site is live, the domain's DNS records with a status check.

import { isPlausibleHostname, normalizeHostnameInput } from '../../helpers/customDomainHostname.js';
import {
    CUSTOM_DOMAIN_HOSTNAME_ERRORS,
    customDomainErrorText,
    customDomainsRequest,
    customDomainStatus,
    formatCustomDomainPrice,
    mergeCustomDomainRefresh,
} from '../../helpers/customDomains.js';
import { has_upgrade_flow, open_upgrade_flow } from '../../helpers/planGate.js';
import { SVG } from './UIDashboardDialog.js';
import { copyRowHtml } from './UIDashboardFormDialog.js';

/** @typedef {import('../../helpers/customDomains.js').CustomDomain} CustomDomain */
/** @typedef {import('../../helpers/customDomains.js').CustomDomainRecord} CustomDomainRecord */
/** @typedef {import('./UIDashboardFormDialog.js').FormDialog} FormDialog */
/** @typedef {import('./UIDashboardFormDialog.js').FormDialogField} FormDialogField */

const t = (key, args = []) => i18n(key, args, false);

const ICONS = {
    open: SVG('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>'),
    globe: SVG('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>'),
    sparkle: SVG('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>'),
};

const BADGE_KEYS = {
    active: 'custom_domain_badge_active',
    pending: 'custom_domain_badge_pending',
    failed: 'custom_domain_badge_failed',
};

/**
 * An icon link opening `url` in a new tab, beside a compact copy row.
 *
 * @param {string} url
 * @returns {string}
 */
export const openLinkHtml = (url) =>
    `<a class="dashboard-dialog-btn dashboard-dialog-btn-quiet dashboard-icon-btn dashboard-publish-open" href="${html_encode(url)}"`
    + ` target="_blank" rel="noopener noreferrer" aria-label="${i18n('open_in_new_tab')}" title="${i18n('open_in_new_tab')}">${ICONS.open}</a>`;

/**
 * DNS records as cards: the type, then the name and value, each with a Copy
 * button the form dialog wires.
 *
 * @param {CustomDomainRecord[]} records
 * @param {{ isApex?: boolean }} [domain] A root domain's routing record can
 *   be any of the record types that alias a root.
 * @returns {string}
 */
export const dnsRecordsHtml = (records, { isApex = false } = {}) => records.map((record) => {
    const type = isApex && record.purpose === 'routing' ? t('custom_domain_record_type_apex') : record.type;
    const field = (labelKey, value) => '<div class="dashboard-dns-record-field">'
        + `<span class="dashboard-dns-record-label">${i18n(labelKey)}</span>`
        + copyRowHtml({ value, label: `${type} ${t(labelKey)}`, compact: true })
        + '</div>';
    return '<div class="dashboard-dns-record">'
        + '<div class="dashboard-dns-record-head">'
        + `<span class="dashboard-dns-record-type">${html_encode(type)}</span>`
        + (record.required === false ? `<span class="dashboard-dns-record-optional">${i18n('custom_domain_optional')}</span>` : '')
        + '</div>'
        + field('name', record.name)
        + field('custom_domain_record_value', record.value)
        + '</div>';
}).join('');

/**
 * The done screen's account of a domain: its status, and until it's
 * connected, the records still to set.
 *
 * @param {CustomDomain} domain
 * @returns {string}
 */
export const domainSummaryHtml = (domain) => {
    const status = customDomainStatus(domain);
    let h = '<div class="dashboard-publish-domain-head">'
        + `<span class="dashboard-publish-domain-icon">${ICONS.globe}</span>`
        + `<span class="dashboard-publish-domain-host">${html_encode(domain.hostname)}</span>`
        + `<span class="dashboard-publish-domain-badge" data-status="${status}">${i18n(BADGE_KEYS[status])}</span>`
        + '</div>';
    if ( status === 'active' ) {
        const url = `https://${domain.hostname}`;
        h += copyRowHtml({ value: url, label: domain.hostname, compact: true, after: openLinkHtml(url) });
    } else {
        if ( status === 'failed' && domain.statusDetail ) {
            h += `<p class="dashboard-publish-domain-detail">${html_encode(domain.statusDetail)}</p>`;
        }
        h += `<p class="dashboard-form-hint">${i18n('custom_domain_records_c2a')}</p>`;
        h += `<div class="dashboard-dns-records">${dnsRecordsHtml(domain.records ?? [], domain)}</div>`;
        if ( domain.isApex ) {
            h += `<p class="dashboard-form-hint">${i18n('custom_domain_apex_hint')}</p>`;
            h += `<button type="button" class="dashboard-publish-link-btn dashboard-publish-domain-www">${i18n('custom_domain_no_root_alias')}</button>`;
        }
    }
    if ( domain.redirectFrom ) {
        h += `<p class="dashboard-form-hint">${i18n('custom_domain_redirect_note', [domain.hostname, domain.redirectFrom])}</p>`;
    }
    if ( status !== 'active' ) {
        h += '<div class="dashboard-publish-domain-actions">'
            + '<button type="button" class="dashboard-dialog-btn dashboard-dialog-btn-quiet dashboard-publish-domain-check">'
            + '<span class="dashboard-form-spinner" aria-hidden="true"></span>'
            + `<span>${i18n('custom_domain_check_status')}</span>`
            + '</button>'
            + '</div>';
    }
    return h;
};

/**
 * The switch and the domain field. Both start hidden: the switch shows once
 * the server answers that it has custom domains.
 *
 * @returns {FormDialogField[]}
 */
export const publishDomainFields = () => [
    {
        name: 'useDomain',
        type: 'switch',
        label: i18n('publish_custom_domain'),
        hint: i18n('publish_custom_domain_hint'),
        hidden: true,
    },
    {
        name: 'domain',
        label: i18n('custom_domain_hostname_label'),
        placeholder: 'www.example.com',
        hint: i18n('publish_custom_domain_dns_hint'),
        hidden: true,
        attrs: {
            inputmode: 'url',
            enterkeyhint: 'go',
            autocomplete: 'off',
            autocapitalize: 'off',
            autocorrect: 'off',
            spellcheck: 'false',
            'data-gramm_editor': 'false',
        },
    },
];

/**
 * @typedef {object} PublishDomain
 * @property {() => boolean} addable Whether the switch is on and the plan
 *   lets a domain be added.
 * @property {(live: boolean) => string | null | false} prepare Before each
 *   submit: null when no domain is to be added (including when the site is
 *   `live` and the plan can't add one), false when the form can't go ahead
 *   (the dialog says why), else the hostname to add.
 * @property {(hostname: string, site: { name: string, url: string }) => Promise<CustomDomain | null>} attach
 *   Adds the hostname to the live site, or moves it there when it's already
 *   on the account. Null when it didn't; the dialog says why.
 * @property {(domain: CustomDomain) => string} doneHtml The done screen's domain part.
 * @property {() => boolean} claiming Whether an ownership record for the
 *   typed hostname is on screen, waiting to be verified.
 */

/**
 * Wires the custom domain fields of a publish form dialog.
 *
 * @param {FormDialog} dialog
 * @param {object} opts
 * @param {() => void} opts.onChange Runs when what the submit button does may
 *   have changed: the switch, the plan, or a claim to verify.
 * @returns {PublishDomain}
 */
export const setupPublishDomain = (dialog, { onChange }) => {
    const { $dialog } = dialog;
    const $switch = dialog.field('useDomain');
    const $input = dialog.field('domain');
    const $field = $input.closest('.dashboard-form-field');
    const $hint = $field.find('.dashboard-form-hint');
    const id = $input.attr('id');

    const upgradable = has_upgrade_flow();
    $field.after(
        `<div class="dashboard-publish-upsell" hidden>`
        + `<span class="dashboard-publish-upsell-icon">${ICONS.sparkle}</span>`
        + '<div class="dashboard-publish-upsell-text">'
        + `<p class="dashboard-publish-upsell-title">${i18n('publish_custom_domain_upsell_title')}</p>`
        + (upgradable ? `<p class="dashboard-form-hint">${i18n('publish_custom_domain_upsell_text')}</p>` : '')
        + '</div>'
        + (upgradable ? `<button type="button" class="dashboard-dialog-btn dashboard-dialog-btn-primary dashboard-publish-upgrade">${i18n('billing.upgrade')}</button>` : '')
        + '</div>'
        + '<div class="dashboard-publish-claim" hidden>'
        + `<p class="dashboard-publish-claim-text">${i18n('custom_domain_claim_c2a')}</p>`
        + '<div class="dashboard-dns-records"></div>'
        + '</div>'
        + `<datalist id="${id}-owned"></datalist>`,
    );
    const $upsell = $dialog.find('.dashboard-publish-upsell');
    const $claim = $dialog.find('.dashboard-publish-claim');
    const $owned = $dialog.find(`#${id}-owned`);
    $input.attr('list', `${id}-owned`);

    let available = false;
    let can_add = true;
    let price = null;
    /** @type {CustomDomain[]} */
    let owned = [];
    /** The hostname whose ownership record is on screen. */
    let claim_for = null;
    /** @type {CustomDomain | null} */
    let shown = null;
    /** Whether the site is published, so the domain is all that's left. */
    let live = false;

    const typed = () => normalizeHostnameInput($input.val());
    const owned_named = (hostname) => owned.find((domain) => domain.hostname === hostname);
    const wanted = () => available && $switch.prop('checked');
    const addable = () => wanted() && can_add;

    const update_hint = () => {
        const existing = owned_named(typed());
        $hint.text(existing
            ? t('publish_custom_domain_moves', [`${existing.site}.${window.hosting_domain}`])
            : [! live && t('publish_custom_domain_dns_hint'), price && t('custom_domain_price_note', [price])].filter(Boolean).join(' '));
    };

    const sync = () => {
        const on = wanted();
        dialog.showField('domain', on && can_add);
        $upsell.prop('hidden', ! on || can_add);
        $claim.prop('hidden', ! on || ! can_add || claim_for !== typed());
        update_hint();
        onChange();
    };

    const load = async () => {
        let res;
        try {
            res = await customDomainsRequest('GET');
        } catch {
            return;
        }
        // No custom domain API on this Puter, or none for this account:
        // the option stays out of the way.
        if ( ! res.ok || ! Array.isArray(res.data?.items) ) return;
        owned = res.data.items;
        can_add = res.data.canAdd !== false;
        price = formatCustomDomainPrice(res.data.pricing);
        $owned.html(owned.map((domain) => `<option value="${html_encode(domain.hostname)}"></option>`).join(''));
        if ( ! available ) {
            available = true;
            dialog.showField('useDomain', true);
        }
        sync();
    };
    load();

    // The field takes focus as the switch reveals it. The upgrade prompt
    // doesn't: a second Space meant for the switch would open the upgrade.
    $switch.on('change', () => {
        sync();
        if ( addable() ) $input.get(0)?.focus({ preventScroll: true });
    });
    // A claim's record shows only while its hostname is the one typed.
    $input.on('input', sync);

    // Once an upgrade lands, the field unlocks where the prompt was. The
    // dialog is modal, so only its own prompt can change the plan meanwhile.
    const on_plan_change = async () => {
        if ( ! document.contains($dialog.get(0)) ) {
            window.removeEventListener('puter:subscription:changed', on_plan_change);
            return;
        }
        const had = can_add;
        await load();
        if ( ! had && addable() ) $input.get(0)?.focus({ preventScroll: true });
    };
    $dialog.on('click', '.dashboard-publish-upgrade', () => {
        if ( ! open_upgrade_flow() ) return;
        window.addEventListener('puter:subscription:changed', on_plan_change);
    });

    // -- Done screen --

    /** Encoded HTML into the done screen's status line; empty clears it. */
    const set_done_status = (html, error = false) => {
        $dialog.find('.dashboard-publish-domain-status').html(html)
            .toggleClass('dashboard-publish-domain-status-error', error);
    };
    const render_done = (focus_selector) => {
        const $section = $dialog.find('.dashboard-publish-domain-summary');
        $section.html(domainSummaryHtml(shown));
        const el = $section.find(focus_selector).get(0)
            ?? $section.find('.dashboard-copy-value').get(0)
            ?? $dialog.find('.dashboard-form-done-btn').get(0);
        el?.focus({ preventScroll: true });
    };
    const DONE_ACTIONS = '.dashboard-publish-domain-check, .dashboard-publish-domain-www';
    let done_busy = false;
    /**
     * Runs a done-screen request with `$btn` busy and the other actions held,
     * since each answer redraws the domain; resolves with the response, or null.
     */
    const done_request = async ($btn, method, path) => {
        done_busy = true;
        $dialog.find(DONE_ACTIONS).prop('disabled', true);
        $btn.addClass('dashboard-form-busy').attr('aria-busy', 'true');
        set_done_status('');
        try {
            const res = await customDomainsRequest(method, path);
            if ( res.ok ) return res;
            set_done_status(html_encode(customDomainErrorText(res)), true);
        } catch {
            set_done_status(i18n('custom_domain_error_generic'), true);
        } finally {
            done_busy = false;
            $dialog.find(DONE_ACTIONS).prop('disabled', false);
            $btn.removeClass('dashboard-form-busy').removeAttr('aria-busy');
        }
        return null;
    };
    $dialog.on('click', '.dashboard-publish-domain-check', async function () {
        if ( ! shown || done_busy ) return;
        const res = await done_request($(this), 'GET', `/${encodeURIComponent(shown.uuid)}`);
        if ( ! res ) return;
        shown = mergeCustomDomainRefresh(shown, res.data);
        render_done('.dashboard-publish-domain-check');
        const status = customDomainStatus(shown);
        set_done_status(status === 'active'
            ? i18n('custom_domain_success_note', [shown.hostname, `${shown.site}.${window.hosting_domain}`])
            : i18n(status === 'failed' ? 'custom_domain_status_failed' : 'custom_domain_status_pending', [shown.hostname]));
    });
    // Same domain, so the month already paid covers the www hostname.
    $dialog.on('click', '.dashboard-publish-domain-www', async function () {
        if ( ! shown || done_busy ) return;
        const res = await done_request($(this), 'POST', `/${encodeURIComponent(shown.uuid)}/use-www`);
        if ( ! res ) return;
        shown = res.data;
        render_done('.dashboard-publish-domain-check');
    });

    return {
        addable,
        prepare (live) {
            if ( ! wanted() || (live && ! can_add) ) return null;
            if ( ! can_add ) {
                dialog.setStatus(t(upgradable ? 'publish_custom_domain_needs_plan' : 'custom_domain_error_plan'));
                return false;
            }
            const hostname = typed();
            $input.val(hostname);
            if ( ! isPlausibleHostname(hostname) ) {
                dialog.setStatus(t('custom_domain_error_invalid'), { field: 'domain' });
                return false;
            }
            return hostname;
        },
        async attach (hostname, site) {
            if ( ! live ) {
                live = true;
                update_hint();
            }
            const existing = owned_named(hostname);
            const failed = (reason, field) => {
                dialog.setStatus(`${t('publish_domain_failed', [site.url])}\n${reason}`, field ? { field } : undefined);
                return null;
            };
            let res;
            try {
                res = existing
                    ? await customDomainsRequest('PATCH', `/${encodeURIComponent(existing.uuid)}`, { site: site.name })
                    : await customDomainsRequest('POST', '', { site: site.name, hostname });
            } catch {
                return failed(t('custom_domain_error_generic'));
            }
            if ( res.ok ) {
                claim_for = null;
                return res.data;
            }
            // Held by another account: shown its ownership record the first
            // time; a retry that still can't see the record says so.
            const verification = res.data?.verification;
            if ( res.data?.code === 'custom_domain_claim_required' && verification ) {
                const retry = claim_for === hostname;
                claim_for = hostname;
                $claim.find('.dashboard-dns-records').html(dnsRecordsHtml([{ type: 'TXT', name: verification.name, value: verification.value }]));
                sync();
                if ( retry ) return failed(t('custom_domain_claim_not_found'));
                dialog.setStatus(t('publish_site_live', [site.url]), { kind: 'info' });
                return null;
            }
            if ( res.status === 402 && res.data?.code === 'subscription_required' ) {
                can_add = false;
                sync();
            }
            return failed(customDomainErrorText(res), CUSTOM_DOMAIN_HOSTNAME_ERRORS.has(res.data?.code) ? 'domain' : undefined);
        },
        doneHtml (domain) {
            shown = domain;
            // The summary is redrawn after each check; the status line stays,
            // so screen readers announce what changed and not the records again.
            return '<section class="dashboard-publish-domain">'
                + `<div class="dashboard-publish-domain-summary" aria-live="off">${domainSummaryHtml(domain)}</div>`
                + '<p class="dashboard-publish-domain-status" role="status" aria-live="polite"></p>'
                + '</section>';
        },
        claiming: () => addable() && claim_for !== null && claim_for === typed(),
    };
};
