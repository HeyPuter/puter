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

import {
    browserPushState,
    enableBrowserPush,
    pushClientWithin,
    withEnableDeadline,
} from '../helpers/pushClient.js';
import {
    guard_input,
    identity_html,
    INPUT_PROTECTION_MS,
    resolve_requesting_entity,
} from './UIPermissionDialog.js';

/** @typedef {import('../helpers/pushClient.js').BrowserPushState} BrowserPushState */

/** Offers to turn push on in this browser from the one button whose click the browser's prompt needs; shown only while push is off here, any other state resolves at once. @param {{ app_name?: string, origin?: string }} [options] Who asked, for the title line @returns {Promise<BrowserPushState>} The state once done, `'on'` when it registered */
async function UIEnablePushDialog (options = {}) {
    const client = await pushClientWithin();
    const state = await browserPushState(client);
    if ( state !== 'off' ) return state;

    const entity = await resolve_requesting_entity(options);

    return new Promise((resolve) => {
        const el_dialog = create_dialog_element(entity);
        document.body.appendChild(el_dialog);

        let settled = false;
        let input_guard = null;
        const settle = (result) => {
            if ( settled ) return;
            settled = true;
            input_guard?.stop();
            resolve(result);
            el_dialog.close();
            el_dialog.remove();
        };

        const $turn_on = $(el_dialog).find('.perm-dialog-allow');
        const $not_now = $(el_dialog).find('.perm-dialog-deny');
        const $error = $(el_dialog).find('.perm-dialog-error');

        // The one enable() in flight; cleared only when it failed, so a retry never overlaps it.
        let pending = null;
        // True from Turn on until the registration settles or outlasts its deadline.
        let waiting = false;
        const sync_buttons = () => {
            const ready = !! input_guard?.ready && ! waiting;
            $turn_on.prop('disabled', ! ready || !! pending);
            $not_now.prop('disabled', ! ready);
        };
        sync_buttons();

        $turn_on.on('click', async () => {
            if ( pending ) return;
            pending = enableBrowserPush(client);
            pending.then((ok) => {
                if ( ok ) settle('on');
            });
            waiting = true;
            $turn_on.addClass('perm-dialog-busy');
            sync_buttons();
            $error.hide();

            const outcome = await withEnableDeadline(pending, { fallback: null });
            if ( outcome === true ) return;
            if ( outcome === false ) {
                pending = null;
                const now = await browserPushState(client);
                if ( now !== 'off' ) {
                    settle(now);
                    return;
                }
            }
            waiting = false;
            if ( ! el_dialog.open ) {
                settle('off');
                return;
            }
            $error.text(i18n('push_enable_failed', [], false)).show();
            if ( ! pending ) $turn_on.removeClass('perm-dialog-busy');
            sync_buttons();
        });

        $not_now.on('click', () => settle('off'));

        el_dialog.addEventListener('cancel', (e) => {
            e.preventDefault();
            if ( waiting ) return;
            settle('off');
        });
        el_dialog.addEventListener('close', () => {
            if ( waiting ) return;
            settle('off');
        });

        try {
            el_dialog.showModal();
        } catch (e) {
            console.error('Push dialog could not be shown', e);
            el_dialog.remove();
            settle('off');
            return;
        }
        input_guard = guard_input({
            win: window,
            doc: document,
            ms: INPUT_PROTECTION_MS,
            on_change: (ready) => {
                sync_buttons();
                if ( ready && ! waiting ) $not_now.get(0)?.focus();
            },
        });
    });
}

function create_dialog_element (entity) {
    let h = '';
    h += '<div class="perm-dialog-body">';
    h += identity_html(entity);
    h += `<p class="perm-dialog-lead">${i18n('enable_push_lead')}</p>`;
    h += '<p class="perm-dialog-error" style="display: none;"></p>';
    h += '<div class="perm-dialog-actions">';
    h += `<button type="button" class="perm-dialog-allow">${i18n('enable_push_turn_on')}</button>`;
    h += `<button type="button" class="perm-dialog-deny">${i18n('enable_push_not_now')}</button>`;
    h += '</div>';
    h += `<p class="perm-dialog-footnote">${i18n('enable_push_footnote')}</p>`;
    h += '</div>';

    const el_dialog = document.createElement('dialog');
    el_dialog.className = 'perm-dialog enable-push-dialog';
    el_dialog.setAttribute('aria-label', entity.display_name);
    el_dialog.innerHTML = h;
    return el_dialog;
}

export default UIEnablePushDialog;
