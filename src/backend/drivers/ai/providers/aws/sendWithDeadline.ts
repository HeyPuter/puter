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

import { withTimeout } from '../../../../util/concurrency.js';

/**
 * Runs one AWS SDK call under a deadline that ends when `send` settles: the
 * whole reply, or the headers of a streamed one. At the deadline it rejects
 * with a `TimeoutError` and aborts the request through the signal, which every
 * SDK HTTP handler honors; their own timeout options differ per handler.
 */
export async function sendWithDeadline<T>(
    timeoutMs: number,
    send: (abortSignal: AbortSignal) => Promise<T>,
): Promise<T> {
    const deadline = new AbortController();
    try {
        return await withTimeout(
            Promise.resolve().then(() => send(deadline.signal)),
            timeoutMs,
        );
    } catch (e) {
        // Only on failure: aborting after the headers would cut a stream. No
        // reason given, since the SDK retries an abort caused by a timeout.
        deadline.abort();
        throw e;
    }
}
