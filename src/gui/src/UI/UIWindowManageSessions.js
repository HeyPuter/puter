import UIAlert from "./UIAlert.js";
import UIWindow from "./UIWindow.js";

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

    const SessionWidget = ({ session }) => {
        const el = document.createElement('div');
        el.classList.add('session-widget');
        if ( session.current ) {
            el.classList.add('current-session');
        }
        el.dataset.uuid = session.uuid;
        // '<pre>' +
        //    JSON.stringify(session, null, 2) +
        //     '</pre>';

        const el_uuid = document.createElement('div');
        el_uuid.textContent = session.uuid;
        el.appendChild(el_uuid);
        el_uuid.classList.add('session-widget-uuid');

        const el_meta = document.createElement('div');
        el_meta.classList.add('session-widget-meta');
        for ( const key in session.meta ) {
            const el_entry = document.createElement('div');
            el_entry.classList.add('session-widget-meta-entry');

            const el_key = document.createElement('div');
            el_key.textContent = key;
            el_key.classList.add('session-widget-meta-key');
            el_entry.appendChild(el_key);

            const el_value = document.createElement('div');
            el_value.textContent = session.meta[key];
            el_value.classList.add('session-widget-meta-value');
            el_entry.appendChild(el_value);

            el_meta.appendChild(el_entry);
        }
        el.appendChild(el_meta);

        const el_actions = document.createElement('div');
        el_actions.classList.add('session-widget-actions');

        const el_btn_revoke = document.createElement('button');
        el_btn_revoke.textContent = i18n('ui_revoke');
        el_btn_revoke.classList.add('button', 'button-danger');
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

            const resp = await fetch(`${window.api_origin}/auth/revoke-session`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${puter.authToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    uuid: session.uuid,
                }),
            });
            if ( resp.ok ) {
                el.remove();
                return;
            }
            UIAlert({ message: await resp.text() }).appendTo(w_body);
            } catch ( e ) {
                UIAlert({ message: e.toString() }).appendTo(w_body);
            }
        });
        el_actions.appendChild(el_btn_revoke);
        el.appendChild(el_actions);

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

    reload_sessions();
    const interval = setInterval(reload_sessions, 8000);
    w.on_close = () => {
        clearInterval(interval);
    }
};

export default UIWindowManageSessions;
