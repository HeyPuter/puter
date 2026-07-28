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
import {
    deliversTokenToOpener,
    offersFederatedSignInInPopup,
    trustsOpenerOriginParam,
} from './popupAuth.js';

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

describe('offersFederatedSignInInPopup', () => {
    it('withholds the OIDC hop from a permission prompt', () => {
        // The provider returns the popup to a hard-coded `/action/sign-in`, so it
        // comes back believing it is a sign-in popup: it hands the opener a token
        // — the very thing `deliversTokenToOpener` refuses — and never shows the
        // permission the user was there to decide on.
        expect(offersFederatedSignInInPopup('request-permission')).toBe(false);
    });

    it('offers it in the popups that exist to sign the user in', () => {
        for ( const action of [undefined, 'sign-in', 'login', 'signup'] ) {
            expect(offersFederatedSignInInPopup(action)).toBe(true);
        }
    });
});

describe('trustsOpenerOriginParam', () => {
    it('disbelieves a link-supplied origin on an action-less popup', () => {
        // The reported hole. This was a denylist of `request-permission`, so
        // `undefined` — a popup with no action, which is also the one shape
        // that renders no consent UI — was trusted. Any site could then have a
        // token minted in another app's name with a single navigation.
        expect(trustsOpenerOriginParam(undefined)).toBe(false);
    });

    it('disbelieves it on a permission prompt', () => {
        // The opener's origin is the requester's identity there: it is the name
        // the dialog shows and the app the server writes the grant to. Taking it
        // from the link would let any site prompt in another app's name — the
        // same hole `app_uid` was removed from this URL to close.
        expect(trustsOpenerOriginParam('request-permission')).toBe(false);
    });

    it('disbelieves it on the file-picker actions', () => {
        for ( const action of [
            'show-open-file-picker',
            'show-directory-picker',
            'show-save-file-picker',
        ] ) {
            expect(trustsOpenerOriginParam(action)).toBe(false);
        }
    });

    it('believes it only on the actions an OIDC return leg produces', () => {
        // The parameter exists to survive that redirect, which drops the rest
        // of the query and comes back with the provider as the referrer.
        // `sign-in` is the success leg; the others are the error leg retrying
        // the flow it came from.
        for ( const action of ['sign-in', 'login', 'signup', 'revalidate'] ) {
            expect(trustsOpenerOriginParam(action)).toBe(true);
        }
    });

    it('disbelieves an unknown action', () => {
        expect(trustsOpenerOriginParam('something-new')).toBe(false);
    });
});
