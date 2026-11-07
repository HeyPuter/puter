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

// The Files tab's publish flows, a folder as a website (optionally on a
// custom domain) and a .js file as a worker: dashboard form dialogs rather
// than desktop windows.

import ensure_can_publish from '../../helpers/ensureCanPublish.js';
import forget_parent_listing from '../../helpers/forgetParentListing.js';
import UIDashboardFormDialog, { copyRowHtml } from './UIDashboardFormDialog.js';
import { openLinkHtml, publishDomainFields, setupPublishDomain } from './publishDomain.js';
import { finalizePublishName, normalizePublishName, PUBLISH_NAME_RULES } from './publishName.js';

/**
 * @typedef {object} PublishTarget
 * @property {string} name Display name of the folder or file.
 * @property {string} path
 * @property {jQuery} [$container] Where the overlay mounts.
 * @property {HTMLElement} [returnFocusTo] Where focus goes on close.
 */

const t = (key) => i18n(key, [], false);

/** Rows showing `path` or anything under it, on the dashboard or the desktop. */
const each_item_at = (path, fn) => $('.item').each(function () {
    const item_path = this.dataset.path ?? '';
    if ( item_path === path || item_path.startsWith(`${path}/`) ) fn($(this), item_path);
});

const KINDS = {
    website: {
        title: 'window_title_publish_website',
        intro: 'publish_website_intro',
        published: 'website_published',
        rule: PUBLISH_NAME_RULES.website,
        // Rejections that mean "pick another name" (SubdomainDriver).
        nameErrors: new Set(['conflict', 'subdomain_reserved']),
        suffix: () => `.${window.hosting_domain}`,
        requiresVerification: () => !! window.require_email_verification_to_publish_website,
        extraFields: publishDomainFields,
        setup: setupPublishDomain,
        async publish (name, path) {
            const site = await puter.hosting.create(name, path);
            // The server's address carries the deployment's real scheme (a
            // self-hosted instance may serve sites over http).
            return site?.root_dir?.subdomains?.find((entry) => entry.subdomain === name)?.address
                ?? `https://${name}.${window.hosting_domain}`;
        },
        markPublished (path, url) {
            each_item_at(path, ($item, item_path) => {
                if ( item_path === path ) {
                    $item.attr('data-has_website', '1').find('.item-has-website-badge').show();
                    const fsentry = $item.data('fsentry');
                    if ( fsentry ) fsentry.has_website = true;
                } else {
                    $item.attr('data-website_url', url + item_path.slice(path.length))
                        .find('.item-has-website-url-badge').show();
                }
            });
            // The folder's row, when it isn't on screen, is drawn from there next.
            forget_parent_listing(path);
            window.update_sites_cache?.();
        },
    },
    worker: {
        title: 'window_title_publish_worker',
        intro: 'publish_worker_intro',
        published: 'worker_published',
        rule: PUBLISH_NAME_RULES.worker,
        nameErrors: new Set(['conflict']),
        suffix: () => '.puter.work',
        requiresVerification: () => true,
        extraFields: () => [{
            name: 'sandboxed',
            type: 'switch',
            label: i18n('worker_sandboxed'),
            hint: i18n('worker_sandboxed_hint'),
            checked: true,
        }],
        async publish (name, path, { sandboxed }) {
            const result = await puter.workers.create(name, path, { sandbox: sandboxed });
            return result?.url ?? `https://${name}.puter.work`;
        },
        markPublished (path, url) {
            each_item_at(path, ($item, item_path) => {
                if ( item_path !== path ) return;
                $item.attr({ 'data-is_worker': '1', 'data-worker_url': url })
                    .find('.item-is-worker').show();
                // The listing draws the badge, and the menu its state, from here.
                const fsentry = $item.data('fsentry');
                if ( fsentry ) fsentry.workers = [{ address: url }];
            });
        },
    },
};

/** puter.js rejects with an Error, or with the API's `{ error: { message } }` / `{ message }`. */
const error_message = (err) => err?.error?.message ?? err?.message ?? t('error_unknown_cause');

/**
 * @param {'website'|'worker'} kind_name
 * @param {PublishTarget} target
 */
