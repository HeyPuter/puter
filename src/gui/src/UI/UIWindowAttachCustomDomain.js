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

import { isPlausibleHostname, normalizeHostnameInput } from '../helpers/customDomainHostname.js';

let attach_modal_seq = 0;

const SUCCESS_AUTOCLOSE_MS = 1800;
const COPIED_RESET_MS = 1400;

/** API error code → message key; anything unlisted gets the generic error. */
const ERROR_KEYS = {
    invalid_hostname: 'custom_domain_error_invalid',
    custom_domain_taken: 'custom_domain_error_taken',
    custom_domain_limit_reached: 'custom_domain_error_limit',
    custom_domain_rejected: 'custom_domain_error_rejected',
    site_not_found: 'custom_domain_error_site',
    custom_domain_not_found: 'custom_domain_error_not_found',
    custom_domains_not_enabled: 'custom_domain_not_enabled',
    custom_domains_permission_required: 'custom_domain_error_generic',
};

/** Domain status → the badge shown for it; anything else reads as pending. */
const STATUS_BADGE_KEYS = {
    active: 'custom_domain_badge_active',
    pending: 'custom_domain_badge_pending',
    failed: 'custom_domain_badge_failed',
};
const statusOf = (domain) => (domain?.status in STATUS_BADGE_KEYS ? domain.status : 'pending');

const svg = (body, strokeWidth = 2) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON_GLOBE = svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>', 1.8);
const ICON_TRASH = svg('<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/>', 1.8);
const ICON_COPY = svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>', 1.8);
const ICON_CHECK = svg('<path d="M20 6 9 17l-5-5"/>', 2.4);
const ICON_CLOCK = svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>');
const ICON_ALERT = svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5"/><path d="M12 16.5h.01"/>', 2.2);
const ICON_PLUS = svg('<path d="M12 5v14M5 12h14"/>', 2.2);
const ICON_X = svg('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>', 2.2);

const format_price = (pricing) => {
    if ( ! pricing || typeof pricing.amount !== 'number' ) return null;
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: pricing.currency || 'USD',
            minimumFractionDigits: 2,
        }).format(pricing.amount);
    } catch {
        return null;
    }
};

/**
 * "Connect a custom domain to this site" modal, behind
 * `puter.hosting.attach()`. The user picks one of their domains (moving it
 * from another site if need be) or adds one; the caller learns only the
 * domain that ends up chosen.
 *
 * Built on the app feedback modal's shell (`.app-feedback-*`). Talks to the
 * `/custom-domains` API with the GUI's own session: the requesting app never
 * holds a token that can manage domains.
 *
 * @param {{ subdomain: string, requester?: string, fullpage?: boolean }} options
 *   `requester` is the app title or opener origin shown to the user, as the
 *   GUI resolved it. `fullpage` fills the viewport instead of floating over
 *   it, for a popup window that exists only to host this dialog.
 * @returns {Promise<object|null>} The chosen domain as the API returns it, or
 *   null when the user closes the dialog first. Never rejects.
 */
