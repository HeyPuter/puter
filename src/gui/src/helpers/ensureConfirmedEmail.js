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

import UIWindowSaveAccount from '../UI/UIWindowSaveAccount.js';
import UIWindowEmailConfirmationRequired from '../UI/UIWindowEmailConfirmationRequired.js';

// The walk-through showing, which a call made meanwhile joins.
let showing = null;

const walkThrough = async (message, window_options) => {
    if ( window.user.is_temp && ! await UIWindowSaveAccount({
        send_confirmation_code: true,
        message,
        window_options: {
            backdrop: true,
            close_on_backdrop_click: false,
            ...window_options,
        },
    }) ) {
        return false;
    }
    // Saving refreshes window.user; a deployment that doesn't confirm at
    // signup leaves the new account unconfirmed, and it still has to confirm.
    if ( ! window.user.email_confirmed ) {
        return !! await UIWindowEmailConfirmationRequired({ window_options });
    }
    return true;
};

/**
 * Walks a temporary account through saving itself, and an unconfirmed one
 * through confirming its email, showing each window at most once. A call made
 * while the windows show settles with them, without opening its own.
 *
 * @param {string} message - What the save-account window says to a temporary account.
 * @param {Record<string, unknown>} [window_options] - Passed to both windows, such as
 *   `stay_on_top` to show them above an app.
 * @returns {Promise<boolean>} Whether the email is confirmed; false if the user backed out of either step.
 */
const ensureConfirmedEmail = (message, window_options = {}) => {
    showing ??= walkThrough(message, window_options).finally(() => {
        showing = null;
    });
    return showing;
};

export default ensureConfirmedEmail;
