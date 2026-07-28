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

/**
 * Carrying a sign-in popup's state across the OIDC round trip.
 *
 * A popup that hands control to an identity provider comes back having lost
 * `document.referrer` — the referrer on the returning navigation is the
 * provider, not the site that opened the popup. Two things have to survive
 * that hop:
 *
 *   - **who the opener is**, because it names the app the token is minted for
 *   - **that a real OIDC login just completed**, which is what lets the popup
 *     skip the account picker on the way back
 *
 * Both were previously carried as plain query parameters (`opener_origin`,
 * `oidc_login`) on the return URL. A URL is written by whoever builds the
 * link, so a third-party site could state both itself and be believed: name
 * another app as the opener, assert the login already happened, and the popup
 * would mint that app's token with no prompt.
 *
 * `sessionStorage` carries them instead. It is partitioned by origin, so only
 * a document already running on the Puter GUI origin can write here — no
 * other site can, whatever it puts in a link. It is also scoped to the tab,
 * and the OIDC hop keeps the popup in the same tab, so the value written
 * before navigating to the provider is still there when the provider sends
 * the popup back.
 *
 * This is browser-attested in the same sense `document.referrer` is: the
 * value is not a claim the page makes about itself, it is one the browser
 * would not have let an attacker place.
 */

const HANDOFF_KEY = 'puter.popup.oidc-handoff';

/**
 * How long a stashed handoff stays usable. An OIDC round trip is interactive
 * — a provider's consent screen, maybe an MFA prompt — so this is generous,
 * but it should not outlive the flow it belongs to and be picked up by an
 * unrelated popup later in the same tab.
 */
const HANDOFF_TTL_MS = 30 * 60 * 1000;

/**
 * Record the popup's browser-attested state before navigating to the identity
 * provider. Called at the moment of the hop, when `openerOrigin` is still
 * known from the referrer or the `requestOrigin` handshake.
 *
 * Storage failures are non-fatal: a popup that cannot stash falls back to the
 * ordinary attested sources on return and, at worst, prompts the user once
 * more. Losing the account picker is a better outcome than trusting a URL.
 *
 * @param {object} params
 * @param {string|null|undefined} params.openerOrigin - The opener's origin as
 *   currently attested.
 * @param {string|null|undefined} params.msgId - The popup's `msg_id`, used to
 *   tell this flow's handoff from a stale one.
 */
export const stashOidcPopupHandoff = ({ openerOrigin, msgId }) => {
    if (!openerOrigin) return;
    try {
        sessionStorage.setItem(
            HANDOFF_KEY,
            JSON.stringify({
                opener_origin: openerOrigin,
                msg_id: msgId ?? null,
                at: Date.now(),
            }),
        );
    } catch (e) {
        // Storage disabled or full. See above — this degrades, it doesn't break.
        console.error('could not stash OIDC popup handoff', e);
    }
};

/**
 * Read back the handoff stashed before the OIDC hop, if this popup is the one
 * that stashed it and it is still fresh.
 *
 * Deliberately non-destructive: the value is consulted more than once per boot
 * (for the opener's origin, and again for whether the account picker may be
 * skipped), and a popup that reloads mid-flow would otherwise be left with the
 * provider as its referrer and no way to recover the opener.
 *
 * @param {string|null|undefined} msgId - The current popup's `msg_id`. A
 *   handoff stashed under a different one belongs to another flow.
 * @returns {{opener_origin: string, msg_id: string|null}|null}
 */
export const readOidcPopupHandoff = (msgId) => {
    let raw;
    try {
        raw = sessionStorage.getItem(HANDOFF_KEY);
    } catch (e) {
        console.error('could not read OIDC popup handoff', e);
        return null;
    }
    if (!raw) return null;

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        clearOidcPopupHandoff();
        return null;
    }

    if (!parsed?.opener_origin) return null;
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > HANDOFF_TTL_MS) {
        clearOidcPopupHandoff();
        return null;
    }
    // A popup carries its `msg_id` through the round trip, so a mismatch means
    // this handoff was left by a different flow in the same tab.
    if (parsed.msg_id != null && msgId != null && String(parsed.msg_id) !== String(msgId)) {
        return null;
    }

    return { opener_origin: parsed.opener_origin, msg_id: parsed.msg_id ?? null };
};

/** Drop the stashed handoff. */
export const clearOidcPopupHandoff = () => {
    try {
        sessionStorage.removeItem(HANDOFF_KEY);
    } catch {
        // Nothing to do — a handoff we can't remove still expires with the tab.
    }
};
