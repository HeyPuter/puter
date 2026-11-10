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

import { jwtPayload } from './jwtPayload.js';

const UUID_HEX = /^[0-9a-f]{32}$/;

/** @param {unknown} uuid */
const uuidHex = (uuid) => {
    if ( typeof uuid !== 'string' ) return null;
    const hex = uuid.replace(/-/g, '').toLowerCase();
    return UUID_HEX.test(hex) ? hex : null;
};

/**
 * The uuid of the user a session token was issued to. The token carries it as
 * the `uu` claim: the uuid's 16 bytes in base64, or the dashed uuid itself.
 *
 * @param {string} token
 * @returns {string | null} dashless lowercase hex, or null when the token doesn't say
 */
const tokenUserHex = (token) => {
    const claim = jwtPayload(token)?.uu;
    if ( typeof claim !== 'string' || !claim ) return null;
    if ( claim.includes('-') ) return uuidHex(claim);
    try {
        const bytes = atob(claim);
        let hex = '';
        for ( let i = 0; i < bytes.length; i++ ) {
            hex += bytes.charCodeAt(i).toString(16).padStart(2, '0');
        }
        return UUID_HEX.test(hex) ? hex : null;
    } catch {
        return null;
    }
};

/**
 * Whether a session token was issued to a user other than `user`. False when
 * either side can't be read, so an unreadable token is never taken for a switch.
 *
 * @param {string} token
 * @param {{ uuid?: string } | null | undefined} user
 * @returns {boolean}
 */
export const isTokenForAnotherUser = (token, user) => {
    const tokenUser = tokenUserHex(token);
    const currentUser = uuidHex(user?.uuid);
    return !!tokenUser && !!currentUser && tokenUser !== currentUser;
};
