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

import type { Response } from 'express';

// Content types a browser will execute as a *document* (running embedded
// scripts) when loaded top-level — even when the type is declared honestly.
// An uploaded SVG with a `<script>` runs when navigated to directly; HTML
// obviously does. Served inline on an api/file origin, that's stored XSS.
const ACTIVE_DOCUMENT_CONTENT_TYPE =
    /^(text\/html|image\/svg\+xml|application\/xhtml\+xml|application\/xml|text\/xml)\b/i;

/**
 * For file-serving endpoints that echo an uploader-controlled content type
 * inline: when the type is one a browser executes as a document, apply the
 * same sandbox CSP used for app icons so embedded scripts can't run with
 * the serving origin. No-op for inert types (images, audio, octet-stream),
 * so `<img>`/download/range consumers are unaffected.
 *
 * Returns true if the sandbox header was applied (useful for tests/logging).
 */
export function applyInlineContentSecurity(
    res: Response,
    contentType: string | null | undefined,
): boolean {
    if (contentType && ACTIVE_DOCUMENT_CONTENT_TYPE.test(contentType)) {
        res.setHeader(
            'Content-Security-Policy',
            "default-src 'none'; sandbox;",
        );
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return true;
    }
    return false;
}
