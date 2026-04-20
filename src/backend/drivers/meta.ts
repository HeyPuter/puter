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

    if (!interfaceName || !driverName) return null;

    return { interfaceName, driverName, isDefault };
}
