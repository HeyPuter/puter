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

import { describe, it, expect } from 'vitest';
import { deliversTokenToOpener } from './popupAuth.js';

describe('deliversTokenToOpener', () => {
    it('withholds the token from a permission prompt', () => {
        // Answering a permission prompt is not consent to hand the site this
        // user's credentials. Every popup path that mints a user-app token has
        // to honour this, not just the plain token exchange.
        expect(deliversTokenToOpener('request-permission')).toBe(false);
    });

    it('delivers the token for the sign-in flows that exist to authenticate', () => {
        // `undefined` is a plain sign-in popup, which carries no action.
        for ( const action of [undefined, 'sign-in'] ) {
            expect(deliversTokenToOpener(action)).toBe(true);
        }
    });

    it('delivers the token for the other popup actions', () => {
        for ( const action of [
            'show-open-file-picker',
            'show-directory-picker',
            'show-save-file-picker',
            'login',
            'signup',
        ] ) {
            expect(deliversTokenToOpener(action)).toBe(true);
        }
    });
});
