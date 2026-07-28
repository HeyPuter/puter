/**
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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    stashOidcPopupHandoff,
    readOidcPopupHandoff,
    clearOidcPopupHandoff,
} from './popupOidcHandoff.js';

// The GUI suite runs in `node`, which has no sessionStorage. Stand one up —
// the point of these tests is the read/write contract, not the browser's
// implementation of it.
const makeStorage = () => {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        _map: map,
    };
};

beforeEach(() => {
    globalThis.sessionStorage = makeStorage();
});

afterEach(() => {
    delete globalThis.sessionStorage;
    vi.useRealTimers();
});

describe('stash/read round trip', () => {
    it('returns the origin the popup stashed before the OIDC hop', () => {
        stashOidcPopupHandoff({
            openerOrigin: 'https://opener.test',
            msgId: '7',
        });
        expect(readOidcPopupHandoff('7')).toMatchObject({
            opener_origin: 'https://opener.test',
        });
    });

    it('survives repeated reads', () => {
        // Consulted twice per boot — once for the opener's origin, again for
        // whether the account picker may be skipped — and a popup that reloads
        // mid-flow has no other way back to its opener.
        stashOidcPopupHandoff({
            openerOrigin: 'https://opener.test',
            msgId: '7',
        });
        expect(readOidcPopupHandoff('7')).toBeTruthy();
        expect(readOidcPopupHandoff('7')).toBeTruthy();
    });

    it('reads nothing when nothing was stashed', () => {
        // The attack shape: a crafted link asserting an opener this popup
        // never navigated away from. No other origin can write here.
        expect(readOidcPopupHandoff('7')).toBeNull();
    });

    it('ignores a stash with no origin', () => {
        stashOidcPopupHandoff({ openerOrigin: null, msgId: '7' });
        expect(readOidcPopupHandoff('7')).toBeNull();
    });
});

describe('scoping', () => {
    it('ignores a handoff left by a different popup flow in the same tab', () => {
        stashOidcPopupHandoff({
            openerOrigin: 'https://opener.test',
            msgId: '7',
        });
        expect(readOidcPopupHandoff('8')).toBeNull();
    });

    it('still matches when the msg_id differs only by type', () => {
        // `msg_id` is a number in the SDK and a string off the URL.
        stashOidcPopupHandoff({ openerOrigin: 'https://opener.test', msgId: 7 });
        expect(readOidcPopupHandoff('7')).toBeTruthy();
    });

    it('expires a stale handoff rather than applying it to a later popup', () => {
        vi.useFakeTimers();
        stashOidcPopupHandoff({
            openerOrigin: 'https://opener.test',
            msgId: '7',
        });
        vi.advanceTimersByTime(31 * 60 * 1000);
        expect(readOidcPopupHandoff('7')).toBeNull();
        // ...and it is dropped, not left to be re-evaluated every boot.
        expect(sessionStorage.getItem('puter.popup.oidc-handoff')).toBeNull();
    });
});

describe('robustness', () => {
    it('discards a corrupted entry instead of throwing', () => {
        sessionStorage.setItem('puter.popup.oidc-handoff', '{not json');
        expect(readOidcPopupHandoff('7')).toBeNull();
        expect(sessionStorage.getItem('puter.popup.oidc-handoff')).toBeNull();
    });

    it('degrades quietly when storage is unavailable', () => {
        // Some privacy modes throw on access. A popup that cannot stash falls
        // back to the ordinary attested sources and prompts once more; it must
        // not take the sign-in down with it.
        const boom = () => {
            throw new Error('storage disabled');
        };
        globalThis.sessionStorage = {
            getItem: boom,
            setItem: boom,
            removeItem: boom,
        };
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() =>
            stashOidcPopupHandoff({
                openerOrigin: 'https://opener.test',
                msgId: '7',
            }),
        ).not.toThrow();
        expect(readOidcPopupHandoff('7')).toBeNull();
        expect(() => clearOidcPopupHandoff()).not.toThrow();
    });
});
