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

/**
 * Redeeming a sign-in popup's OIDC return proof.
 *
 * A popup that hands control to an identity provider comes back needing two
 * facts it cannot establish for itself: who its opener is, and that a login
 * really did just complete. `document.referrer` on that navigation is the
 * provider, so neither is recoverable locally.
 *
 * Both facts do survive the round trip — they travel inside the `state` the
 * backend signs and verifies (`OIDCService.signState`/`verifyState`). The
 * problem was the last hop: the backend used to flatten them into plain
 * `opener_origin` and `oidc_login` query parameters. A URL produced by a
 * verified state is byte-identical to one an attacker types, so the popup had
 * no way to tell them apart — and the opener's origin is what picks the app a
 * token gets minted for.
 *
 * The return leg now carries `opener_state`, the same pair re-signed. Only the
 * server can produce or check that signature, so the popup redeems it here.
 * A missing, forged, or expired proof yields nothing and the popup falls back
 * to its browser-attested sources.
 */

/**
 * Redeem an `opener_state` proof for the facts the server attested.
 *
 * @param {string|null|undefined} proof - The `opener_state` query parameter.
 * @param {string|null|undefined} msgId - The popup's current `msg_id`. A proof
 *   minted for a different one belongs to another flow.
 * @returns {Promise<{opener_origin: string|null, oidc_login: boolean}|null>}
 *   `null` when there is no usable proof.
 */
export const verifyOidcPopupReturn = async (proof, msgId) => {
    if (!proof) return null;

    let attested;
    try {
        const resp = await fetch(
            `${window.api_origin}/auth/oidc/verify-popup-return`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ opener_state: proof }),
            },
        );
        // A rejected proof is the expected answer to a crafted link, not an
        // anomaly — the popup carries on with its attested sources.
        if (!resp.ok) return null;
        attested = await resp.json();
    } catch (e) {
        // The popup can still sign in via referrer/handshake, so a failure to
        // reach the server here must not take it down.
        console.error('could not verify the OIDC popup return proof', e);
        return null;
    }

    if (!attested?.opener_origin) return null;
    // The popup carries its `msg_id` through the round trip, so a mismatch
    // means this proof was minted for a different flow. Compared as strings:
    // the SDK generates a number, the URL yields text.
    if (
        attested.msg_id != null &&
        msgId != null &&
        String(attested.msg_id) !== String(msgId)
    ) {
        return null;
    }

    return {
        opener_origin: attested.opener_origin,
        oidc_login: attested.oidc_login === true,
    };
};
