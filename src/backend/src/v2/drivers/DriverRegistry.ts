import type { WithLifecycle } from '../types';

/**
 * Metadata keys stored on driver prototypes by the `@Driver` decorator.
 * Imperative drivers set these as instance properties instead.
 */
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
export function resolveDriverMeta (driver: WithLifecycle & Record<string, unknown>): DriverMeta | null {
    const proto = Object.getPrototypeOf(driver) as Record<string, unknown>;

    const interfaceName =
        (proto[DRIVER_INTERFACE_KEY] as string | undefined)
        ?? (driver.driverInterface as string | undefined);
    const driverName =
        (proto[DRIVER_NAME_KEY] as string | undefined)
        ?? (driver.driverName as string | undefined);
    const isDefault =
        (proto[DRIVER_DEFAULT_KEY] as boolean | undefined)
        ?? (driver.isDefault as boolean | undefined)
        ?? false;

    if ( ! interfaceName || ! driverName ) return null;

    return { interfaceName, driverName, isDefault };
}

// ── Driver method type ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DriverMethod = (args: any, context?: DriverCallContext) => Promise<unknown>;

export interface DriverCallContext {
    actor?: unknown;
    test_mode?: boolean;
}

// ── Registry ────────────────────────────────────────────────────────

/**
 * Central registry for driver implementations. Maps interface names to
 * named implementations.
 *
 * Populated by `PuterServer` during boot from both the built-in driver
 * registry and extension-registered drivers. Consumed by `DriverController`
 * to resolve `/drivers/call` requests.
 */
export class DriverRegistry {
    /** iface → Map<driverName, driverInstance> */
    #drivers = new Map<string, Map<string, WithLifecycle & Record<string, unknown>>>();
    /** iface → default driver name */
    #defaults = new Map<string, string>();

    register (meta: DriverMeta, instance: WithLifecycle & Record<string, unknown>): void {
        let ifaceMap = this.#drivers.get(meta.interfaceName);
        if ( ! ifaceMap ) {
            ifaceMap = new Map();
            this.#drivers.set(meta.interfaceName, ifaceMap);
        }
        if ( ifaceMap.has(meta.driverName) ) {
            console.warn(`[driver-registry] overwriting driver ${meta.interfaceName}:${meta.driverName}`);
        }
        ifaceMap.set(meta.driverName, instance);

        if ( meta.isDefault || ! this.#defaults.has(meta.interfaceName) ) {
            this.#defaults.set(meta.interfaceName, meta.driverName);
        }
    }

    /**
     * Resolve a driver by interface + optional name. If name is omitted,
     * returns the default driver for that interface.
     */
    resolve (interfaceName: string, driverName?: string): (WithLifecycle & Record<string, unknown>) | null {
        const ifaceMap = this.#drivers.get(interfaceName);
        if ( ! ifaceMap ) return null;

        const name = driverName ?? this.#defaults.get(interfaceName);
        if ( ! name ) return null;

        return ifaceMap.get(name) ?? null;
    }

    /** List all registered interface names. */
    listInterfaces (): string[] {
        return [...this.#drivers.keys()];
    }

    /** List all driver names registered for a given interface. */
    listDrivers (interfaceName: string): string[] {
        const ifaceMap = this.#drivers.get(interfaceName);
        return ifaceMap ? [...ifaceMap.keys()] : [];
    }

    /** Get the default driver name for an interface. */
    getDefault (interfaceName: string): string | undefined {
        return this.#defaults.get(interfaceName);
    }
}
