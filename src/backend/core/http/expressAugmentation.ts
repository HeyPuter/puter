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
            actor?: Actor;

            /** The raw token string, if one was presented and parsed. */
            token?: string;

            tokenAuthFailed?: boolean;

            /**
             * Set when a token authenticated but its app is on the origin
             * blocklist. The auth probe leaves `actor` unset; gates translate
             * this into a 403 `app_blocked`.
             */
            appBlocked?: { reason?: string };

            requiresReauth?: {
                reason: 'token_v1' | 'session_revoked' | 'session_expired';
                auth_id?: string;
                /**
                 * Short-lived server-signed JWT that proves the bearer was
                 * identified as `auth_id` by the rejected session. The GUI
                 * must echo this back (not the raw `auth_id`) on the next
                 * login/signup so the controller can rebind to the same user.
                 */
                reauth_token?: string;
            };

            rawBody?: Buffer;

            /** Parsed user-agent, populated by the global UA-parsing middleware. */
            ua?: {
                browser: { name?: string; version?: string; major?: string };
                os: { name?: string; version?: string };
                device: { vendor?: string; model?: string; type?: string };
            };

            /** True when the request's Host is a custom domain (not one of the configured Puter domains). */
            is_custom_domain?: boolean;

            /**
             * Coarse server-derived request fingerprint (IP + UA + accept
             * headers), populated by the global fingerprint middleware. Always
             * present; the same value the rate limiter keys on.
             */
            networkFingerprint?: string;

            /**
             * Client-supplied device fingerprint (ThumbmarkJS hash) from the
             * body or `x-puter-device-fingerprint` header, populated by the
             * global fingerprint middleware. Present only when the client sent a
             * well-shaped value; spoofable but stable per device across IPs.
             */
            deviceFingerprint?: string;

            /** Parsed cookies, populated by the global `cookie-parser` middleware. */
            cookies?: Record<string, string>;
        }
    }
}

export {};
