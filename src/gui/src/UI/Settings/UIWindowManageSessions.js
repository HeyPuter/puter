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
import UIAlert from "../UIAlert.js";
import UIWindow from "../UIWindow.js";

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
        width: 500,
        height: "auto",
        body_css: {
            padding: '20px',
            'background-color': 'rgb(245 247 249)',
        },
        window_css: {
            'background-color': 'rgb(245 247 249)',
        },
        ...options.window_options,
    });

    const SessionWidget = ({ session }) => {
        const el = document.createElement('div');
        el.classList.add('session-widget');
        if ( session.current ) {
            el.classList.add('current-session');
        }
        el.dataset.uuid = session.uuid;

        // Helper function to format relative time
        const getRelativeTime = (timestamp) => {
            if (!timestamp) return i18n('unknown');
            const now = Date.now();
            const time = new Date(timestamp).getTime();
            const diff = now - time;

            const seconds = Math.floor(diff / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);

            if (days > 0) return `${days} ${i18n(days > 1 ? 'days' : 'day')} ${i18n('ago')}`;
            if (hours > 0) return `${hours} ${i18n(hours > 1 ? 'hours' : 'hour')} ${i18n('ago')}`;
            if (minutes > 0) return `${minutes} ${i18n(minutes > 1 ? 'minutes' : 'minute')} ${i18n('ago')}`;
            return i18n('just_now');
        };

        // Helper function to detect device type from user agent
        const getDeviceInfo = (userAgent) => {
            if (!userAgent) return { type: 'desktop', name: i18n('device_desktop') };

            const ua = userAgent.toLowerCase();
            if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
                return { type: 'mobile', name: i18n('device_mobile') };
            }
            if (ua.includes('tablet') || ua.includes('ipad')) {
                return { type: 'tablet', name: i18n('device_tablet') };
            }
            return { type: 'desktop', name: i18n('device_desktop') };
        };

        const deviceInfo = getDeviceInfo(session.meta?.['user-agent']);

        const el_content = document.createElement('div');
        el_content.classList.add('session-widget-content');

        const el_main = document.createElement('div');
        el_main.classList.add('session-widget-main');
        el_main.innerHTML = `
            <div class="session-widget-title">
                ${deviceInfo.name}
                ${session.current ? `<span class="current-badge">${i18n('current')}</span>` : ''}
            </div>
            <div class="session-widget-details">
                <span class="session-widget-time">${getRelativeTime(session.meta?.timestamp || session.created_at)}</span>
                ${session.meta?.location || session.meta?.ip ? `<span class="session-widget-separator">•</span><span class="session-widget-location">${session.meta?.location || session.meta?.ip}</span>` : ''}
            </div>
        `;

        el_content.appendChild(el_main);

        if (!session.current) {
            const el_btn_revoke = document.createElement('button');
            el_btn_revoke.textContent = i18n('ui_revoke');
            el_btn_revoke.classList.add('button', 'button-small', 'button-danger');
            el_btn_revoke.addEventListener('click', async () => {
            try{
            const alert_resp = await UIAlert({
                message: i18n('confirm_session_revoke'),
                buttons:[
                    {
                        label: i18n('yes'),
                        value: 'yes',
                        type: 'primary',
                    },
                    {
                        label: i18n('cancel')
                    },
                ]
            });

            if ( alert_resp !== 'yes' ) {
                return;
            }
            

            const anti_csrf = await services.get('anti-csrf').token();

            const resp = await fetch(`${window.api_origin}/auth/revoke-session`, {
                method: 'POST',
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
            UIAlert({ message: await resp.text() });
            } catch ( e ) {
                UIAlert({ message: e.toString() });
            }
        });
            el_content.appendChild(el_btn_revoke);
        }

        el.appendChild(el_content);

        return {
            appendTo (parent) {
                parent.appendChild(el);
                return this;
            }
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
            if ( !sessions.find(s => s.uuid === el.dataset.uuid) ) {
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

    // Add header
    const header = document.createElement('div');
    header.classList.add('session-manager-header');
    header.innerHTML = `
        <p class="session-manager-description">${i18n('session_manager_description')}</p>
    `;
    w_body.appendChild(header);

    reload_sessions();
    const interval = setInterval(reload_sessions, 8000);
    w.on_close = () => {
        clearInterval(interval);
    }
};

export default UIWindowManageSessions;
