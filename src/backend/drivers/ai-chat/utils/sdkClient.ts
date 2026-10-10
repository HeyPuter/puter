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

/**
 * How long an upstream gets to start answering. A non-streaming completion only
 * answers once it's done, so this bounds the whole generation.
 */
export const SDK_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Options every chat SDK client is built with. A failed attempt goes straight
 * back to the driver, which marks the route and falls back to the next provider
 * serving the model; an SDK retry would first repeat it on the same route, up
 * to twice and each up to the full timeout.
 */
export const sdkClientOptions = (timeoutMs = SDK_TIMEOUT_MS) => ({
    maxRetries: 0,
    timeout: timeoutMs,
});

/**
 * `signal` bounded by the SDK timeout, for an SDK with no timeout of its own
 * once a caller's signal is passed (Mistral's). It bounds the whole response,
 * so it's for non-streaming calls only.
 */
export const withSdkTimeout = (
    signal: AbortSignal | undefined,
    timeoutMs = SDK_TIMEOUT_MS,
): AbortSignal => {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
};
