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

const APIError = require("../../../api/APIError");
const { Sequence } = require("../../../codex/Sequence");
const config = require("../../../config");

const validator = require('validator');
const { get_user } = require("../../../helpers");

/*
    This code is optimized for editors supporting folding.
    Fold at Level 2 to conveniently browse sequence steps.
    Fold at Level 3 after opening an inner-sequence.
    
    If you're using VSCode {
        typically "Ctrl+K, Ctrl+2" or "⌘K, ⌘2";
        to revert "Ctrl+K, Ctrl+J" or "⌘K, ⌘J";
        https://stackoverflow.com/questions/30067767
    }
*/

module.exports = new Sequence({
    name: 'process recipients',
    after_each (a) {
        const { recipients_work } = a.values();
        recipients_work.clear_invalid();
    }
}, [
    function valid_username_or_email (a) {
        const { result, recipients_work } = a.values();
        for ( const item of recipients_work.list() ) {
            const { value, i } = item;
            
            if ( typeof value !== 'string' ) {
                item.invalid = true;
                result.recipients[i] =
                    APIError.create('invalid_username_or_email', null, {
                        value,
                    });
                continue;
            }

            if ( value.match(config.username_regex) ) {
                item.type = 'username';
                continue;
            }
            if ( validator.isEmail(value) ) {
                item.type = 'email';
                continue;
            }
            
            item.invalid = true;
            result.recipients[i] =
                APIError.create('invalid_username_or_email', null, {
                    value,
                });
        }
    },
    async function check_existing_users_for_email_shares (a) {
        const { recipients_work } = a.values();
        for ( const recipient_item of recipients_work.list() ) {
            if ( recipient_item.type !== 'email' ) continue;
            const user = await get_user({
                email: recipient_item.value,
            });
            if ( ! user ) continue;
            recipient_item.type = 'username';
            recipient_item.value = user.username;
        }
    },
    async function check_username_specified_users_exist (a) {
        const { result, recipients_work } = a.values();
        for ( const item of recipients_work.list() ) {
            if ( item.type !== 'username' ) continue;

            const user = await get_user({ username: item.value });
            if ( ! user ) {
                item.invalid = true;
                result.recipients[item.i] =
                    APIError.create('user_does_not_exist', null, {
                        username: item.value,
                    });
                continue;
            }
            item.user = user;
        }
    },
    function return_state (a) { return a; }
]);
