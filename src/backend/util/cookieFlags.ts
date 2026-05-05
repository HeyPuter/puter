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

import type { IConfig } from '../types';

/**
 * `sameSite: 'none'` requires `secure: true`, and a `secure` cookie is
 * silently dropped by browsers over plain HTTP. Self-host without TLS
 * (`protocol: http`) needs the matched `secure: false` + `sameSite:
 * 'lax'` pair, otherwise the cookie never lands and every authenticated
 * request 401s.
 *
 * Pass `crossSite: true` for cookies that need to be sent on cross-site
 * navigation (the default — matches the original prod-on-HTTPS behavior
 * which used `sameSite: 'none'`). Pass `crossSite: false` for
 * same-site-only cookies (e.g. revalidation flow that never crosses
 * origins) — those can stay `lax` even on HTTPS.
 */
export function sessionCookieFlags(
    config: IConfig,
    opts: { crossSite?: boolean } = {},
): { sameSite: 'none' | 'lax'; secure: boolean } {
    const isHttps = config.protocol === 'https';
    const crossSite = opts.crossSite ?? true;
    return {
        sameSite: isHttps && crossSite ? 'none' : 'lax',
        secure: isHttps,
    };
}
