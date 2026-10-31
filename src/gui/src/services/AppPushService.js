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

import { Service } from '../definitions.js';
import { appHoldsPermissions } from '../helpers/holdsPermissions.js';
import { browserPushState, PUSH_PERMISSION, pushClientWithin } from '../helpers/pushClient.js';

/** The calling app, from the GUI's own record of the window that owns its iframe. */
const app_uid_of = (ipc_context) => ipc_context?.caller?.app?.window?.attr?.('data-app_uuid');

/**
 * Answers an app's `puter.notifications` calls about its own pushes in this
 * browser.
 */
export class AppPushService extends Service {
    static description = `
        Tells apps whether their pushes reach this browser.
    `;

    async _init ({ services }) {
        const svc_ipc = services.get('ipc');
        svc_ipc.register_ipc_handler('pushStatus', {
            handler: this.pushStatus.bind(this),
        });
    }

    /**
     * IPC: this browser's push state for the calling app, `on` only while
     * push is on here and the app holds `notifications:push`.
     *
     * @returns {Promise<{ state: 'on'|'off'|'blocked'|'unavailable' }>}
     */
    async pushStatus (_params, { ipc_context } = {}) {
        const state = await browserPushState(await pushClientWithin());
        if ( state !== 'on' ) return { state };
        const held = await appHoldsPermissions([PUSH_PERMISSION], app_uid_of(ipc_context));
        return { state: held ? 'on' : 'off' };
    }
}
