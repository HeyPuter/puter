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
    defersTokenToOpener,
    deliversTokenAtBoot,
    deliversTokenToOpener,
    offersFederatedSignInInPopup,
    relationshipIsConsent,
    relaysTokenAtBoot,
    resolveOpenerOrigin,
    runsUserAppTokenExchange,
} from './popupAuth.js';

const PICKER_ACTIONS = [
    'show-open-file-picker',
    'show-directory-picker',
    'show-save-file-picker',
];

describe('deliversTokenAtBoot', () => {
    it('withholds a picker\'s token until the picker has an answer', () => {
        for ( const action of PICKER_ACTIONS ) {
            // Still allowed to deliver — just not for merely having opened.
            expect(deliversTokenToOpener(action)).toBe(true);
            expect(defersTokenToOpener(action)).toBe(true);
            expect(deliversTokenAtBoot(action)).toBe(false);
        }
    });

    it('delivers at boot for the flows that exist to authenticate', () => {
        // `''` is an empty `?action=`, which the popup treats as no action.
        for ( const action of [undefined, '', 'sign-in', 'login', 'signup'] ) {
            expect(deliversTokenAtBoot(action)).toBe(true);
        }
    });

    it('keeps withholding the token from the popups that answer a question', () => {
        for ( const action of ['request-permission', 'send-feedback'] ) {
            expect(deliversTokenAtBoot(action)).toBe(false);
            expect(defersTokenToOpener(action)).toBe(false);
        }
    });
});

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
            'login',
            'signup',
            'show-open-file-picker',
            'show-directory-picker',
            'show-save-file-picker',
            'request-permission',
        ] ) {
            expect(runsUserAppTokenExchange(action)).toBe(true);
        }
    });
});

describe('any other popup action', () => {
    // These show no account picker, so a boot-time hand-off would sign the
    // opener in without asking.
    const OTHER_ACTIONS = [
        'foo',
        'authme',
        'copyauth',
        'change-username',
        'set-new-password',
        'password-recovery',
    ];

    it('hands the opener no token', () => {
        for ( const action of OTHER_ACTIONS ) {
            expect(deliversTokenToOpener(action)).toBe(false);
            expect(deliversTokenAtBoot(action)).toBe(false);
            expect(defersTokenToOpener(action)).toBe(false);
        }
    });

    it('skips the exchange, so opening one connects nothing', () => {
        for ( const action of OTHER_ACTIONS ) {
            expect(runsUserAppTokenExchange(action)).toBe(false);
        }
    });
});

describe('relationshipIsConsent', () => {
    // How initgui decides whether a boot-time hand-off goes ahead.
    const handsOverAtBoot = (action, { picked, hasRelationship, showedAccountPicker }) =>
        deliversTokenAtBoot(action) &&
        (picked || relationshipIsConsent({ hasRelationship, showedAccountPicker }));

    it('gives no token when the user dismissed the account picker', () => {
        const state = { picked: false, hasRelationship: true, showedAccountPicker: true };
        expect(relationshipIsConsent(state)).toBe(false);
        for ( const action of [undefined, 'sign-in'] ) {
            expect(handsOverAtBoot(action, state)).toBe(false);
        }
    });

    it('gives a token when the user picked an account', () => {
        for ( const hasRelationship of [true, false] ) {
            const state = { picked: true, hasRelationship, showedAccountPicker: true };
            expect(handsOverAtBoot('sign-in', state)).toBe(true);
        }
    });

    it('counts the relationship as consent when no picker was shown', () => {
        const state = { picked: false, hasRelationship: true, showedAccountPicker: false };
        expect(relationshipIsConsent(state)).toBe(true);
        expect(handsOverAtBoot('login', state)).toBe(true);
        expect(relationshipIsConsent({ ...state, hasRelationship: false })).toBe(false);
    });

    it('leaves the picker popups to answer with the pick', () => {
        const state = { picked: false, hasRelationship: true, showedAccountPicker: false };
        for ( const action of PICKER_ACTIONS ) {
            expect(handsOverAtBoot(action, state)).toBe(false);
            expect(defersTokenToOpener(action)).toBe(true);
            expect(runsUserAppTokenExchange(action)).toBe(true);
        }
    });
});

describe('relaysTokenAtBoot', () => {
    it('relays only for an isolated popup that hands over a token at boot', () => {
        expect(relaysTokenAtBoot('sign-in', true)).toBe(true);
        expect(relaysTokenAtBoot(undefined, true)).toBe(true);
        expect(relaysTokenAtBoot('sign-in', false)).toBe(false);
        expect(relaysTokenAtBoot('request-permission', true)).toBe(false);
        expect(relaysTokenAtBoot('show-open-file-picker', true)).toBe(false);
    });
});

describe('resolveOpenerOrigin', () => {
    const OPENER = 'https://opener.example';
    const OTHER_APP = 'https://other-app.example';
    // What a page running puter.js answers the handshake with: its own origin,
    // whichever app the opener window has navigated to by then.
    const answeredBy = (origin) => async () => origin;

    it('never asks the opener when the token goes to the relay', async () => {
        let asked = false;
        const origin = await resolveOpenerOrigin({
            relaysToken: true,
            oidcOpenerOrigin: undefined,
            referrer: '',
            askOpener: async () => {
                asked = true;
                return OTHER_APP;
            },
        });
        expect(asked).toBe(false);
        expect(origin).toBe('');
    });

    it('uses the referrer for a relay popup', async () => {
        const origin = await resolveOpenerOrigin({
            relaysToken: true,
            oidcOpenerOrigin: undefined,
            referrer: OPENER,
            askOpener: answeredBy(OTHER_APP),
        });
        expect(origin).toBe(OPENER);
    });

    it('ignores an OIDC proof for a relay popup', async () => {
        // The proof's origin may itself have come from the handshake.
        const origin = await resolveOpenerOrigin({
            relaysToken: true,
            oidcOpenerOrigin: OTHER_APP,
            referrer: OPENER,
            askOpener: answeredBy(OTHER_APP),
        });
        expect(origin).toBe(OPENER);
    });

    it('prefers the OIDC proof, then the referrer, then the handshake otherwise', async () => {
        const base = { relaysToken: false, askOpener: answeredBy(OTHER_APP) };
        expect(await resolveOpenerOrigin({ ...base, oidcOpenerOrigin: OPENER, referrer: 'https://idp.example' }))
            .toBe(OPENER);
        expect(await resolveOpenerOrigin({ ...base, oidcOpenerOrigin: null, referrer: OPENER }))
            .toBe(OPENER);
        expect(await resolveOpenerOrigin({ ...base, oidcOpenerOrigin: null, referrer: '' }))
            .toBe(OTHER_APP);
    });

    it('surfaces a failed handshake', async () => {
        await expect(resolveOpenerOrigin({
            relaysToken: false,
            oidcOpenerOrigin: null,
            referrer: '',
            askOpener: async () => {
                throw new Error('No window.opener available');
            },
        })).rejects.toThrow('No window.opener available');
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
