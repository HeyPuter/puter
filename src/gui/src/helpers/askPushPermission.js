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

import UIPermissionDialog from '../UI/UIPermissionDialog.js';
import { browserPushState, PUSH_PERMISSION, pushClientWithin, withEnableDeadline } from './pushClient.js';

/**
 * Puter's `notifications:push` dialog, whose Allow also turns push on here; resolves the push state after, `'off'` when denied.
 *
 * @param {{ app_uid?: string, app_name?: string, origin?: string }} requester
 * @returns {Promise<import('./pushClient.js').BrowserPushState>}
 */
export const askPushPermission = async (requester) => {
    if ( ! requester?.app_uid && ! requester?.origin ) return 'unavailable';
    const client = await pushClientWithin();
    const state = await browserPushState(client);
    // A grant can't turn push on in this browser.
    if ( state === 'unavailable' || state === 'blocked' ) return state;
    let enabling = null;
    const granted = await UIPermissionDialog({
        ...requester,
        permission: PUSH_PERMISSION,
        on_push_enable: (promise) => {
            enabling = promise;
        },
    });
    if ( granted !== true ) return 'off';
    if ( enabling ) await withEnableDeadline(enabling);
    return await browserPushState(client);
};
