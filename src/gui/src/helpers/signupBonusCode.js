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
 * Signup bonus codes arrive as `?bonusCode=` on a signup link. The GUI only
 * carries the code; the backend decides what, if anything, it grants.
 */

export const BONUS_CODE_PARAM = 'bonusCode';

// Loose on purpose: the backend owns the canonical form. This only keeps
// arbitrary text out of requests and the page.
const BONUS_CODE_SHAPE = /^[A-Za-z0-9_-]{4,128}$/;

/** The bonus code a URL's query carries, or null. */
export function readSignupBonusCode(params) {
    const raw = params?.get?.(BONUS_CODE_PARAM);
    return typeof raw === 'string' && BONUS_CODE_SHAPE.test(raw) ? raw : null;
}

/**
 * Ask the backend what a code grants. Resolves `{ valid: true, display,
 * requirements }`, `{ valid: false }`, or null when the answer is unknown
 * (offline, rate limited) — callers keep the code then and let signup decide.
 */
export async function checkSignupBonusCode(
    code,
    { origin, fingerprint, fetchImpl = fetch } = {},
) {
    try {
        const res = await fetchImpl(`${origin}/signup/bonus-code/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                bonusCode: code,
                ...(fingerprint ? { fingerprint } : {}),
            }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data?.valid === true && data.display) return data;
        return { valid: false };
    } catch {
        return null;
    }
}

/** I18n key describing the verification a code requires, or null. */
export function bonusRequirementsKey(requirements) {
    const phone = requirements?.phone === true;
    const card = requirements?.card === true;
    if (phone && card) return 'signup_bonus_requires_phone_and_card';
    if (card) return 'signup_bonus_requires_card';
    if (phone) return 'signup_bonus_requires_phone';
    return null;
}
