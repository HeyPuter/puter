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
 * Campaign attribution a signup arrives with, as `utm_*` params. Core only
 * shapes and forwards the values; what is done with them is up to listeners on
 * `puter.signup.success`.
 */

export const SIGNUP_UTM_KEYS = [
    'source',
    'medium',
    'campaign',
    'term',
    'content',
] as const;

export type SignupUtmKey = (typeof SIGNUP_UTM_KEYS)[number];

/** The `utm_*` values a signup carried, keyed without the prefix. */
export type SignupUtm = Partial<Record<SignupUtmKey, string>>;

/** Caps each value, which also bounds the OIDC state token that carries them. */
export const SIGNUP_UTM_MAX_LENGTH = 255;

const shapeValue = (raw: unknown): string | null => {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed && trimmed.length <= SIGNUP_UTM_MAX_LENGTH ? trimmed : null;
};

/**
 * A `SignupUtm` holding only the known keys with usable string values, or null
 * when none are left.
 */
export function normalizeSignupUtm(raw: unknown): SignupUtm | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const src = raw as Record<string, unknown>;
    const utm: SignupUtm = {};
    for (const key of SIGNUP_UTM_KEYS) {
        const value = shapeValue(src[key]);
        if (value) utm[key] = value;
    }
    return Object.keys(utm).length > 0 ? utm : null;
}

/** The `utm_*` params in a request body or query, or null when there are none. */
export function readSignupUtm(params: unknown): SignupUtm | null {
    if (!params || typeof params !== 'object') return null;
    const src = params as Record<string, unknown>;
    return normalizeSignupUtm(
        Object.fromEntries(SIGNUP_UTM_KEYS.map((k) => [k, src[`utm_${k}`]])),
    );
}
