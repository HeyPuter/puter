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

/**
 * Walks a temporary account through saving itself, and an unconfirmed one
 * through confirming its email, before it publishes.
 *
 * @param {boolean} required - Whether this deployment needs a verified email
 *   for this kind of publish; when false, resolves true straight away.
 * @returns {Promise<boolean>} False if the user backed out of either step.
 */
const ensure_can_publish = async function (required) {
    if ( ! required ) return true;
    if ( window.user.is_temp ) {
        return !! await UIWindowSaveAccount({
            send_confirmation_code: true,
            message: i18n('save_account_to_publish'),
            window_options: {
                backdrop: true,
                close_on_backdrop_click: false,
            },
        });
    }
    if ( ! window.user.email_confirmed ) {
        return !! await UIWindowEmailConfirmationRequired();
    }
    return true;
};

export default ensure_can_publish;
