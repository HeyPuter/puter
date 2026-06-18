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
import UIAlert from './UIAlert.js';
import UIWindow from './UIWindow.js';

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

const UIWindowManageSessions = async function UIWindowManageSessions (options) {
    options = options ?? {};

    const services = globalThis.services;

    const w = await UIWindow({
        title: i18n('ui_manage_sessions'),
        icon: null,
        uid: null,
        is_dir: false,
        message: 'message',
        is_droppable: false,
        has_head: true,
        selectable_body: false,
        draggable_body: true,
        allow_context_menu: false,
        window_class: 'window-session-manager',
        dominant: true,
        body_content: '',
        ...options.window_options,
    });

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

    const SessionWidget = ({ session, children = [], depth = 0 }) => {
        const el = document.createElement('div');
        el.classList.add('session-widget');
        if ( session.current ) el.classList.add('current-session');
        if ( depth > 0 ) el.classList.add('session-widget-child');
        el.dataset.uuid = session.uuid;
        if ( depth > 0 ) el.style.marginLeft = `${depth * 24}px`;

        const el_header = document.createElement('div');
        el_header.classList.add('session-widget-header');

        // Expand/collapse caret for rows with children.
        let el_children_container = null;
        let el_caret = null;
        if ( children.length > 0 ) {
            el_caret = document.createElement('button');
            el_caret.type = 'button';
            el_caret.classList.add('session-widget-caret');
            el_caret.textContent = '▾';
            el_caret.style.marginRight = '4px';
            el_caret.setAttribute(
                'aria-label',
                i18n('ui_toggle_session_children') || 'Toggle child sessions',
            );
            el_caret.setAttribute('aria-expanded', 'true');
            el_caret.addEventListener('click', () => {
                if ( !el_children_container ) return;
                const collapsed = el_children_container.style.display === 'none';
                el_children_container.style.display = collapsed ? '' : 'none';
                el_caret.textContent = collapsed ? '▾' : '▸';
                el_caret.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
            });
            el_header.appendChild(el_caret);
        }

        if ( session.kind === 'app' && session.app?.icon ) {
            const el_icon = document.createElement('img');
            el_icon.classList.add('session-widget-app-icon');
            el_icon.src = session.app.icon;
            el_icon.alt = '';
            el_header.appendChild(el_icon);
        }

        // Title + inline rename. Pencil opens an <input>; Enter saves,
        // Escape cancels. Optimistic update; revert on non-2xx.
        const el_title_wrap = document.createElement('div');
        el_title_wrap.classList.add('session-widget-title-wrap');
        el_title_wrap.style.display = 'inline-flex';
        el_title_wrap.style.alignItems = 'center';
        el_title_wrap.style.gap = '4px';

        const el_title = document.createElement('div');
        el_title.classList.add('session-widget-title');
        el_title.textContent = sessionTitle(session);
        el_title_wrap.appendChild(el_title);

        const el_rename_btn = document.createElement('button');
        el_rename_btn.type = 'button';
        el_rename_btn.classList.add('session-widget-rename');
        el_rename_btn.textContent = '✎';
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
                    UIAlert({
                        parent_uuid: $(w).attr('data-element_uuid'),
                        stay_on_top: true,
                        message: e?.toString?.() ?? String(e),
                    });
                }
            };

            const onBlur = () => finish(true);
            el_input.addEventListener('keydown', (ev) => {
                if ( ev.key === 'Enter' ) finish(true);
                else if ( ev.key === 'Escape' ) finish(false);
            });
            el_input.addEventListener('blur', onBlur);
        };

        el_header.appendChild(el_title_wrap);

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
            b.textContent = session.kind;
            el_badges.appendChild(b);
        }
        el_header.appendChild(el_badges);
        el.appendChild(el_header);

        // Metadata rows
        const el_meta = document.createElement('div');
        el_meta.classList.add('session-widget-meta');

        const addRow = (key, value, absolute) => {
            if ( !value ) return;
            const el_entry = document.createElement('div');
            el_entry.classList.add('session-widget-meta-entry');

            const el_key = document.createElement('div');
            el_key.textContent = key;
            el_key.classList.add('session-widget-meta-key');
            el_entry.appendChild(el_key);

            const el_value = document.createElement('div');
            el_value.textContent = value;
            el_value.classList.add('session-widget-meta-value');
            if ( absolute ) el_value.title = absolute;
            el_entry.appendChild(el_value);

            el_meta.appendChild(el_entry);
        };

        if ( session.kind === 'app' && session.app ) {
            addRow(i18n('ui_session_app') || 'App', session.app.title || session.app.name || session.app_uid);
        }
        addRow(
            i18n('ui_session_created') || 'Created',
            fmtRelative(session.created_at),
            fmtAbsolute(session.created_at),
        );
        addRow(
            i18n('ui_session_last_active') || 'Last active',
            fmtRelative(session.last_activity),
            fmtAbsolute(session.last_activity),
        );
        if ( session.expires_at ) {
            addRow(
                i18n('ui_session_expires') || 'Expires',
                fmtRelative(session.expires_at),
                fmtAbsolute(session.expires_at),
            );
        }
        if ( session.last_ip ) {
            addRow(i18n('ui_session_ip') || 'IP', session.last_ip);
        }
        const ua = parseUserAgent(session.last_user_agent);
        const uaLabel = formatBrowserOs(ua);
        if ( uaLabel ) {
            const el_entry = document.createElement('div');
            el_entry.classList.add('session-widget-meta-entry');
            const el_key = document.createElement('div');
            el_key.textContent = i18n('ui_session_client') || 'Client';
            el_key.classList.add('session-widget-meta-key');
            el_entry.appendChild(el_key);
            const el_value = document.createElement('div');
            el_value.textContent = uaLabel;
            el_value.classList.add('session-widget-meta-value');
            // Raw UA string surfaced on hover for the rare case where
            // the heuristic mis-classifies and the user wants to know
            // what's actually there.
            el_value.title = session.last_user_agent;
            el_entry.appendChild(el_value);
            el_meta.appendChild(el_entry);
        }

        el.appendChild(el_meta);

        // Actions: omit revoke entirely for the current session so the
        // caller can't self-revoke (backend also rejects this).
        if ( ! session.current ) {
            const el_actions = document.createElement('div');
            el_actions.classList.add('session-widget-actions');

            const el_btn_revoke = document.createElement('button');
            el_btn_revoke.textContent = i18n('ui_revoke');
            el_btn_revoke.classList.add('button', 'button-danger');
            el_btn_revoke.addEventListener('click', async () => {
                try {
                    const parent_uuid = $(w).attr('data-element_uuid');
                    const alert_resp = await UIAlert({
                        parent_uuid,
                        stay_on_top: true,
                        message: i18n('confirm_session_revoke'),
                        buttons: [
                            {
                                label: i18n('yes'),
                                value: 'yes',
                                type: 'primary',
                            },
                            { label: i18n('cancel') },
                        ],
                    });
                    if ( alert_resp !== 'yes' ) return;

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
                    UIAlert({ parent_uuid, stay_on_top: true, message: await resp.text() });
                } catch ( e ) {
                    UIAlert({
                        parent_uuid: $(w).attr('data-element_uuid'),
                        stay_on_top: true,
                        message: e.toString(),
                    });
                }
            });
            el_actions.appendChild(el_btn_revoke);
            el.appendChild(el_actions);
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

    const w_body = w.querySelector('.window-body');
    w_body.classList.add('session-manager-list');

    // Toolbar: search input + "Revoke all other sessions" button.
    const el_toolbar = document.createElement('div');
    el_toolbar.classList.add('session-manager-toolbar');

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
    el_toolbar.appendChild(el_search);

    const el_btn_revoke_all = document.createElement('button');
    el_btn_revoke_all.textContent =
        i18n('ui_revoke_all_other_sessions') || 'Revoke all other sessions';
    el_btn_revoke_all.classList.add('button', 'button-danger');
    el_btn_revoke_all.addEventListener('click', async () => {
        const parent_uuid = $(w).attr('data-element_uuid');
        try {
            const alert_resp = await UIAlert({
                parent_uuid,
                stay_on_top: true,
                message:
                    i18n('confirm_revoke_all_other_sessions') ||
                    'Revoke all other sessions? You will stay signed in here.',
                buttons: [
                    {
                        label: i18n('yes'),
                        value: 'yes',
                        type: 'primary',
                    },
                    { label: i18n('cancel') },
                ],
            });
            if ( alert_resp !== 'yes' ) return;

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
            UIAlert({ parent_uuid, stay_on_top: true, message: await resp.text() });
        } catch ( e ) {
            UIAlert({
                parent_uuid,
                stay_on_top: true,
                message: e.toString(),
            });
        }
    });
    el_toolbar.appendChild(el_btn_revoke_all);

    w_body.appendChild(el_toolbar);

    const w_body_list = document.createElement('div');
    w_body_list.classList.add('session-manager-list-body');
    w_body.appendChild(w_body_list);

    reload_sessions();

    // Two-tier refresh:
    //   - focus → re-fetch immediately (cheapest signal that something
    //     in the user's other tabs might have changed sessions).
    //   - 60s fallback interval so a long-lived but unfocused window
    //     still eventually sees revocations propagate.
    // Older code polled every 8s flat — that burned CPU + network
    // continuously even when the window wasn't visible.
    const onFocus = () => reload_sessions();
    window.addEventListener('focus', onFocus);
    const interval = setInterval(reload_sessions, 60_000);

    w.on_close = () => {
        clearInterval(interval);
        window.removeEventListener('focus', onFocus);
    };
};

export default UIWindowManageSessions;
