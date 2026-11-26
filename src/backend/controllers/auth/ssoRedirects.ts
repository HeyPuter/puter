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

// Where an identity-provider sign-in may return to, and where a failed one
// lands. Shared by every SSO entry point so they agree on both.

import { validate as validateUuid } from 'uuid';
import { parseMaskedSharePath } from '../../services/fs/sharePathMask.js';
import {
    SHARE_DEEP_LINK_ITEMS_LIMIT,
    SHARE_DEEP_LINK_PARAM,
    SHARE_RECIPIENT_PARAM,
} from '../../services/share/shareDeepLink.js';

const OIDC_ERROR_REDIRECT_MAP: Record<string, Record<string, string>> = {
    login: { account_not_found: 'signup', other: 'login' },
    signup: { account_already_exists: 'login', other: 'signup' },
};

// The `message` query param is clamped to these codes — the GUI maps them to
// display text. Free-text errors (which may describe internals or, for vetoed
// signups, the block reason) never reach the redirect URL.
const ALLOWED_ERRORS = [
    'account_suspended',
    'unauthorized',
    'signup_blocked',
    'signin_blocked',
    'bonus_code_invalid',
] as const;

/**
 * Pick the display code for a failed user resolution.
 *
 * A `code` is only ever set when the signup-validate harness vetoed the signup,
 * but the code it stamps comes from an abuse listener and is not drawn from
 * {@link ALLOWED_ERRORS} — so clamping it directly turns every vetoed OIDC
 * signup into a bare `unauthorized`, which reads as "sign-in broke" and hides
 * both the real cause and the Request Code that support looks the decision up
 * by. Anything unrecognized falls back to the veto's own category instead.
 */
export function resolutionErrorCode(code: string | undefined): string {
    if (!code) return 'unauthorized';
    return (ALLOWED_ERRORS as readonly string[]).includes(code)
        ? code
        : 'signup_blocked';
}

// GUI pages an OIDC flow may return to: the root (where a share email lands),
// /dashboard, and direct app landings (/app/<name>, mirroring
// APP_NAME_REGEX in AppDriver). Strict whitelist — never a client-supplied URL
// (no open redirect).
function isWhitelistedReturnPath(path: string): boolean {
    return (
        path === '/' ||
        path === '/dashboard' ||
        /^\/app\/[a-zA-Z0-9_-]{1,100}$/.test(path)
    );
}

/**
 * The share items a return target's query names, or null when the query is
 * anything else at all.
 *
 * A share email lands on `/?shared=…`, and its recipient usually has to sign in
 * before they can see what was shared. An OIDC flow leaves the origin and comes
 * back to a URL this server builds, so the parameter travels through the flow
 * or the recipient returns to a bare Home with nothing to say what they were
 * sent.
 *
 * Only `shared` makes the trip, with values shaped like the masked path the
 * mail was built from — the value is user-visible text, so a hand-edited one is
 * refused rather than reflected back into the browser. The mail's one recipient
 * hint (`user_uuid`) rides along when it is a single uuid.
 */
function sharedReturnQuery(query: string): {
    paths: string[];
    recipientUuid?: string;
} | null {
    const paths: string[] = [];
    let recipientUuid: string | undefined;
    for (const [key, value] of new URLSearchParams(query)) {
        if (key === SHARE_RECIPIENT_PARAM) {
            if (recipientUuid || !validateUuid(value)) return null;
            recipientUuid = value;
            continue;
        }
        if (key !== SHARE_DEEP_LINK_PARAM) return null;
        const parsed = parseMaskedSharePath(value);
        // The segment after the uuid is the shared item itself. A mask without
        // one addresses the owner's parent directory, which is not the
        // recipient's to open.
        if (!parsed || !parsed.tail) return null;
        // Same rule the link builder follows: the first items are the ones
        // that travel, so what gets highlighted reads as the top of the list.
        if (
            paths.length < SHARE_DEEP_LINK_ITEMS_LIMIT &&
            !paths.includes(value)
        ) {
            paths.push(value);
        }
    }
    return { paths, recipientUuid };
}

/**
 * A client-supplied `return_to` reduced to what will actually be redirected to,
 * or null when it isn't a page an OIDC flow returns to.
 *
 * The path is matched as given, never parsed as a URL: a protocol-relative
 * value (`//evil.test/desktop`) has to fail the whitelist rather than smuggle
 * an origin through as a `pathname`. The query is rebuilt from the values that
 * survived, so nothing reaches the redirect verbatim.
 */
