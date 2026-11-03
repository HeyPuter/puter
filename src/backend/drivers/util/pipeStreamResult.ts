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
 *
 * `pipe` rather than `pipeline`: pipeline puts seven close listeners on the
 * response, and with the ones metering, compression and tracing add, every
 * streamed response tripped Node's ten-listener warning.
 */
export function pipeStreamResult(
    stream: Readable,
    res: ResponseSink,
    label: string,
): void {
    // The caller hung up while the driver ran: nothing will read the source.
    if (res.closed || res.destroyed) {
        stream.destroy();
        return;
    }
    stream.once('error', (err) => {
        stream.unpipe(res);
        if (!res.destroyed) res.destroy();
        console.warn(`[drivers] ${label} stream failed mid-response:`, err);
    });
    // A response that closes before the source ended is a client hanging up.
    res.once('close', () => {
        if (stream.readableEnded) return;
        stream.unpipe(res);
        stream.destroy();
    });
    res.once('error', () => stream.destroy());
    stream.pipe(res);
}