async function UIWindowAttachCustomDomain (options) {
    options = options ?? {};
    const subdomain = String(options.subdomain ?? '');
    const site_host = `${subdomain}.${window.hosting_domain}`;

    return new Promise((resolve) => {
        const modal_id = `custom-domain-${++attach_modal_seq}`;
        const authToken = puter.authToken ?? window.auth_token;
        let busy = false;
        let closed = false;
        // A domain added in this dialog is the answer even if the user then
        // closes it: it exists, and is billed, either way.
        let chosen = null;

        const titleId = `${modal_id}-title`;
        const closeLabel = html_encode(i18n('close'));
        const h = `
            <div class="app-feedback-overlay custom-domain-overlay${options.fullpage ? ' custom-domain-fullpage' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
                <div class="app-feedback-modal custom-domain-modal" tabindex="-1">
                    <div class="app-feedback-head custom-domain-head">
                        <div class="custom-domain-head-icon">${ICON_GLOBE}</div>
                        <div class="custom-domain-head-text">
                            <h2 class="app-feedback-title" id="${titleId}">${i18n('custom_domain_title')}</h2>
                            <p class="custom-domain-intro">${i18n('custom_domain_intro', [site_host])}</p>
                            ${options.requester ? `<p class="custom-domain-requester">${i18n('custom_domain_requested_by', [options.requester])}</p>` : ''}
                        </div>
                        <button type="button" class="app-feedback-x" aria-label="${closeLabel}" title="${closeLabel}">${ICON_X}</button>
                    </div>
                    <div class="app-feedback-body custom-domain-body">
                        <div class="custom-domain-pane" data-pane="loading" aria-busy="true">
                            <span class="custom-domain-sr">${i18n('loading')}…</span>
                            <div class="custom-domain-skeleton"><span></span><span></span></div>
                            <div class="custom-domain-skeleton"><span></span><span></span></div>
                        </div>

                        <div class="custom-domain-pane custom-domain-state" data-pane="unavailable" style="display:none;">
                            <div class="custom-domain-state-icon">${ICON_ALERT}</div>
                            <p class="app-feedback-unavailable-message"></p>
                            <div class="app-feedback-actions">
                                <button type="button" class="app-feedback-btn app-feedback-btn-primary custom-domain-close">${i18n('close')}</button>
                            </div>
                        </div>

                        <div class="custom-domain-pane" data-pane="list" style="display:none;">
                            <ul class="custom-domain-list"></ul>
                            <div class="custom-domain-state custom-domain-empty" style="display:none;">
                                <div class="custom-domain-state-icon">${ICON_GLOBE}</div>
                                <p class="custom-domain-state-title">${i18n('custom_domain_none_yet')}</p>
                                <p class="custom-domain-state-text">${i18n('custom_domain_empty_hint')}</p>
                                <button type="button" class="app-feedback-btn app-feedback-btn-primary custom-domain-to-add custom-domain-empty-add">${ICON_PLUS}<span>${i18n('custom_domain_add_new')}</span></button>
                            </div>
                            <p class="app-feedback-error" role="alert" style="display:none;"></p>
                            <div class="app-feedback-actions">
                                <button type="button" class="app-feedback-btn custom-domain-close">${i18n('cancel')}</button>
                                <button type="button" class="app-feedback-btn app-feedback-btn-primary custom-domain-to-add custom-domain-list-add">${ICON_PLUS}<span>${i18n('custom_domain_add_new')}</span></button>
                            </div>
                        </div>

                        <form class="custom-domain-pane" data-pane="add" style="display:none;" novalidate>
                            <label class="custom-domain-label" for="${modal_id}-hostname">${i18n('custom_domain_hostname_label')}</label>
                            <div class="custom-domain-field">
                                ${ICON_GLOBE}
                                <input type="text" class="custom-domain-input" id="${modal_id}-hostname" placeholder="www.example.com" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url" enterkeyhint="go">
                            </div>
                            <p class="app-feedback-note custom-domain-hint">${i18n('custom_domain_hostname_hint')}</p>
                            <p class="custom-domain-callout custom-domain-price" style="display:none;"></p>
                            <div class="custom-domain-claim" style="display:none;">
                                <p class="custom-domain-callout custom-domain-callout-warn">${i18n('custom_domain_claim_c2a')}</p>
                                <div class="custom-domain-records"></div>
                            </div>
                            <p class="app-feedback-error" role="alert" style="display:none;"></p>
                            <div class="app-feedback-actions">
                                <button type="button" class="app-feedback-btn custom-domain-back">${i18n('back')}</button>
                                <button type="submit" class="app-feedback-btn app-feedback-btn-primary custom-domain-add" disabled>${i18n('custom_domain_add')}</button>
                            </div>
                        </form>

                        <div class="custom-domain-pane" data-pane="records" style="display:none;">
                            <div class="custom-domain-status-card">
                                <div class="custom-domain-status-icon"></div>
                                <div class="custom-domain-status-main">
                                    <p class="custom-domain-status"></p>
                                    <p class="custom-domain-status-detail" style="display:none;"></p>
                                </div>
                            </div>
                            <p class="custom-domain-records-c2a">${i18n('custom_domain_records_c2a')}</p>
                            <div class="custom-domain-records"></div>
                            <p class="app-feedback-note custom-domain-redirect" style="display:none;"></p>
                            <p class="app-feedback-note custom-domain-apex" style="display:none;">${i18n('custom_domain_apex_hint')}</p>
                            <button type="button" class="custom-domain-link-btn custom-domain-use-www" style="display:none;">${i18n('custom_domain_no_root_alias')}</button>
                            <p class="app-feedback-error" role="alert" style="display:none;"></p>
                            <p class="custom-domain-callout custom-domain-callout-danger custom-domain-remove-note" style="display:none;">${i18n('custom_domain_remove_confirm')}</p>
                            <div class="app-feedback-actions">
                                <button type="button" class="app-feedback-btn custom-domain-btn-danger-text custom-domain-remove-chosen">${i18n('custom_domain_remove')}</button>
                                <button type="button" class="app-feedback-btn custom-domain-check">${i18n('custom_domain_check_status')}</button>
                                <button type="button" class="app-feedback-btn app-feedback-btn-primary custom-domain-done">${i18n('done')}</button>
                            </div>
                        </div>

                        <div class="custom-domain-pane app-feedback-success custom-domain-success" data-pane="success" role="status" style="display:none;">
                            <div class="app-feedback-success-check">${ICON_CHECK}</div>
                            <p class="app-feedback-success-text custom-domain-success-text"></p>
                            <p class="app-feedback-note custom-domain-success-note"></p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const $overlay = $(h);
        $('body').append($overlay);
        requestAnimationFrame(() => $overlay.addClass('app-feedback-open'));
        const modalEl = $overlay.find('.custom-domain-modal').get(0);
        const focusOn = (el) => el?.focus({ preventScroll: true });
        focusOn(modalEl);

        const close = () => {
            if ( closed ) return;
            closed = true;
            $(document).off(`keydown.${modal_id}`);
            $overlay.removeClass('app-feedback-open');
            setTimeout(() => $overlay.remove(), 160);
            resolve(chosen);
        };

        let currentPane = 'loading';
        const paneOf = (el) => $(el).closest('.custom-domain-pane').attr('data-pane');
        // A focused control that gets hidden or disabled hands focus to the
        // page behind the dialog; keep it in the dialog instead.
        const focusLost = () => ! document.activeElement || document.activeElement === document.body;
        const showPane = (pane) => {
            const from = paneOf(document.activeElement);
            $overlay.find('.custom-domain-pane').hide();
            $overlay.find('.app-feedback-error').hide();
            $overlay.find(`.custom-domain-pane[data-pane="${pane}"]`).show();
            currentPane = pane;
            // The modal scrolls when it floats, the body when it fills the page.
            $overlay.find('.custom-domain-modal, .custom-domain-body').scrollTop(0);
            if ( focusLost() || (from && from !== pane) ) focusOn(modalEl);
        };
        // Plain strings into `.text()`: i18n's HTML encoding would show up
        // literally.
        const text = (key, args = []) => i18n(key, args, false);
        const showUnavailable = (key) => {
            $overlay.find('.app-feedback-unavailable-message').text(text(key));
            showPane('unavailable');
        };
        const showError = (pane, message) => {
            $overlay.find(`.custom-domain-pane[data-pane="${pane}"] .app-feedback-error`)
                .text(message).show();
        };
        /** `$trigger` shows the spinner; every other control just waits. */
        let focusedBeforeBusy = null;
        const setBusy = (value, $trigger) => {
            busy = value;
            if ( value ) focusedBeforeBusy = document.activeElement;
            $overlay.find('button').prop('disabled', value);
            $overlay.find('.custom-domain-input').prop('readonly', value);
            $overlay.find('.is-loading').removeClass('is-loading');
            if ( value && $trigger ) $trigger.addClass('is-loading');
            if ( value ) return;
            updateAddButton();
            if ( focusLost() && focusedBeforeBusy?.isConnected && paneOf(focusedBeforeBusy) === currentPane ) {
                focusOn(focusedBeforeBusy);
            }
            if ( focusLost() ) focusOn(modalEl);
            focusedBeforeBusy = null;
        };

        const api = async (method, path = '', body) => {
            const res = await fetch(`${window.api_origin}/custom-domains${path}`, {
                method,
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                },
                body: body ? JSON.stringify(body) : undefined,
            });
            let data = null;
            try {
                data = await res.json();
            } catch {
                // Non-JSON body; callers go by the status.
            }
            return { status: res.status, ok: res.ok, data };
        };
        // A known code gets our wording; anything else shows what the server
        // said, which beats a generic message when something is misconfigured.
        const errorFor = (res) => {
            if ( res.status === 402 ) return text('custom_domain_error_plan');
            if ( res.status === 429 ) return text('custom_domain_error_rate_limited');
            const key = ERROR_KEYS[res.data?.code];
            if ( key ) return text(key);
            if ( typeof res.data?.message === 'string' && res.data.message ) {
                return res.data.message;
            }
            return `${text('custom_domain_error_generic')} (HTTP ${res.status})`;
        };

        // Escape backs out of a pending confirmation first. Escape, the
        // backdrop and the close buttons all dismiss, except while a request
        // is in flight: closing then would report no domain for one that may
        // still land server-side.
        $(document).on(`keydown.${modal_id}`, (e) => {
            if ( e.key !== 'Escape' || busy ) return;
            if ( $overlay.find('.custom-domain-row[data-confirming]').length ) {
                resetConfirming();
                return;
            }
            if ( $overlay.find('.custom-domain-remove-chosen.custom-domain-confirming').length ) {
                resetRemoveChosen();
                return;
            }
            close();
        });
        $overlay.on('mousedown', (e) => {
            // Same reason as the feedback modal: keep the press from focusing
            // the app window underneath.
            window.mouseover_window = undefined;
            if ( e.target === $overlay.get(0) && ! busy ) close();
        });
        $overlay.find('.app-feedback-x, .custom-domain-close').on('click', () => {
            if ( ! busy ) close();
        });

        /**
         * True once `el`'s text is on the clipboard. Without clipboard access
         * (an insecure origin has no `navigator.clipboard` at all), the text
         * is selected for the legacy copy and stays selected to copy by hand.
         */
        const copyText = async (el) => {
            try {
                await navigator.clipboard.writeText(el.textContent);
                return true;
            } catch {
                const range = document.createRange();
                range.selectNodeContents(el);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                try {
                    return document.execCommand('copy');
                } catch {
                    return false;
                }
            }
        };
        // Copy buttons flip to a check for a moment once the value is copied.
        $overlay.on('click', '.custom-domain-copy', async function () {
            const $btn = $(this);
            if ( ! await copyText($btn.siblings('code').get(0)) ) return;
            clearTimeout($btn.data('reset'));
            $btn.addClass('is-copied').attr('aria-label', text('copied')).attr('title', text('copied'));
            $btn.data('reset', setTimeout(() => {
                $btn.removeClass('is-copied').attr('aria-label', text('copy')).attr('title', text('copy'));
            }, COPIED_RESET_MS));
        });

        /**
         * One DNS record as a card: its type, then the name and value, each
         * with a copy button.
         */
        const recordCard = (record, typeLabel) => {
            const $card = $(`
                <div class="custom-domain-record">
                    <div class="custom-domain-record-head">
                        <span class="custom-domain-record-type"></span>
                        <span class="custom-domain-record-optional" style="display:none;">${i18n('custom_domain_optional')}</span>
                    </div>
                    <div class="custom-domain-record-field">
                        <span class="custom-domain-record-label">${i18n('name')}</span>
                        <code></code>
                        <button type="button" class="custom-domain-copy">${ICON_COPY}${ICON_CHECK}</button>
                    </div>
                    <div class="custom-domain-record-field">
                        <span class="custom-domain-record-label">${i18n('custom_domain_record_value')}</span>
                        <code></code>
                        <button type="button" class="custom-domain-copy">${ICON_COPY}${ICON_CHECK}</button>
                    </div>
                </div>
            `);
            $card.find('.custom-domain-record-type').text(typeLabel ?? record.type);
            $card.find('.custom-domain-record-optional').toggle(record.required === false);
            const [$name, $value] = $card.find('code').toArray().map((el) => $(el));
            $name.text(record.name);
            $value.text(record.value);
            $card.find('.custom-domain-copy').attr({ 'aria-label': text('copy'), title: text('copy') });
            return $card;
        };

        // -- Success --------------------------------------------------------

        // The check is the last thing the user sees: the domain serves this
        // site, so there's nothing left to do here.
        const showSuccess = (domain) => {
            chosen = domain;
            $overlay.find('.custom-domain-success-text').html(i18n('custom_domain_status_active', [domain.hostname]));
            $overlay.find('.custom-domain-success-note').html(i18n('custom_domain_success_note', [domain.hostname, site_host]));
            showPane('success');
            setTimeout(close, SUCCESS_AUTOCLOSE_MS);
        };
        /** Where to go once `domain` serves this site. */
        const settleOn = (domain) => {
            if ( statusOf(domain) === 'active' ) {
                showSuccess(domain);
                return;
            }
            chosen = domain;
            renderRecords(domain);
            showPane('records');
        };

        // -- List ---------------------------------------------------------

        let listed = [];
        const metaFor = (item) => item.site !== subdomain
            ? text('custom_domain_serves', [`${item.site}.${window.hosting_domain}`])
            : text('custom_domain_serves_this');
        // With no domains, adding one is the only way on, so the button sits
        // in the empty state where the eye lands instead of the footer.
        const toggleEmpty = () => {
            $overlay.find('.custom-domain-empty').toggle(listed.length === 0);
            $overlay.find('.custom-domain-list-add').toggle(listed.length > 0);
        };

        // One row asks for confirmation at a time; asking on another puts the
        // first back.
        const resetConfirming = () => {
            $overlay.find('.custom-domain-row[data-confirming]').each(function () {
                const $row = $(this);
                const kind = $row.attr('data-confirming');
                const hadFocus = $.contains($row.find('.custom-domain-row-confirm').get(0), document.activeElement);
                $row.removeAttr('data-confirming');
                $row.find('.custom-domain-row-meta').text(metaFor($row.data('item')));
                // Back to the button that asked, rather than one now hidden.
                if ( hadFocus ) {
                    focusOn($row.find(kind === 'move' ? '.custom-domain-use' : '.custom-domain-remove').get(0));
                }
            });
        };
        const confirmOn = ($row, kind, message) => {
            resetConfirming();
            $row.attr('data-confirming', kind);
            $row.find('.custom-domain-row-meta').text(message);
            $row.find('.custom-domain-confirm-go')
                .text(text(kind === 'move' ? 'custom_domain_move' : 'custom_domain_remove'))
                .get(0)?.focus({ preventScroll: true });
        };

        const renderList = (items) => {
            listed = items;
            const $list = $overlay.find('.custom-domain-list').empty();
            toggleEmpty();
            for ( const item of items ) {
                const status = statusOf(item);
                const $row = $(`
                    <li class="custom-domain-row">
                        <span class="custom-domain-row-icon">${ICON_GLOBE}</span>
                        <div class="custom-domain-row-main">
                            <div class="custom-domain-row-title">
                                <span class="custom-domain-row-host"></span>
                                <span class="custom-domain-badge" data-status="${status}">${i18n(STATUS_BADGE_KEYS[status])}</span>
                            </div>
                            <div class="custom-domain-row-meta"></div>
                        </div>
                        <div class="custom-domain-row-actions">
                            <button type="button" class="custom-domain-icon-btn custom-domain-remove">${ICON_TRASH}</button>
                            <button type="button" class="app-feedback-btn custom-domain-use">${i18n('custom_domain_use')}</button>
                        </div>
                        <div class="custom-domain-row-confirm">
                            <button type="button" class="app-feedback-btn custom-domain-confirm-cancel">${i18n('cancel')}</button>
                            <button type="button" class="app-feedback-btn custom-domain-confirm-go"></button>
                        </div>
                    </li>
                `);
                $row.data('item', item);
                $row.toggleClass('is-current', item.site === subdomain);
                $row.find('.custom-domain-row-host').text(item.hostname);
                $row.find('.custom-domain-row-meta').text(metaFor(item));
                $row.find('.custom-domain-remove').attr({
                    'aria-label': text('custom_domain_remove_named', [item.hostname]),
                    title: text('custom_domain_remove'),
                });
                $row.find('.custom-domain-use').on('click', () => use(item, $row));
                $row.find('.custom-domain-remove').on('click', () => {
                    if ( ! busy ) confirmOn($row, 'remove', text('custom_domain_remove_confirm'));
                });
                $row.find('.custom-domain-confirm-cancel').on('click', () => {
                    if ( ! busy ) resetConfirming();
                });
                $row.find('.custom-domain-confirm-go').on('click', (e) => {
                    const $btn = $(e.currentTarget);
                    if ( $row.attr('data-confirming') === 'move' ) move(item, $btn);
                    else remove(item, $row, $btn);
                });
                $list.append($row);
            }
        };

        const use = (item, $row) => {
            if ( busy ) return;
            if ( item.site === subdomain ) {
                settleOn(item);
                return;
            }
            // Moving takes the domain off another site, so say so first.
            confirmOn($row, 'move', text('custom_domain_move_confirm', [
                `${item.site}.${window.hosting_domain}`,
                site_host,
            ]));
        };

        const move = async (item, $btn) => {
            if ( busy ) return;
            setBusy(true, $btn);
            try {
                const res = await api('PATCH', `/${encodeURIComponent(item.uuid)}`, { site: subdomain });
                if ( ! res.ok ) {
                    showError('list', errorFor(res));
                    return;
                }
                settleOn(res.data);
            } catch ( e ) {
                console.error('custom-domain: move failed', e);
                showError('list', text('custom_domain_error_generic'));
            } finally {
                setBusy(false);
            }
        };

        /**
         * Removes the domain from the account, which also stops its rent.
         * True once it's gone, including when it already was.
         */
        const deleteDomain = async (item, pane, $btn) => {
            setBusy(true, $btn);
            try {
                const res = await api('DELETE', `/${encodeURIComponent(item.uuid)}`);
                if ( ! res.ok && res.status !== 404 ) {
                    showError(pane, errorFor(res));
                    return false;
                }
                // A removed domain is no answer to hand the caller.
                if ( chosen?.uuid === item.uuid ) chosen = null;
                return true;
            } catch ( e ) {
                console.error('custom-domain: remove failed', e);
                showError(pane, text('custom_domain_error_generic'));
                return false;
            } finally {
                setBusy(false);
            }
        };

        const remove = async (item, $row, $btn) => {
            if ( busy ) return;
            if ( ! await deleteDomain(item, 'list', $btn) ) return;
            listed = listed.filter((i) => i.uuid !== item.uuid);
            // Focus moves to the next row, else the previous one, else to
            // adding a domain once the empty state shows.
            const hadFocus = $.contains($row.get(0), document.activeElement);
            const $next = $row.nextAll('.custom-domain-row:not(.is-leaving)').first();
            const $other = $next.length ? $next : $row.prevAll('.custom-domain-row:not(.is-leaving)').first();
            if ( hadFocus ) focusOn($other.find('.custom-domain-remove').get(0));
            // Gone server-side: its buttons can't act on it again as it fades.
            $row.addClass('is-leaving').attr('inert', '');
            setTimeout(() => {
                $row.remove();
                toggleEmpty();
                if ( hadFocus && focusLost() ) {
                    focusOn($overlay.find(listed.length ? '.custom-domain-list-add' : '.custom-domain-empty-add').get(0));
                }
            }, 180);
        };

        // -- Add ----------------------------------------------------------

        const $input = $overlay.find('.custom-domain-input');
        const typedHostname = () => normalizeHostnameInput($input.val());
        const updateAddButton = () => {
            $overlay.find('.custom-domain-add').prop('disabled', busy || ! isPlausibleHostname(typedHostname()));
        };
        // A claim is for one hostname; editing it starts over.
        const hideClaim = () => {
            $overlay.find('.custom-domain-claim').hide();
            $overlay.find('.custom-domain-add').text(text('custom_domain_add'));
        };
        const showClaim = (record) => {
            $overlay.find('.custom-domain-claim .custom-domain-records')
                .empty()
                .append(recordCard({ type: 'TXT', name: record.name, value: record.value, required: true }));
            $overlay.find('.custom-domain-claim').show();
            $overlay.find('.custom-domain-add').text(text('custom_domain_verify_and_add'));
        };
        $input.on('input', () => {
            hideClaim();
            $overlay.find('[data-pane="add"] .app-feedback-error').hide();
            updateAddButton();
        });

        $overlay.find('.custom-domain-to-add').on('click', () => {
            resetConfirming();
            showPane('add');
            $input.get(0)?.focus({ preventScroll: true });
        });
        $overlay.find('.custom-domain-back').on('click', () => {
            if ( ! busy ) showPane('list');
        });

        $overlay.find('form[data-pane="add"]').on('submit', async (e) => {
            e.preventDefault();
            const hostname = typedHostname();
            if ( ! isPlausibleHostname(hostname) || busy ) return;
            $input.val(hostname);
            setBusy(true, $overlay.find('.custom-domain-add'));
            try {
                const res = await api('POST', '', { site: subdomain, hostname });
                if ( res.data?.code === 'custom_domain_claim_required' && res.data.verification ) {
                    // Shown the first time; a retry that still can't see the
                    // record says so.
                    const retry = $overlay.find('.custom-domain-claim').is(':visible');
                    showClaim(res.data.verification);
                    if ( retry ) showError('add', text('custom_domain_claim_not_found'));
                    return;
                }
                if ( ! res.ok ) {
                    showError('add', errorFor(res));
                    return;
                }
                hideClaim();
                settleOn(res.data);
            } catch ( err ) {
                console.error('custom-domain: add failed', err);
                showError('add', text('custom_domain_error_generic'));
            } finally {
                setBusy(false);
            }
        });

        // -- Records --------------------------------------------------------

        const STATUS_ICONS = { active: ICON_CHECK, pending: ICON_CLOCK, failed: ICON_ALERT };
        const STATUS_TEXT_KEYS = {
            active: 'custom_domain_status_active',
            pending: 'custom_domain_status_pending',
            failed: 'custom_domain_status_failed',
        };

        const resetRemoveChosen = () => {
            $overlay.find('.custom-domain-remove-chosen')
                .removeClass('custom-domain-confirming').text(text('custom_domain_remove'));
            $overlay.find('.custom-domain-remove-note').hide();
        };

        const renderRecords = (domain) => {
            resetRemoveChosen();
            const status = statusOf(domain);
            $overlay.find('.custom-domain-status-card').attr('data-status', status);
            $overlay.find('.custom-domain-status-icon').html(STATUS_ICONS[status]);
            $overlay.find('.custom-domain-status').html(i18n(STATUS_TEXT_KEYS[status], [domain.hostname]));
            $overlay.find('.custom-domain-status-detail')
                .text(domain.statusDetail ?? '')
                .toggle(!!domain.statusDetail && status !== 'active');
            const $redirect = $overlay.find('.custom-domain-redirect').toggle(!!domain.redirectFrom);
            if ( domain.redirectFrom ) {
                $redirect.html(i18n('custom_domain_redirect_note', [domain.redirectFrom, domain.hostname]));
            }
            $overlay.find('.custom-domain-apex').toggle(domain.isApex === true);
            $overlay.find('.custom-domain-use-www').toggle(domain.isApex === true && status !== 'active');

            const $records = $overlay.find('[data-pane="records"] .custom-domain-records').empty();
            for ( const record of domain.records ?? [] ) {
                const type = domain.isApex && record.purpose === 'routing'
                    ? text('custom_domain_record_type_apex')
                    : record.type;
                $records.append(recordCard(record, type));
            }
        };

        $overlay.find('.custom-domain-check').on('click', async (e) => {
            if ( busy || ! chosen ) return;
            setBusy(true, $(e.currentTarget));
            try {
                const res = await api('GET', `/${encodeURIComponent(chosen.uuid)}`);
                if ( ! res.ok ) {
                    showError('records', errorFor(res));
                    return;
                }
                // A domain that is no longer pending comes back with only its
                // routing record, and a GET never repeats the provider or the
                // redirect; keep what was shown when it was added.
                const known = chosen.records ?? [];
                const redirect = known.filter((r) => r.purpose === 'redirect');
                const fresh = (res.data.records?.length > 1 ? res.data.records : known)
                    .filter((r) => r.purpose !== 'redirect');
                const next = {
                    ...res.data,
                    dnsProvider: chosen.dnsProvider,
                    redirectFrom: chosen.redirectFrom,
                    records: [...fresh.slice(0, 1), ...redirect, ...fresh.slice(1)],
                };
                if ( statusOf(next) === 'active' ) {
                    showSuccess(next);
                    return;
                }
                chosen = next;
                renderRecords(chosen);
            } catch ( err ) {
                console.error('custom-domain: status check failed', err);
                showError('records', text('custom_domain_error_generic'));
            } finally {
                setBusy(false);
            }
        });
        // Same row, so the month already paid covers the www hostname.
        $overlay.find('.custom-domain-use-www').on('click', async (e) => {
            if ( busy || ! chosen ) return;
            setBusy(true, $(e.currentTarget));
            try {
                const res = await api('POST', `/${encodeURIComponent(chosen.uuid)}/use-www`);
                if ( ! res.ok ) {
                    showError('records', errorFor(res));
                    return;
                }
                chosen = res.data;
                renderRecords(chosen);
            } catch ( err ) {
                console.error('custom-domain: switch to www failed', err);
                showError('records', text('custom_domain_error_generic'));
            } finally {
                setBusy(false);
            }
        });
        // Undoes an add made by mistake, or drops a domain the user is done
        // with, without leaving the dialog.
        $overlay.find('.custom-domain-remove-chosen').on('click', async function () {
            if ( busy || ! chosen ) return;
            const $btn = $(this);
            if ( ! $btn.hasClass('custom-domain-confirming') ) {
                $btn.addClass('custom-domain-confirming').text(text('confirm'));
                $overlay.find('.custom-domain-remove-note').show();
                return;
            }
            if ( ! await deleteDomain(chosen, 'records', $btn) ) return;
            resetRemoveChosen();
            showPane('loading');
            await loadList();
        });
        $overlay.find('.custom-domain-done').on('click', () => {
            if ( ! busy ) close();
        });

        // -- Load -------------------------------------------------------------

        const loadList = async () => {
            try {
                const res = await api('GET');
                if ( closed ) return;
                // No custom domain API on this Puter: say so rather than show
                // an empty list the user can't add to.
                if ( res.status === 404 ) {
                    showUnavailable('custom_domain_unavailable');
                    return;
                }
                if ( res.data?.code === 'custom_domains_not_enabled' ) {
                    showUnavailable('custom_domain_not_enabled');
                    return;
                }
                if ( ! res.ok ) {
                    showUnavailable('custom_domain_error_generic');
                    return;
                }
                renderList(res.data?.items ?? []);
                const price = format_price(res.data?.pricing);
                if ( price ) {
                    $overlay.find('.custom-domain-price').text(text('custom_domain_price_note', [price])).show();
                }
                showPane('list');
            } catch ( e ) {
                console.error('custom-domain: list failed', e);
                if ( ! closed ) showUnavailable('custom_domain_error_generic');
            }
        };
        loadList();
    });
}

export default UIWindowAttachCustomDomain;
