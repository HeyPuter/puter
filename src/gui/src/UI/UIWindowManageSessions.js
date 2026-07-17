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

// Renders the Session Manager as a self-contained, responsive modal (a plain
// DOM overlay) rather than a draggable UIWindow. Confirmations are shown as
// in-modal sheets instead of UIAlert windows, so nothing here depends on the
// window system and there is no cross-window z-index juggling.

// Hand-rolled UA → {browser, os} extractor. Covers Chrome/Edge/Firefox/
// Safari/Opera + Windows/macOS/iOS/Android/Linux. The backend already
// has `ua-parser-js`; pulling it into the GUI bundle just for this
// label wasn't worth the bytes.
const parseUserAgent = (ua) => {
    if ( ! ua || typeof ua !== 'string' ) return { browser: null, os: null };
    let browser = null;
    if ( /Edg\//i.test(ua) ) browser = 'Edge';
    else if ( /OPR\/|Opera/i.test(ua) ) browser = 'Opera';
    else if ( /Chrome\//i.test(ua) && !/Chromium/i.test(ua) ) browser = 'Chrome';
    else if ( /Firefox\//i.test(ua) ) browser = 'Firefox';
    else if ( /Safari\//i.test(ua) && !/Chrome\//i.test(ua) ) browser = 'Safari';

    let os = null;
    if ( /Windows NT/i.test(ua) ) os = 'Windows';
    // iOS Safari/Chrome UAs include "like Mac OS X", so the iOS device
    // check has to win against the macOS regex — otherwise iPhones get
    // mislabeled as macOS. Android similarly fakes a "Linux" token, so
    // it has to precede the Linux check below.
    else if ( /iPhone|iPad|iPod/i.test(ua) ) os = 'iOS';
    else if ( /Android/i.test(ua) ) os = 'Android';
    else if ( /Mac OS X|Macintosh/i.test(ua) ) os = 'macOS';
    else if ( /Linux/i.test(ua) ) os = 'Linux';

    return { browser, os };
};

const formatBrowserOs = ({ browser, os }) => {
    if ( browser && os ) return `${browser} on ${os}`;
    return browser || os || null;
};

// Inline line-icons (stroke, currentColor) so the list is scannable at a
// glance without pulling an icon font into the bundle.
const ICONS = {
    laptop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><line x1="2" y1="20" x2="22" y2="20"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><line x1="10" y1="18.5" x2="14" y2="18.5"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>',
    worker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>',
    app: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><line x1="10.8" y1="12.2" x2="21" y2="2"/><line x1="16" y1="6" x2="19" y2="9"/><line x1="14" y1="8" x2="17" y2="11"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
};

// Pick a device/kind glyph for a session's icon tile.
const deviceIconSvg = (session) => {
    if ( session.kind === 'worker' ) return ICONS.worker;
    if ( session.kind === 'access_token' ) return ICONS.key;
    if ( session.kind === 'app' ) return ICONS.app;
    const { os } = parseUserAgent(session.last_user_agent);
    if ( os === 'iOS' || os === 'Android' ) return ICONS.phone;
    if ( os ) return ICONS.laptop;
    return ICONS.globe;
};

// Short, human label for the kind pill (falls back to the raw kind).
const kindBadgeLabel = (kind) => {
    switch ( kind ) {
        case 'worker': return i18n('ui_session_kind_worker') || 'Worker';
        case 'app': return i18n('ui_session_kind_app') || 'App';
        case 'access_token': return i18n('ui_session_kind_access_token') || 'API token';
        default: return kind;
    }
};

const UIWindowManageSessions = async function UIWindowManageSessions (options) {
    options = options ?? {};

    const services = globalThis.services;

    // =====================================================================
    // Responsive modal shell
    // =====================================================================
    const backdrop = document.createElement('div');
    backdrop.className = 'sessions-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'sessions-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', i18n('ui_manage_sessions'));
    backdrop.appendChild(modal);

    const el_head = document.createElement('div');
    el_head.className = 'sessions-modal-head';
    const el_title_head = document.createElement('h2');
    el_title_head.className = 'sessions-modal-title';
    el_title_head.textContent = i18n('ui_manage_sessions');
    el_head.appendChild(el_title_head);
    const el_close = document.createElement('button');
    el_close.type = 'button';
    el_close.className = 'sessions-modal-close';
    el_close.setAttribute('aria-label', i18n('close'));
    el_close.innerHTML = ICONS.close;
    el_head.appendChild(el_close);
    modal.appendChild(el_head);

    // Content container (plays the role the window-body used to).
    const w_body = document.createElement('div');
    w_body.className = 'session-manager-list';
    modal.appendChild(w_body);

    document.body.appendChild(backdrop);
    // Next frame so the open transition runs.
    requestAnimationFrame(() => backdrop.classList.add('open'));

    // Refresh handles — assigned once the list wiring below is in place,
    // referenced by close(). Declared here so close() can see them.
    let interval = null;
    let onFocus = null;
    let closed = false;

    const close = () => {
        if ( closed ) return;
        closed = true;
        if ( interval ) clearInterval(interval);
        if ( onFocus ) window.removeEventListener('focus', onFocus);
        document.removeEventListener('keydown', onKeydown);
        backdrop.classList.remove('open');
        // Remove after the fade-out; guard against a missing transitionend.
        setTimeout(() => backdrop.remove(), 200);
    };

    // Escape: cancel an open confirm sheet if there is one, otherwise close
    // the whole modal.
    const onKeydown = (e) => {
        if ( e.key !== 'Escape' ) return;
        const sheet = modal.querySelector('.sessions-modal-sheet');
        if ( sheet && typeof sheet._cancel === 'function' ) {
            sheet._cancel();
            return;
        }
        close();
    };
    document.addEventListener('keydown', onKeydown);

    el_close.addEventListener('click', close);
    backdrop.addEventListener('mousedown', (e) => {
        if ( e.target !== backdrop ) return;
        // Don't close underneath an open confirm sheet.
        if ( modal.querySelector('.sessions-modal-sheet') ) return;
        close();
    });

    // =====================================================================
    // In-modal confirm / alert sheets (replace UIAlert)
    // =====================================================================
    const confirmDialog = ({ message, confirmLabel, danger = false }) => {
        return new Promise((resolve) => {
            const sheet = document.createElement('div');
            sheet.className = 'sessions-modal-sheet';

            const card = document.createElement('div');
            card.className = 'sessions-modal-sheet-card';

            const msg = document.createElement('p');
            msg.className = 'sessions-modal-sheet-msg';
            msg.textContent = message;
            card.appendChild(msg);

            const btns = document.createElement('div');
            btns.className = 'sessions-modal-sheet-btns';

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'sessions-modal-sheet-btn';
            cancelBtn.textContent = i18n('cancel');

            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'button';
            confirmBtn.className =
                `sessions-modal-sheet-btn ${danger ? 'sessions-modal-sheet-btn-danger' : 'sessions-modal-sheet-btn-primary'}`;
            confirmBtn.textContent = confirmLabel;

            btns.appendChild(cancelBtn);
            btns.appendChild(confirmBtn);
            card.appendChild(btns);
            sheet.appendChild(card);

            const done = (val) => {
                sheet.remove();
                resolve(val);
            };
            // onKeydown (Escape) reaches for this to cancel the sheet.
            sheet._cancel = () => done(false);

            cancelBtn.addEventListener('click', () => done(false));
            confirmBtn.addEventListener('click', () => done(true));
            sheet.addEventListener('mousedown', (e) => {
                if ( e.target === sheet ) done(false);
            });

            modal.appendChild(sheet);
            requestAnimationFrame(() => sheet.classList.add('open'));
            confirmBtn.focus();
        });
    };

    const alertDialog = ({ message }) => {
        return new Promise((resolve) => {
            const sheet = document.createElement('div');
            sheet.className = 'sessions-modal-sheet';

            const card = document.createElement('div');
            card.className = 'sessions-modal-sheet-card';

            const msg = document.createElement('p');
            msg.className = 'sessions-modal-sheet-msg';
            msg.textContent = message;
            card.appendChild(msg);

            const btns = document.createElement('div');
            btns.className = 'sessions-modal-sheet-btns';

            const okBtn = document.createElement('button');
            okBtn.type = 'button';
            okBtn.className = 'sessions-modal-sheet-btn sessions-modal-sheet-btn-primary';
            okBtn.textContent = i18n('ok');
            btns.appendChild(okBtn);
            card.appendChild(btns);
            sheet.appendChild(card);

            const done = () => {
                sheet.remove();
                resolve();
            };
            sheet._cancel = done;
            okBtn.addEventListener('click', done);
            sheet.addEventListener('mousedown', (e) => {
                if ( e.target === sheet ) done();
            });

            modal.appendChild(sheet);
            requestAnimationFrame(() => sheet.classList.add('open'));
            okBtn.focus();
        });
    };

    // Backend BIGINT columns store epoch seconds (SessionStore writes
    // `nowSeconds()`). timeago / Date both take ms — multiply on read.
    const fmtRelative = (secs) => {
        if ( !secs ) return null;
        const ms = Number(secs) * 1000;
        if ( !Number.isFinite(ms) || ms <= 0 ) return null;
        try {
            return window.timeago?.format(ms) ?? new Date(ms).toLocaleString();
        } catch {
            return new Date(ms).toLocaleString();
        }
    };
    const fmtAbsolute = (secs) => {
        if ( !secs ) return null;
        const ms = Number(secs) * 1000;
        if ( !Number.isFinite(ms) || ms <= 0 ) return null;
        return new Date(ms).toLocaleString();
    };

    const sessionTitle = (session) => {
        if ( session.kind === 'worker' ) {
            const name = session.worker_name || (i18n('ui_session_kind_worker') || 'Worker');
            const appPart = session.app?.title || session.app?.name;
            return appPart ? `${name} (${appPart})` : name;
        }
        if ( session.kind === 'app' ) {
            return session.app?.title || session.app?.name || i18n('ui_session_kind_app') || 'App session';
        }
        if ( session.kind === 'access_token' ) {
            return session.label || i18n('ui_session_kind_access_token') || 'Access token';
        }
        if ( session.kind === 'web' ) {
            return session.label || i18n('ui_session_kind_web') || 'Browser session';
        }
        return session.label || session.kind || 'Session';
    };

    // Search query lives in closure — rebuilt rows consult it when
    // deciding visibility so re-renders after a revoke/reload preserve
    // the active filter without re-reading the DOM.
    let searchQuery = '';

    const rowMatchesQuery = (session, query) => {
        if ( !query ) return true;
        const q = query.toLowerCase();
        const fields = [
            sessionTitle(session),
            session.label,
            session.kind,
            session.last_ip,
            session.app?.title,
            session.app?.name,
            session.last_user_agent,
        ];
        const ua = parseUserAgent(session.last_user_agent);
        fields.push(ua.browser, ua.os);
        return fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(q));
    };

    // Build a compact meta line (client · ip, or active · created · expires)
    // from a list of { text, title } parts. Returns null when empty so the
    // caller can skip appending an empty row.
    const buildMetaLine = (parts, extraClass) => {
        const items = parts.filter((p) => p && p.text);
        if ( items.length === 0 ) return null;
        const line = document.createElement('div');
        line.classList.add('session-widget-meta');
        if ( extraClass ) line.classList.add(extraClass);
        for ( const it of items ) {
            const span = document.createElement('span');
            span.classList.add('session-widget-meta-item');
            span.textContent = it.text;
            if ( it.title ) span.title = it.title;
            line.appendChild(span);
        }
        return line;
    };

    const SessionWidget = ({ session, children = [], depth = 0 }) => {
        const el = document.createElement('div');
        el.classList.add('session-widget');
        if ( session.current ) el.classList.add('current-session');
        if ( depth > 0 ) el.classList.add('session-widget-child');
        el.dataset.uuid = session.uuid;

        const el_row = document.createElement('div');
        el_row.classList.add('session-widget-row');
        el.appendChild(el_row);

        // Expand/collapse caret for rows with children.
        let el_children_container = null;
        let el_caret = null;
        if ( children.length > 0 ) {
            el_caret = document.createElement('button');
            el_caret.type = 'button';
            el_caret.classList.add('session-widget-caret');
            el_caret.innerHTML = ICONS.chevron;
            el_caret.setAttribute(
                'aria-label',
                i18n('ui_toggle_session_children') || 'Toggle child sessions',
            );
            el_caret.setAttribute('aria-expanded', 'true');
            el_caret.addEventListener('click', () => {
                if ( !el_children_container ) return;
                const collapsed = el_children_container.style.display === 'none';
                el_children_container.style.display = collapsed ? '' : 'none';
                el_caret.classList.toggle('collapsed', !collapsed);
                el_caret.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
            });
            el_row.appendChild(el_caret);
        }

        // Icon tile — app icon when available, otherwise a device/kind glyph.
        const el_icon = document.createElement('div');
        el_icon.classList.add('session-widget-icon');
        if ( session.kind === 'app' && session.app?.icon ) {
            el_icon.classList.add('session-widget-icon-img');
            const img = document.createElement('img');
            img.src = session.app.icon;
            img.alt = '';
            el_icon.appendChild(img);
        } else {
            el_icon.innerHTML = deviceIconSvg(session);
        }
        el_row.appendChild(el_icon);

        // Main column: title line + meta lines.
        const el_main = document.createElement('div');
        el_main.classList.add('session-widget-main');

        const el_titleline = document.createElement('div');
        el_titleline.classList.add('session-widget-titleline');

        // Title + inline rename. Pencil opens an <input>; Enter saves,
        // Escape cancels. Optimistic update; revert on non-2xx.
        const el_title_wrap = document.createElement('div');
        el_title_wrap.classList.add('session-widget-title-wrap');

        const el_title = document.createElement('div');
        el_title.classList.add('session-widget-title');
        el_title.textContent = sessionTitle(session);
        el_title_wrap.appendChild(el_title);

        const el_rename_btn = document.createElement('button');
        el_rename_btn.type = 'button';
        el_rename_btn.classList.add('session-widget-rename');
        el_rename_btn.innerHTML = ICONS.pencil;
        el_rename_btn.setAttribute(
            'aria-label',
            i18n('ui_rename') || 'Rename session',
        );
        el_rename_btn.title = i18n('ui_rename') || 'Rename';
        el_rename_btn.addEventListener('click', () => beginRename());
        el_title_wrap.appendChild(el_rename_btn);

        const beginRename = () => {
            const original = session.label ?? '';
            const el_input = document.createElement('input');
            el_input.type = 'text';
            el_input.value = original;
            el_input.maxLength = 64;
            el_input.classList.add('session-widget-rename-input');
            el_title_wrap.replaceChild(el_input, el_title);
            el_rename_btn.style.display = 'none';
            el_input.focus();
            el_input.select();

            // Enter / Escape both unfocus the input, which fires a blur
            // *after* the keydown handler runs. Without this guard the
            // blur listener would call finish() a second time —
            // double-throwing on replaceChild and silently committing
            // even when the user pressed Escape.
            let finished = false;
            const finish = async (commit) => {
                if ( finished ) return;
                finished = true;
                el_input.removeEventListener('blur', onBlur);
                el_title_wrap.replaceChild(el_title, el_input);
                el_rename_btn.style.display = '';
                if ( !commit ) return;
                const next = el_input.value.trim().slice(0, 64);
                if ( next === (original ?? '').trim() ) return;
                // Optimistic
                session.label = next || null;
                el_title.textContent = sessionTitle(session);
                try {
                    const anti_csrf = await services.get('anti-csrf').token();
                    const resp = await fetch(
                        `${window.api_origin}/auth/sessions/${encodeURIComponent(session.uuid)}/label`,
                        {
                            method: 'PATCH',
                            headers: {
                                Authorization: `Bearer ${puter.authToken}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                label: next || null,
                                anti_csrf,
                            }),
                        },
                    );
                    if ( !resp.ok ) throw new Error(await resp.text());
                } catch ( e ) {
                    // Roll back optimistic update
                    session.label = original || null;
                    el_title.textContent = sessionTitle(session);
                    alertDialog({ message: e?.toString?.() ?? String(e) });
                }
            };

            const onBlur = () => finish(true);
            el_input.addEventListener('keydown', (ev) => {
                if ( ev.key === 'Enter' ) finish(true);
                else if ( ev.key === 'Escape' ) finish(false);
            });
            el_input.addEventListener('blur', onBlur);
        };

        el_titleline.appendChild(el_title_wrap);

        const el_badges = document.createElement('div');
        el_badges.classList.add('session-widget-badges');
        if ( session.current ) {
            const b = document.createElement('span');
            b.classList.add('session-widget-badge', 'session-widget-badge-current');
            b.textContent = i18n('ui_session_current') || 'Current';
            el_badges.appendChild(b);
        }
        if ( session.kind && session.kind !== 'web' ) {
            const b = document.createElement('span');
            b.classList.add('session-widget-badge', `session-widget-badge-${session.kind}`);
            b.textContent = kindBadgeLabel(session.kind);
            el_badges.appendChild(b);
        }
        el_titleline.appendChild(el_badges);
        el_main.appendChild(el_titleline);

        // Primary meta: client / app · IP.
        const ua = parseUserAgent(session.last_user_agent);
        const uaLabel = formatBrowserOs(ua);
        const primaryParts = [];
        if ( session.kind === 'app' && session.app ) {
            primaryParts.push({ text: session.app.title || session.app.name || session.app_uid });
        } else if ( uaLabel ) {
            primaryParts.push({ text: uaLabel, title: session.last_user_agent });
        }
        if ( session.last_ip ) primaryParts.push({ text: session.last_ip });
        const el_meta_primary = buildMetaLine(primaryParts);
        if ( el_meta_primary ) el_main.appendChild(el_meta_primary);

        // Secondary meta: last active · created · expires (with absolute-time
        // tooltips on hover).
        const lastActive = fmtRelative(session.last_activity);
        const created = fmtRelative(session.created_at);
        const expires = session.expires_at ? fmtRelative(session.expires_at) : null;
        const secondaryParts = [
            lastActive && {
                text: `${i18n('ui_session_last_active') || 'Last active'} ${lastActive}`,
                title: fmtAbsolute(session.last_activity),
            },
            created && {
                text: `${i18n('ui_session_created') || 'Created'} ${created}`,
                title: fmtAbsolute(session.created_at),
            },
            expires && {
                text: `${i18n('ui_session_expires') || 'Expires'} ${expires}`,
                title: fmtAbsolute(session.expires_at),
            },
        ];
        const el_meta_secondary = buildMetaLine(secondaryParts, 'session-widget-meta-secondary');
        if ( el_meta_secondary ) el_main.appendChild(el_meta_secondary);

        el_row.appendChild(el_main);

        // Actions: omit revoke entirely for the current session so the
        // caller can't self-revoke (backend also rejects this).
        if ( ! session.current ) {
            const el_actions = document.createElement('div');
            el_actions.classList.add('session-widget-actions');

            const el_btn_revoke = document.createElement('button');
            el_btn_revoke.type = 'button';
            el_btn_revoke.classList.add('session-widget-revoke');
            el_btn_revoke.innerHTML = `${ICONS.trash}<span>${i18n('ui_revoke')}</span>`;
            el_btn_revoke.title = i18n('ui_revoke');
            el_btn_revoke.addEventListener('click', async () => {
                try {
                    const ok = await confirmDialog({
                        message: i18n('confirm_session_revoke'),
                        confirmLabel: i18n('ui_revoke'),
                        danger: true,
                    });
                    if ( ! ok ) return;

                    const anti_csrf = await services.get('anti-csrf').token();

                    // Route access-token rows to the dedicated endpoint
                    // so `access_token_permissions` is cleared in addition
                    // to the session row being soft-revoked. Everything
                    // else (web/app/asset/worker) goes through cascade-
                    // capable /auth/revoke-session.
                    const isAccessToken = session.kind === 'access_token';
                    const url = isAccessToken
                        ? `${window.api_origin}/auth/revoke-access-token`
                        : `${window.api_origin}/auth/revoke-session`;
                    const body = isAccessToken
                        ? { tokenOrUuid: session.uuid, anti_csrf }
                        : { uuid: session.uuid, anti_csrf };

                    const resp = await fetch(url, {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${puter.authToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(body),
                    });
                    if ( resp.ok ) {
                        // Full reload — cascade may have killed children
                        // we'd otherwise have to detach by hand.
                        reload_sessions();
                        return;
                    }
                    alertDialog({ message: await resp.text() });
                } catch ( e ) {
                    alertDialog({ message: e.toString() });
                }
            });
            el_actions.appendChild(el_btn_revoke);
            el_row.appendChild(el_actions);
        }

        // Children container — only rendered when this row has any.
        if ( children.length > 0 ) {
            el_children_container = document.createElement('div');
            el_children_container.classList.add('session-widget-children');
            for ( const child of children ) {
                SessionWidget({
                    session: child.session,
                    children: child.children,
                    depth: depth + 1,
                }).appendTo(el_children_container);
            }
            el.appendChild(el_children_container);
        }

        // Filter visibility. Hide rows whose subtree contains no match —
        // but if a child matches, surface the parent too so the child is
        // reachable, even if the parent itself wouldn't match alone.
        const subtreeMatches = (sess, kids) =>
            rowMatchesQuery(sess, searchQuery) ||
            kids.some((k) => subtreeMatches(k.session, k.children));
        if ( ! subtreeMatches(session, children) ) {
            el.style.display = 'none';
        }

        return {
            appendTo (parent) {
                parent.appendChild(el);
                return this;
            },
        };
    };

    const buildTree = (sessions) => {
        // Index every row by uuid, then attach each row whose
        // parent_session_id matches a known root. Rows whose parent
        // is missing (e.g. cross-user link or stale) surface as
        // top-level so they're not orphaned and hidden.
        const byUuid = new Map();
        for ( const s of sessions ) byUuid.set(s.uuid, { session: s, children: [] });
        const roots = [];
        for ( const s of sessions ) {
            const node = byUuid.get(s.uuid);
            const parent = s.parent_session_id ? byUuid.get(s.parent_session_id) : null;
            if ( parent ) parent.children.push(node);
            else roots.push(node);
        }
        return roots;
    };

    // Last fetched session list — search filtering re-renders from this
    // cache instead of hitting /auth/list-sessions on every keystroke.
    // Refreshed by reload_sessions (focus / interval / post-revoke / etc.).
    let cachedSessions = [];

    // Set by the toolbar below; render() keeps its text in sync. Declared
    // here so the render closure can see it (assigned before render runs).
    let el_count = null;

    // Re-render the visible tree from the in-memory cache. Cheap; safe to
    // call on every search keystroke.
    const render = () => {
        w_body_list.replaceChildren();
        const roots = buildTree(cachedSessions);
        for ( const root of roots ) {
            SessionWidget({
                session: root.session,
                children: root.children,
                depth: 0,
            }).appendTo(w_body_list);
        }
        if ( el_count ) {
            const n = cachedSessions.length;
            el_count.textContent = n === 1
                ? i18n('ui_session_count_one', [], false)
                : i18n('ui_session_count_other', [String(n)], false);
        }
    };

    const reload_sessions = async () => {
        let resp, sessions;
        try {
            resp = await fetch(`${window.api_origin}/auth/list-sessions`, {
                headers: { Authorization: `Bearer ${puter.authToken}` },
                method: 'GET',
            });
            sessions = await resp.json();
        } catch {
            // Network flake — keep whatever's currently rendered.
            return;
        }
        if ( !Array.isArray(sessions) ) return;
        cachedSessions = sessions;
        render();
    };

    // Toolbar: search input + a de-emphasised "Revoke all other sessions"
    // ghost button (destructive, so it stays red, but no longer a giant
    // filled block competing with the search field).
    const el_toolbar = document.createElement('div');
    el_toolbar.classList.add('session-manager-toolbar');

    const el_search_wrap = document.createElement('div');
    el_search_wrap.classList.add('session-manager-search-wrap');

    const el_search_icon = document.createElement('span');
    el_search_icon.classList.add('session-manager-search-icon');
    el_search_icon.innerHTML = ICONS.search;
    el_search_wrap.appendChild(el_search_icon);

    const el_search = document.createElement('input');
    el_search.type = 'search';
    el_search.placeholder = i18n('ui_search') || 'Search sessions…';
    el_search.classList.add('session-manager-search');
    el_search.addEventListener('input', () => {
        searchQuery = el_search.value.trim();
        // Pure client-side filter — re-render from the cached list
        // rather than re-fetching /auth/list-sessions per keystroke.
        render();
    });
    el_search_wrap.appendChild(el_search);
    el_toolbar.appendChild(el_search_wrap);

    const el_btn_revoke_all = document.createElement('button');
    el_btn_revoke_all.type = 'button';
    el_btn_revoke_all.classList.add('session-manager-revoke-all');
    el_btn_revoke_all.innerHTML =
        `${ICONS.trash}<span>${i18n('ui_revoke_all_other_sessions') || 'Revoke all others'}</span>`;
    el_btn_revoke_all.addEventListener('click', async () => {
        try {
            const ok = await confirmDialog({
                message: i18n('confirm_revoke_all_other_sessions'),
                confirmLabel: i18n('ui_revoke'),
                danger: true,
            });
            if ( ! ok ) return;

            const anti_csrf = await services.get('anti-csrf').token();
            const resp = await fetch(
                `${window.api_origin}/auth/revoke-all-sessions`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${puter.authToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        include_current: false,
                        include_apps: false,
                        anti_csrf,
                    }),
                },
            );
            if ( resp.ok ) {
                reload_sessions();
                return;
            }
            alertDialog({ message: await resp.text() });
        } catch ( e ) {
            alertDialog({ message: e.toString() });
        }
    });
    el_toolbar.appendChild(el_btn_revoke_all);

    w_body.appendChild(el_toolbar);

    // Session count line (kept in sync by render()).
    el_count = document.createElement('div');
    el_count.classList.add('session-manager-count');
    w_body.appendChild(el_count);

    const w_body_list = document.createElement('div');
    w_body_list.classList.add('session-manager-list-body');
    w_body.appendChild(w_body_list);

    reload_sessions();

    // Two-tier refresh:
    //   - focus → re-fetch immediately (cheapest signal that something
    //     in the user's other tabs might have changed sessions).
    //   - 60s fallback interval so a long-lived but unfocused modal
    //     still eventually sees revocations propagate.
    onFocus = () => reload_sessions();
    window.addEventListener('focus', onFocus);
    interval = setInterval(reload_sessions, 60_000);
};

export default UIWindowManageSessions;
