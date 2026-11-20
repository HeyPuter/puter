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

/** Only what's used here, so test doubles and express's Response both fit. */
interface ClosingResponse {
    once(event: 'close', listener: () => void): unknown;
}

const callbacksByResponse = new WeakMap<ClosingResponse, Array<() => void>>();

/**
 * Runs `callback` once when the response closes. Every callback on a response
 * shares one `close` listener, since Node warns past ten and request tracing
 * adds its own. Callbacks run in the order added; one that throws doesn't stop
 * the rest.
 */
export const onResponseClose = (
    res: ClosingResponse,
    callback: () => void,
): void => {
    const callbacks = callbacksByResponse.get(res);
    if (callbacks) {
        callbacks.push(callback);
        return;
    }
    const pending = [callback];
    callbacksByResponse.set(res, pending);
    res.once('close', () => {
        for (const run of pending.splice(0)) {
            try {
                run();
            } catch (e) {
                // Surfaces as an uncaught error, as it would from a listener
                // of its own.
                queueMicrotask(() => {
                    throw e;
                });
            }
        }
    });
};
