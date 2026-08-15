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
import * as popupAuth from './popupAuth.js';
import {
    deliversTokenToOpener,
    offersFederatedSignInInPopup,
    runsUserAppTokenExchange,
} from './popupAuth.js';

describe('deliversTokenToOpener', () => {
    it('withholds the token from a permission prompt', () => {
        // Answering a permission prompt is not consent to hand the site this
        // user's credentials. Every popup path that mints a user-app token has
        // to honour this, not just the plain token exchange.
        expect(deliversTokenToOpener('request-permission')).toBe(false);
    });

    it('withholds the token from a feedback popup', () => {
        // Sending feedback is not consent to sign the site in either.
        expect(deliversTokenToOpener('send-feedback')).toBe(false);
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

describe('runsUserAppTokenExchange', () => {
    it('skips the exchange entirely for a feedback popup', () => {
        // The exchange is a write, not a read: it bootstraps an app row for
        // the opener origin and records the user↔site relationship. The
        // feedback flow resolves app identity read-only from the attested
        // origin server-side, so opening (or cancelling) the dialog must not
        // connect the site to the account.
        expect(runsUserAppTokenExchange('send-feedback')).toBe(false);
    });

    it('runs it for sign-in, the pickers, and the permission prompt', () => {
        // request-permission keeps the exchange: the app row it bootstraps is
        // what a grant is written against.
        for ( const action of [
            undefined,
            'sign-in',
            'show-open-file-picker',
            'show-directory-picker',
            'show-save-file-picker',
            'request-permission',
        ] ) {
            expect(runsUserAppTokenExchange(action)).toBe(true);
        }
    });
});

describe('the retired opener_origin gate', () => {
    it('is gone, because no action believes the raw parameter now', () => {
        // It used to allow `opener_origin` for every action but
        // `request-permission`. Being a denylist it fell open on `undefined` —
        // a popup with no action, which is also the one shape that renders no
        // consent UI — so any site could have a token minted in another app's
        // name with a single navigation. The OIDC round trip the parameter
        // existed for now redeems a signed proof instead; see
        // util/popupOidcReturn.js.
        expect(popupAuth.trustsOpenerOriginParam).toBeUndefined();
    });
});
