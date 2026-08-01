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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { verifyOidcPopupReturn } from './popupOidcReturn.js';

const OPENER = 'https://opener.test';

/** Stand in for the verify endpoint. */
const serverSays = (body, { ok = true } = {}) =>
    vi.fn(async () => ({ ok, json: async () => body }));

beforeEach(() => {
    globalThis.window = { api_origin: 'https://api.test' };
});

afterEach(() => {
    delete globalThis.window;
    delete globalThis.fetch;
    vi.restoreAllMocks();
});

describe('redeeming a proof', () => {
    it('returns the origin the server attested', async () => {
        globalThis.fetch = serverSays({
            opener_origin: OPENER,
            msg_id: '7',
            oidc_login: true,
        });
        await expect(verifyOidcPopupReturn('signed.blob.here', '7')).resolves.toEqual(
            { opener_origin: OPENER, oidc_login: true },
        );
    });

    it('sends the proof to the verify endpoint', async () => {
        const fetchMock = serverSays({ opener_origin: OPENER, oidc_login: true });
        globalThis.fetch = fetchMock;
        await verifyOidcPopupReturn('signed.blob.here', null);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.test/auth/oidc/verify-popup-return');
        expect(JSON.parse(init.body)).toEqual({
            opener_state: 'signed.blob.here',
        });
    });

    it('carries oidc_login=false through rather than defaulting it true', async () => {
        // The error leg is a real return too, but no login completed on it —
        // so it must not suppress the account picker.
        globalThis.fetch = serverSays({
            opener_origin: OPENER,
            oidc_login: false,
        });
        await expect(
            verifyOidcPopupReturn('signed.blob.here', null),
        ).resolves.toEqual({ opener_origin: OPENER, oidc_login: false });
    });
});

describe('refusing what the server did not attest', () => {
    it('yields nothing when there is no proof at all', async () => {
        // The attack shape: a crafted link naming an opener, with no OIDC round
        // trip behind it. Nothing is even asked of the server.
        globalThis.fetch = serverSays({ opener_origin: OPENER });
        await expect(verifyOidcPopupReturn(null, '7')).resolves.toBeNull();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('yields nothing when the server rejects the proof', async () => {
        // Forged or expired: the endpoint answers 400.
        globalThis.fetch = serverSays(
            { message: 'Invalid `opener_state`' },
            { ok: false },
        );
        await expect(
            verifyOidcPopupReturn('forged.blob', '7'),
        ).resolves.toBeNull();
    });

    it('yields nothing when the attested payload carries no origin', async () => {
        globalThis.fetch = serverSays({ opener_origin: null, oidc_login: true });
        await expect(
            verifyOidcPopupReturn('signed.blob.here', '7'),
        ).resolves.toBeNull();
    });

    it('ignores a proof minted for a different popup flow', async () => {
        globalThis.fetch = serverSays({
            opener_origin: OPENER,
            msg_id: '7',
            oidc_login: true,
        });
        await expect(
            verifyOidcPopupReturn('signed.blob.here', '8'),
        ).resolves.toBeNull();
    });

    it('still matches when msg_id differs only by type', async () => {
        // The SDK generates a number; the URL yields text.
        globalThis.fetch = serverSays({
            opener_origin: OPENER,
            msg_id: 7,
            oidc_login: true,
        });
        await expect(
            verifyOidcPopupReturn('signed.blob.here', '7'),
        ).resolves.toBeTruthy();
    });

    it('degrades to nothing when the endpoint is unreachable', async () => {
        // The popup can still sign in from referrer/handshake, so a network
        // failure must not take it down.
        globalThis.fetch = vi.fn(async () => {
            throw new Error('network down');
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(
            verifyOidcPopupReturn('signed.blob.here', '7'),
        ).resolves.toBeNull();
    });
});