export function sanitizeReturnTo(raw: string): string | null {
    const separator = raw.indexOf('?');
    const path = separator === -1 ? raw : raw.slice(0, separator);
    if (!isWhitelistedReturnPath(path)) return null;

    const shared =
        separator === -1
            ? { paths: [] }
            : sharedReturnQuery(raw.slice(separator + 1));
    if (shared === null) return null;
    // The root is only a destination when it names something: on its own it is
    // where the flow already lands.
    if (shared.paths.length === 0) return path === '/' ? null : path;

    const params = new URLSearchParams();
    for (const value of shared.paths)
        params.append(SHARE_DEEP_LINK_PARAM, value);
    if (shared.recipientUuid) {
        params.set(SHARE_RECIPIENT_PARAM, shared.recipientUuid);
    }
    return `${path}?${params.toString()}`;
}

export function buildErrorRedirectUrl(
    origin: string,
    sourceFlow: string,
    errorCondition: string,
    message: string,
    stateDecoded?: Record<string, unknown>,
    requestCode?: string,
    // Omitted by callers with no state to attest.
    mintPopupReturn?: (payload: Record<string, unknown>) => string,
): string {
    const targetFlow =
        OIDC_ERROR_REDIRECT_MAP[sourceFlow]?.[errorCondition] ?? sourceFlow;
    const base = origin.replace(/\/$/, '') || '/';
    const clamped = (ALLOWED_ERRORS as readonly string[]).includes(message)
        ? message
        : 'unauthorized';

    // Land back on the whitelisted page the flow started from (e.g. an
    // /app/<name> landing) so the retry — and the eventual success — keeps
    // the user's destination. redirect_uri comes from the signed state and
    // was built server-side, but re-check the path against the whitelist.
    // A share link's items come back too: the retry happens on that page, and
    // its success reloads it, so they have to be on it to survive.
    let pagePath = '/';
    let sharedPaths: string[] = [];
    let shareRecipientUuid: string | undefined;
    if (typeof stateDecoded?.redirect_uri === 'string') {
        try {
            const stateUrl = new URL(stateDecoded.redirect_uri);
            if (isWhitelistedReturnPath(stateUrl.pathname)) {
                pagePath = stateUrl.pathname;
                const shared = sharedReturnQuery(stateUrl.search);
                sharedPaths = shared?.paths ?? [];
                shareRecipientUuid = shared?.recipientUuid;
            }
        } catch {
            // unparsable redirect_uri: fall back to the root page
        }
    }

    let params: URLSearchParams;
    if (stateDecoded?.embedded_in_popup && stateDecoded?.msg_id != null) {
        params = new URLSearchParams({
            embedded_in_popup: 'true',
            msg_id: String(stateDecoded.msg_id),
            auth_error: '1',
            message: clamped,
            action: targetFlow,
        });
        if (stateDecoded?.opener_origin) {
            params.set('opener_origin', String(stateDecoded.opener_origin));
        }
        // Same reasoning as the success leg: the popup cannot tell a verified
        // `opener_origin` from a typed one, so attest it. The error leg is a
        // real return from the provider too — the flow failed, not the hop.
        if (mintPopupReturn) {
            params.set(
                'opener_state',
                mintPopupReturn({
                    opener_origin: stateDecoded?.opener_origin ?? null,
                    msg_id: stateDecoded?.msg_id ?? null,
                    oidc_login: false,
                    // The popup checks this against the action it lands on.
                    action: targetFlow,
                }),
            );
        }
    } else {
        params = new URLSearchParams({
            action: targetFlow,
            auth_error: '1',
            message: clamped,
        });
    }
    if (requestCode) {
        params.set('request_code', requestCode);
    }
    // A retry from the error page keeps the bonus code, unless it's what failed.
    if (
        typeof stateDecoded?.bonus_code === 'string' &&
        clamped !== 'bonus_code_invalid'
    ) {
        params.set('bonusCode', stateDecoded.bonus_code);
    }
    for (const path of sharedPaths) {
        params.append(SHARE_DEEP_LINK_PARAM, path);
    }
    if (shareRecipientUuid) {
        params.set(SHARE_RECIPIENT_PARAM, shareRecipientUuid);
    }
    return `${base}${pagePath}?${params.toString()}`;
}
