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

import type { Readable } from 'node:stream';

// Only what's used here, so callers on another @types/node (or express's
// Response) still fit.
type ResponseSink = NodeJS.WritableStream & {
    readonly closed: boolean;
    readonly destroyed: boolean;
    destroy(error?: Error): unknown;
};

/**
 * Pipes a driver's stream result to the HTTP response. A source that fails
 * mid-body destroys the response, so the client sees an aborted transfer rather
 * than a clean end, and the failure is logged once instead of surfacing as an
 * unhandled stream error. A client that hangs up stops the source.
 */
export function pipeStreamResult(
    stream: Readable,
    res: ResponseSink,
    label: string,
): void {
    // The caller hung up while the driver ran, so drop the source instead.
    if (res.closed || res.destroyed) {
        stream.destroy();
        return;
    }
    // `pipe`, not `pipeline`: pipeline adds ~6 'close' listeners to the
    // response, which with the middleware's own trips Node's
    // MaxListenersExceededWarning on every streamed driver call.
    let failed = false;
    stream.on('error', (err) => {
        if (!res.destroyed) res.destroy();
        if (failed) return;
        failed = true;
        console.warn(`[drivers] ${label} stream failed mid-response:`, err);
    });
    // `pipe` unpipes when the response finishes or closes; a source that
    // hasn't ended by then lost its reader.
    res.once('unpipe', () => {
        if (!stream.readableEnded) stream.destroy();
    });
    stream.pipe(res);
}
