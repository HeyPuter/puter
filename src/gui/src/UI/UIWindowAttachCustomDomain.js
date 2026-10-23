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

let attach_modal_seq = 0;

/** API error code → message key; anything unlisted gets the generic error. */
const ERROR_KEYS = {
    invalid_hostname: 'custom_domain_error_invalid',
    custom_domain_taken: 'custom_domain_error_taken',
    custom_domain_limit_reached: 'custom_domain_error_limit',
    custom_domain_rejected: 'custom_domain_error_rejected',
    site_not_found: 'custom_domain_error_site',
    custom_domains_permission_required: 'custom_domain_error_generic',
};

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
 * Built on the app feedback modal's shell (`.app-feedback-*`) so it renders
 * the same on the desktop and in the standalone popup. Talks to the
 * `/custom-domains` API with the GUI's own session: the requesting app never
 * holds a token that can manage domains.
 *
 * @param {{ subdomain: string, requester?: string }} options `requester` is
 *   the app title or opener origin shown to the user, as the GUI resolved it.
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
        const h = `
            <div class="app-feedback-overlay custom-domain-overlay" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
                <div class="app-feedback-modal custom-domain-modal" tabindex="-1">
                    <div class="app-feedback-head">
                        <h2 class="app-feedback-title" id="${titleId}">${i18n('custom_domain_title')}</h2>
                        <button type="button" class="app-feedback-x" aria-label="${html_encode(i18n('close'))}" title="${html_encode(i18n('close'))}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
                        </button>
                    </div>
                    <div class="app-feedback-body">
                        <p class="custom-domain-intro">${i18n('custom_domain_intro', [site_host])}</p>
                        ${options.requester ? `<p class="custom-domain-requester">${i18n('custom_domain_requested_by', [options.requester])}</p>` : ''}

                        <div class="app-feedback-loading custom-domain-pane" data-pane="loading">${i18n('loading')}…</div>

                        <div class="custom-domain-pane" data-pane="unavailable" style="display:none;">
                            <p class="app-feedback-unavailable-message"></p>
                            <div class="app-feedback-actions">
                                <button type="button" class="app-feedback-btn app-feedback-btn-primary custom-domain-close">${i18n('close')}</button>
                            </div>
                        </div>

                        <div class="custom-domain-pane" data-pane="list" style="display:none;">
                            <ul class="custom-domain-list"></ul>
                            <p class="custom-domain-empty" style="display:none;">${i18n('custom_domain_none_yet')}</p>
                            <p class="app-feedback-error" role="alert" style="display:none;"></p>
                            <div class="app-feedback-actions">
                                <button type="button" class="app-feedback-btn custom-domain-close">${i18n('cancel')}</button>
                                <button type="button" class="app-feedback-btn app-feedback-btn-primary custom-domain-to-add">${i18n('custom_domain_add_new')}</button>
                            </div>
                        </div>

                        <form class="custom-domain-pane" data-pane="add" style="display:none;">
                            <label class="custom-domain-label" for="${modal_id}-hostname">${i18n('custom_domain_hostname_label')}</label>
                            <input type="text" class="custom-domain-input" id="${modal_id}-hostname" placeholder="www.example.com" autocomplete="off" autocapitalize="off" spellcheck="false">
                            <p class="app-feedback-note custom-domain-price" style="display:none;"></p>
                            <p class="app-feedback-error" role="alert" style="display:none;"></p>
                            <div class="app-feedback-actions">
                                <button type="button" class="app-feedback-btn custom-domain-back">${i18n('back')}</button>
                                <button type="submit" class="app-feedback-btn app-feedback-btn-primary custom-domain-add" disabled>${i18n('custom_domain_add')}</button>
                            </div>
                        </form>

                        <div class="custom-domain-pane" data-pane="records" style="display:none;">
                            <p class="custom-domain-status"></p>
                            <p class="app-feedback-note custom-domain-records-c2a">${i18n('custom_domain_records_c2a')}</p>
                            <table class="custom-domain-records">
                                <thead><tr><th>${i18n('custom_domain_record_type')}</th><th>${i18n('name')}</th><th>${i18n('custom_domain_record_value')}</th></tr></thead>
                                <tbody></tbody>
                            </table>
                            <p class="app-feedback-note custom-domain-apex" style="display:none;">${i18n('custom_domain_apex_hint')}</p>
                            <p class="app-feedback-error" role="alert" style="display:none;"></p>
                            <div class="app-feedback-actions">
                                <button type="button" class="app-feedback-btn custom-domain-check">${i18n('custom_domain_check_status')}</button>
                                <button type="button" class="app-feedback-btn app-feedback-btn-primary custom-domain-done">${i18n('done')}</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const $overlay = $(h);
        $('body').append($overlay);
        requestAnimationFrame(() => $overlay.addClass('app-feedback-open'));

        const close = () => {
            if ( closed ) return;
            closed = true;
            $(document).off(`keydown.${modal_id}`);
            $overlay.removeClass('app-feedback-open');
            setTimeout(() => $overlay.remove(), 160);
            resolve(chosen);
        };
        const finish = (domain) => {
            chosen = domain;
            close();
        };

        const showPane = (pane) => {
            $overlay.find('.custom-domain-pane').hide();
            $overlay.find('.app-feedback-error').hide();
            $overlay.find(`.custom-domain-pane[data-pane="${pane}"]`).show();
        };
        const showUnavailable = (key) => {
            $overlay.find('.app-feedback-unavailable-message').text(i18n(key));
            showPane('unavailable');
        };
        const showError = (pane, key) => {
            $overlay.find(`.custom-domain-pane[data-pane="${pane}"] .app-feedback-error`)
                .text(i18n(key)).show();
        };
        const setBusy = (value) => {
            busy = value;
            $overlay.find('button').prop('disabled', value);
            if ( ! value ) updateAddButton();
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
        const errorKeyFor = (res) => {
            if ( res.status === 402 ) return 'custom_domain_error_plan';
            if ( res.status === 429 ) return 'custom_domain_error_rate_limited';
            return ERROR_KEYS[res.data?.code] ?? 'custom_domain_error_generic';
        };

        // Escape, the backdrop and the close buttons all dismiss, except
        // while a request is in flight: closing then would report no domain
        // for one that may still land server-side.
        $(document).on(`keydown.${modal_id}`, (e) => {
            if ( e.key === 'Escape' && ! busy ) close();
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

        // -- List ---------------------------------------------------------

        const renderList = (items) => {
            const $list = $overlay.find('.custom-domain-list').empty();
            $overlay.find('.custom-domain-empty').toggle(items.length === 0);
            for ( const item of items ) {
                const elsewhere = item.site !== subdomain;
                const $row = $(`
                    <li class="custom-domain-row">
                        <div class="custom-domain-row-main">
                            <div class="custom-domain-row-host"></div>
                            <div class="custom-domain-row-meta"></div>
                        </div>
                        <button type="button" class="app-feedback-btn custom-domain-use">${i18n('custom_domain_use')}</button>
                    </li>
                `);
                $row.find('.custom-domain-row-host').text(item.hostname);
                $row.find('.custom-domain-row-meta').text(elsewhere
                    ? i18n('custom_domain_serves', [`${item.site}.${window.hosting_domain}`], false)
                    : i18n('custom_domain_serves_this', [], false));
                $row.find('.custom-domain-use').on('click', () => use(item, $row));
                $list.append($row);
            }
        };

        const use = async (item, $row) => {
            if ( busy ) return;
            if ( item.site === subdomain ) {
                finish(item);
                return;
            }
            // Moving takes the domain off another site, so say so first.
            if ( ! $row.hasClass('custom-domain-confirming') ) {
                $overlay.find('.custom-domain-confirming').removeClass('custom-domain-confirming')
                    .find('.custom-domain-use').text(i18n('custom_domain_use'));
                $row.addClass('custom-domain-confirming');
                $row.find('.custom-domain-row-meta').text(i18n('custom_domain_move_confirm', [
                    `${item.site}.${window.hosting_domain}`,
                    site_host,
                ], false));
                $row.find('.custom-domain-use').text(i18n('custom_domain_move'));
                return;
            }
            setBusy(true);
            try {
                const res = await api('PATCH', `/${encodeURIComponent(item.uuid)}`, { site: subdomain });
                if ( ! res.ok ) {
                    showError('list', errorKeyFor(res));
                    return;
                }
                finish(res.data);
            } catch ( e ) {
                console.error('custom-domain: move failed', e);
                showError('list', 'custom_domain_error_generic');
            } finally {
                setBusy(false);
            }
        };

        // -- Add ----------------------------------------------------------

        const $input = $overlay.find('.custom-domain-input');
        const updateAddButton = () => {
            $overlay.find('.custom-domain-add').prop('disabled', busy || String($input.val() || '').trim() === '');
        };
        $input.on('input', updateAddButton);

        $overlay.find('.custom-domain-to-add').on('click', () => {
            showPane('add');
            $input.get(0)?.focus({ preventScroll: true });
        });
        $overlay.find('.custom-domain-back').on('click', () => {
            if ( ! busy ) showPane('list');
        });

        $overlay.find('form[data-pane="add"]').on('submit', async (e) => {
            e.preventDefault();
            const hostname = String($input.val() || '').trim();
            if ( ! hostname || busy ) return;
            setBusy(true);
            try {
                const res = await api('POST', '', { site: subdomain, hostname });
                if ( ! res.ok ) {
                    showError('add', errorKeyFor(res));
                    return;
                }
                chosen = res.data;
                renderRecords(res.data);
                showPane('records');
            } catch ( err ) {
                console.error('custom-domain: add failed', err);
                showError('add', 'custom_domain_error_generic');
            } finally {
                setBusy(false);
            }
        });

        // -- Records --------------------------------------------------------

        const renderRecords = (domain) => {
            const key = domain.status === 'active'
                ? 'custom_domain_status_active'
                : domain.status === 'failed'
                    ? 'custom_domain_status_failed'
                    : 'custom_domain_status_pending';
            const $status = $overlay.find('.custom-domain-status')
                .html(i18n(key, [domain.hostname]));
            if ( domain.statusDetail && domain.status !== 'active' ) {
                $status.append($('<span class="custom-domain-status-detail"></span>').text(domain.statusDetail));
            }
            $overlay.find('.custom-domain-apex').toggle(domain.isApex === true);

            const $tbody = $overlay.find('.custom-domain-records tbody').empty();
            for ( const record of domain.records ?? [] ) {
                const $tr = $(`
                    <tr>
                        <td class="custom-domain-record-type"></td>
                        <td><code class="custom-domain-copy"></code></td>
                        <td><code class="custom-domain-copy"></code></td>
                    </tr>
                `);
                $tr.find('.custom-domain-record-type').text(record.required
                    ? record.type
                    : `${record.type} ${i18n('custom_domain_optional', [], false)}`);
                const [$name, $value] = $tr.find('code').toArray().map((el) => $(el));
                $name.text(record.name);
                $value.text(record.value);
                $tbody.append($tr);
            }
            $tbody.find('.custom-domain-copy').attr('title', i18n('copy', [], false)).on('click', function () {
                navigator.clipboard?.writeText($(this).text()).catch(() => {});
            });
        };

        $overlay.find('.custom-domain-check').on('click', async () => {
            if ( busy || ! chosen ) return;
            setBusy(true);
            try {
                const res = await api('GET', `/${encodeURIComponent(chosen.uuid)}`);
                if ( ! res.ok ) {
                    showError('records', errorKeyFor(res));
                    return;
                }
                // A domain that is no longer pending comes back with only its
                // routing record; keep the full set shown when it was added.
                chosen = { ...res.data, records: res.data.records?.length > 1 ? res.data.records : chosen.records };
                renderRecords(chosen);
            } catch ( e ) {
                console.error('custom-domain: status check failed', e);
                showError('records', 'custom_domain_error_generic');
            } finally {
                setBusy(false);
            }
        });
        $overlay.find('.custom-domain-done').on('click', () => {
            if ( ! busy ) close();
        });

        // -- Load -------------------------------------------------------------

        (async () => {
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
                    $overlay.find('.custom-domain-price').text(i18n('custom_domain_price_note', [price], false)).show();
                }
                showPane('list');
            } catch ( e ) {
                console.error('custom-domain: list failed', e);
                if ( ! closed ) showUnavailable('custom_domain_error_generic');
            }
        })();
    });
}

export default UIWindowAttachCustomDomain;
