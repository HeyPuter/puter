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

const UIWindowManageSessions = async function UIWindowManageSessions (options) {
    options = options ?? {};

    const services = globalThis.services;

    const w = await UIWindow({
        title: i18n('ui_manage_sessions'),
        icon: null,
        uid: null,
        is_dir: false,
        message: 'message',
        // body_icon: options.body_icon,
        // backdrop: options.backdrop ?? false,
        is_droppable: false,
        has_head: true,
        selectable_body: false,
        draggable_body: true,
        allow_context_menu: false,
        window_class: 'window-session-manager',
        dominant: true,
        body_content: '',
        // width: 600,
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
            // Worker rows surface `worker_name` from meta. Show the
            // worker's own name first, then the app it's bound to (if
            // any) for context.
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

    const SessionWidget = ({ session }) => {
        const el = document.createElement('div');
        el.classList.add('session-widget');
        if ( session.current ) {
            el.classList.add('current-session');
        }
        el.dataset.uuid = session.uuid;

        // ── Header: icon (app) + title + badges
        const el_header = document.createElement('div');
        el_header.classList.add('session-widget-header');

        if ( session.kind === 'app' && session.app?.icon ) {
            const el_icon = document.createElement('img');
            el_icon.classList.add('session-widget-app-icon');
            el_icon.src = session.app.icon;
            el_icon.alt = '';
            el_header.appendChild(el_icon);
        }

        const el_title = document.createElement('div');
        el_title.classList.add('session-widget-title');
        el_title.textContent = sessionTitle(session);
        el_header.appendChild(el_title);

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

        // ── Metadata rows
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

        el.appendChild(el_meta);

        // ── Actions: omit revoke entirely for the current session so the
        //    caller can't self-revoke (backend also rejects this, but the
        //    button has no useful meaning here either way — /logout is
        //    the right path for "end the session you're using").
        if ( ! session.current ) {
            const el_actions = document.createElement('div');
            el_actions.classList.add('session-widget-actions');

            const el_btn_revoke = document.createElement('button');
            el_btn_revoke.textContent = i18n('ui_revoke');
            el_btn_revoke.classList.add('button', 'button-danger');
            el_btn_revoke.addEventListener('click', async () => {
                try {
                    // parent_uuid routes the UIAlert under this window so it
                    // stacks above the dominant manage-sessions modal.
                    // Without it, the confirm prompt rendered behind the
                    // session list because both windows share the dominant
                    // z-index pool.
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
                            {
                                label: i18n('cancel'),
                            },
                        ],
                    });

                    if ( alert_resp !== 'yes' ) {
                        return;
                    }

                    const anti_csrf = await services.get('anti-csrf').token();

                    const resp = await fetch(`${window.api_origin}/auth/revoke-session`, {
                        method: 'POST',
                        credentials: 'include',
                        headers: {
                            Authorization: `Bearer ${puter.authToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            uuid: session.uuid,
                            anti_csrf,
                        }),
                    });
                    if ( resp.ok ) {
                        el.remove();
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

        return {
            appendTo (parent) {
                parent.appendChild(el);
                return this;
            },
        };
    };

    const reload_sessions = async () => {
        const resp = await fetch(`${window.api_origin}/auth/list-sessions`, {
            headers: {
                Authorization: `Bearer ${puter.authToken}`,
            },
            method: 'GET',
        });

        const sessions = await resp.json();

        for ( const el of w_body.querySelectorAll('.session-widget') ) {
            if ( ! sessions.find(s => s.uuid === el.dataset.uuid) ) {
                el.remove();
            }
        }

        for ( const session of sessions ) {
            if ( w.querySelector(`.session-widget[data-uuid="${session.uuid}"]`) ) {
                continue;
            }
            SessionWidget({ session }).appendTo(w_body);
        }
    };

    const w_body = w.querySelector('.window-body');

    w_body.classList.add('session-manager-list');

    reload_sessions();
    const interval = setInterval(reload_sessions, 8000);
    w.on_close = () => {
        clearInterval(interval);
    };
};

export default UIWindowManageSessions;
