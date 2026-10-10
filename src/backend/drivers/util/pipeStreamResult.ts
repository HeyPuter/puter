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

import { pipeline, type Readable } from 'node:stream';
import type { ServerResponse } from 'node:http';

/**
 * Pipes a driver's stream result to the HTTP response. A source that fails
 * mid-body destroys the response, so the client sees an aborted transfer rather
 * than a clean end, and the failure is logged once instead of surfacing as an
 * unhandled stream error. A client that hangs up stops the source.
 */
export function pipeStreamResult(
    stream: Readable,
    res: ServerResponse,
    label: string,
): void {
    pipeline(stream, res, (err) => {
        if (!err) return;
        if (!res.destroyed) res.destroy();
        // The client hanging up is not a failure of ours.
        if ((err as { code?: string }).code === 'ERR_STREAM_PREMATURE_CLOSE')
            return;
        console.warn(`[drivers] ${label} stream failed mid-response:`, err);
    });
}