const open_publish_dialog = async (kind_name, { name, path, ...opts }) => {
    const kind = KINDS[kind_name];
    if ( ! await ensure_can_publish(kind.requiresVerification()) ) return;

    const fields = [{
        name: 'name',
        label: i18n('publish_address'),
        value: normalizePublishName(window.generate_identifier(), kind.rule),
        suffix: kind.suffix(),
        attrs: {
            maxlength: kind.rule.maxLength,
            autocomplete: 'off',
            autocapitalize: 'off',
            autocorrect: 'off',
            spellcheck: 'false',
            'data-gramm_editor': 'false',
        },
    }];
    fields.push(...(kind.extraFields?.() ?? []));

    /** Set once the site is live; a retry for a step after it skips publishing. */
    let published = null;
    /** @type {import('./publishDomain.js').PublishDomain | undefined} */
    let extra;

    const dialog = UIDashboardFormDialog({
        ...opts,
        title: t(kind.title),
        intro: `<p>${i18n(kind.intro, `<strong>${html_encode(name)}</strong>`, false)}</p>`,
        submitLabel: t('publish'),
        fields,
        async onSubmit () {
            const values = dialog.values();
            const hostname = extra?.prepare(!! published) ?? null;
            if ( hostname === false ) return;
            if ( ! published ) {
                const subdomain = finalizePublishName(values.name, kind.rule);
                dialog.field('name').val(subdomain);
                if ( ! subdomain ) {
                    dialog.setStatus(t('publish_name_required'), { field: 'name' });
                    return;
                }
                let url;
                try {
                    url = await kind.publish(subdomain, path, values);
                } catch ( err ) {
                    const code = err?.error?.code ?? err?.code;
                    dialog.setStatus(error_message(err), kind.nameErrors.has(code) ? { field: 'name' } : undefined);
                    return;
                }
                kind.markPublished(path, url);
                published = { name: subdomain, url };
                // The address is taken now; what's left to retry is the domain.
                dialog.field('name').prop('readOnly', true).attr('aria-readonly', 'true');
                update_submit_label();
            }
            const domain = hostname ? await extra.attach(hostname, published) : null;
            if ( hostname && ! domain ) return;
            dialog.finish({
                message: t(kind.published),
                html: copyRowHtml({ value: published.url, label: t('publish_address'), compact: true, after: openLinkHtml(published.url) })
                    + (domain ? extra.doneHtml(domain) : ''),
                // The DNS records are shown only here.
                keepOnBackdrop: !! domain,
            });
        },
    });

    // Before the site is live the button publishes; after, it adds the domain.
    const update_submit_label = () => {
        let key = 'publish';
        if ( published ) {
            if ( extra?.claiming() ) key = 'custom_domain_verify_and_add';
            else key = extra?.addable() ? 'custom_domain_add' : 'done';
        }
        dialog.$dialog.find('.dashboard-form-submit-label').text(t(key));
    };
    extra = kind.setup?.(dialog, { onChange: update_submit_label });

    // Shape the name as it's typed, keeping the caret where it was.
    const el_name = dialog.field('name').get(0);
    if ( document.activeElement === el_name ) el_name.select();
    const shape = () => {
        const next = normalizePublishName(el_name.value, kind.rule);
        if ( next === el_name.value ) return;
        const caret = normalizePublishName(el_name.value.slice(0, el_name.selectionStart ?? el_name.value.length), kind.rule).length;
        el_name.value = next;
        el_name.setSelectionRange(caret, caret);
    };
    // Rewriting the text mid-composition (an IME, or a dead key's accent)
    // breaks it; the composed text is shaped once it's in.
    $(el_name).on('input', (e) => {
        if ( ! e.originalEvent?.isComposing ) shape();
    }).on('compositionend', shape);
    return dialog;
};

/**
 * Publishes a folder as a website, once the account may.
 *
 * @param {PublishTarget} target
 */
export const openPublishWebsiteDialog = (target) => open_publish_dialog('website', target);

/**
 * Deploys a .js file as a worker, once the account may.
 *
 * @param {PublishTarget} target
 */
export const openPublishWorkerDialog = (target) => open_publish_dialog('worker', target);
