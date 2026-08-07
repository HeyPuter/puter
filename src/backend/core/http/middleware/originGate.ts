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

import type { RequestHandler } from 'express';
import { HttpError } from '../HttpError';
import type { IConfig } from '../../../types';

/**
 * Normalize an origin for comparison: trimmed, no trailing slash, lowercased.
 * Browsers send none of those variations, but config values do — a hand-edited
 * `origin` with a trailing slash would otherwise reject every real request.
 */
const normalizeOrigin = (raw: string | undefined): string =>
    (raw ?? '').trim().replace(/\/+$/, '').toLowerCase();

/**
 * Restrict a route to pages served from this deployment's own GUI origin.
 *
 * The routes this guards hand a usable credential straight back to the caller:
 * `/login` and `/signup` return a full session token in the response body, and
 * `/session/sync-cookie` installs the session cookie. CORS on this deployment
 * reflects whatever `Origin` the caller sends — puter.js is meant to be
 * consumed from arbitrary third-party sites — so _without_ this gate any page
 * on any origin can POST a username and password and read the resulting session
 * token out of the response.
 *
 * That matters for two reasons:
 *
 * 1. It turns a phished password into full account takeover through a documented,
 *    CORS-blessed API path, rather than forcing an attacker onto traffic we can
 *    see and rate-limit differently.
 * 2. It sidesteps the containment third-party sign-in is supposed to have.
 *    `puter.auth.signIn()` runs its popup on _this_ origin — the user types
 *    their password with our URL bar visible — and the app receives an
 *    app-scoped `app-under-user` token, never a session token.
 *
 * Requests with **no** `Origin` header pass. Non-browser callers (CLI, mobile
 * apps, server-side integrations, tests) legitimately send none, and they gain
 * nothing here: whether a _page_ may read the response is what CORS governs,
 * and a caller already scripting raw HTTP has no origin to be lied about. This
 * gate exists to stop cross-origin pages, not non-browser clients.
 *
 * `'null'` fails the check like any other non-matching value, which is what we
 * want — sandboxed iframes and `file://` documents serialize their opaque
 * origin that way, and two _unrelated_ opaque origins compare equal to each
 * other.
 *
 * Deployments that genuinely serve their GUI from an origin other than
 * `config.origin` can list it in `config.allow_gui_origins`. Do not put
 * loopback origins on a production allowlist: `http://localhost:4000` is not an
 * authenticatable origin, it's whatever happens to be listening on that port on
 * the visitor's own machine. The AuthMe flow (`/?action=authme&redirectURL=…`)
 * is how a local GUI is meant to obtain a token — the password is only ever
 * typed on this origin.
 */
export const guiOriginGate = (config: IConfig): RequestHandler => {
    const allowed = new Set(
        [config.origin, ...(config.allow_gui_origins ?? [])]
            .map(normalizeOrigin)
            .filter((o) => o.length > 0),
    );

    // `index.ts` computes `origin` from protocol/domain/port when it is
    // *undefined*, but an explicit `"origin": null` in a config file slips past
    // that check. The gate then has nothing to allow and every browser sign-in
    // 403s — correct (fail closed) but baffling from the outside, so say so
    // once at boot rather than leaving it to be discovered as "login broke".
    if (allowed.size === 0) {
        console.warn(
            '[auth] `config.origin` is not set: every cross-origin-gated ' +
                'route (/login, /signup, /session/sync-cookie) will reject ' +
                'browser requests. Set `origin`, or list the GUI origin in ' +
                '`allow_gui_origins`.',
        );
    }

    return (req, _res, next) => {
        const origin = req.headers.origin;
        // No `Origin` at all — not a browser page. Nothing to gate.
        if (origin === undefined) {
            next();
            return;
        }
        if (allowed.has(normalizeOrigin(origin))) {
            next();
            return;
        }
        next(
            new HttpError(403, 'This endpoint cannot be called cross-origin.', {
                legacyCode: 'forbidden',
            }),
        );
    };
};
