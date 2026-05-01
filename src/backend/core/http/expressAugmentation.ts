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

import type { Actor } from '../actor';

/**
 * Global Express.Request augmentation for v2.
 *
 * Every field declared here is populated by *global* middleware installed by
 * `PuterServer` (auth probe, body parser, etc.). Per-route fields stay local
 * to their handlers via `TypedRequest<O>` instead.
 *
 * This module is import-only — it has no runtime exports. Files that consume
 * the augmented `Request` should `import './expressAugmentation'` (or any
 * file that imports it transitively) so TypeScript loads the declaration.
 */

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            /**
             * Populated by the global auth probe when a valid token is
             * attached to the request (Bearer header, auth_token body/query,
             * session cookie, or socket handshake). Absent for anonymous
             * requests — route-level gates decide whether to reject.
             */
            actor?: Actor;

            /** The raw token string, if one was presented and parsed. */
            token?: string;

            /**
             * Set by the global auth probe when a token was extracted from
             * the request but failed to resolve to an actor (bad signature,
             * expired, references a deleted session/user/app, or has a
             * legacy shape v2 can't authenticate). Lets `requireAuthGate`
             * distinguish "no token" from "token present but invalid" and
             * emit the legacy `token_auth_failed` error so old clients
             * trigger their re-login flow.
             */
            tokenAuthFailed?: boolean;

            /**
             * Raw request body bytes, captured by the global JSON parser's
             * `verify` callback. Available for any JSON request — needed by
             * webhook handlers that verify an HMAC over the exact bytes the
             * sender signed (e.g., AppStore prod webhooks, BroadcastService
             * inter-instance hooks).
             *
             * Set only when the global JSON parser actually ran (request had
             * `Content-Type: application/json` or one of the recognized
             * JSON-as-text variants). For non-JSON requests it stays
             * `undefined`.
             */
            rawBody?: Buffer;

            /** Parsed user-agent, populated by the global UA-parsing middleware. */
            ua?: {
                browser: { name?: string; version?: string; major?: string };
                os: { name?: string; version?: string };
                device: { vendor?: string; model?: string; type?: string };
            };

            /** True when the request's Host is a custom domain (not one of the configured Puter domains). */
            is_custom_domain?: boolean;
        }
    }
}

export {};
