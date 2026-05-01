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

import type { Readable } from 'node:stream';
import type { WithLifecycle } from '../types';

// ── Stream result convention ────────────────────────────────────────
//
// Driver methods that return a stream instead of JSON wrap the readable
// in this shape. The `/drivers/call` handler detects it and pipes to the
// HTTP response instead of calling `res.json()`.

export interface DriverStreamResult {
    /** Discriminant — must be `'stream'`. */
    dataType: 'stream';
    /** MIME type sent as Content-Type (e.g. `'application/x-ndjson'`). */
    content_type: string;
    /** When true, sets `Transfer-Encoding: chunked`. */
    chunked?: boolean;
    /** The readable stream to pipe to the response. */
    stream: Readable;
}

export function isDriverStreamResult(v: unknown): v is DriverStreamResult {
    return (
        !!v &&
        typeof v === 'object' &&
        (v as Record<string, unknown>).dataType === 'stream' &&
        'stream' in v
    );
}

// ── Driver metadata keys ────────────────────────────────────────────
//
// Metadata keys stored on driver prototypes by the `@Driver` decorator.
// Imperative drivers set these as instance properties instead.

export const DRIVER_INTERFACE_KEY = '__driverInterface' as const;
export const DRIVER_NAME_KEY = '__driverName' as const;
export const DRIVER_DEFAULT_KEY = '__driverDefault' as const;
export const DRIVER_ALIASES_KEY = '__driverAliases' as const;

/**
 * Resolved metadata for a registered driver. Read from either decorator
 * metadata or imperative instance properties.
 */
export interface DriverMeta {
    /** The interface this driver implements (e.g. 'puter-chat-completion'). */
    interfaceName: string;
    /** Unique name within its interface (e.g. 'openai-completion', 'claude'). */
    driverName: string;
    /** When true, this driver is the default for its interface. */
    isDefault: boolean;
    /**
     * Additional driver names that resolve to the same instance. Used by
     * multi-provider drivers (TTS/OCR/image/video) so legacy puter-js calls
     * that pass a provider id in the `driver` slot (e.g. `aws-polly`,
     * `openai-tts`) still find the unified driver. The requested alias is
     * exposed to the driver method via `Context.get('driverName')` so the
     * method can route to the right internal provider.
     */
    aliases: string[];
}

/**
 * Extract driver metadata from a driver instance. Checks decorator-set
 * prototype metadata first, then falls back to instance properties.
 * Returns `null` if the driver doesn't declare an interface.
 */
export function resolveDriverMeta(
    driver: WithLifecycle & Record<string, unknown>,
): DriverMeta | null {
    const proto = Object.getPrototypeOf(driver) as Record<string, unknown>;

    const interfaceName =
        (proto[DRIVER_INTERFACE_KEY] as string | undefined) ??
        (driver.driverInterface as string | undefined);
    const driverName =
        (proto[DRIVER_NAME_KEY] as string | undefined) ??
        (driver.driverName as string | undefined);
    const isDefault =
        (proto[DRIVER_DEFAULT_KEY] as boolean | undefined) ??
        (driver.isDefault as boolean | undefined) ??
        false;
    const aliases =
        (proto[DRIVER_ALIASES_KEY] as string[] | undefined) ??
        (driver.driverAliases as string[] | undefined) ??
        [];

    if (!interfaceName || !driverName) return null;

    return { interfaceName, driverName, isDefault, aliases };
}
