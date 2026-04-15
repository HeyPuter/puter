import { DRIVER_DEFAULT_KEY, DRIVER_INTERFACE_KEY, DRIVER_NAME_KEY } from './meta';

/**
 * Options for the `@Driver` class decorator.
 */
export interface DriverOptions {
    /** Unique name for this implementation within its interface. Defaults to the class name. */
    name?: string;
    /** When true, this driver is the default for its interface. */
    default?: boolean;
}

/**
 * Class decorator that marks a driver implementation and records its
 * interface + name on the prototype.
 *
 * Equivalent imperative approach (no decorator needed):
 * ```ts
 * class MyDriver extends PuterDriver {
 *     readonly driverInterface = 'puter-chat-completion';
 *     readonly driverName = 'my-impl';
 *     readonly isDefault = true;
 * }
 * ```
 *
 * Usage:
 * ```ts
 * @Driver('puter-chat-completion', { name: 'openai-completion', default: true })
 * class OpenAIChatDriver extends PuterDriver {
 *     async complete(args) { ... }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCtor = new (...args: any[]) => any;

export function Driver (interfaceName: string, opts: DriverOptions = {}) {
    return <T extends AnyCtor>(value: T, _context: ClassDecoratorContext<T>): void => {
        const proto = value.prototype as Record<string, unknown>;
        proto[DRIVER_INTERFACE_KEY] = interfaceName;
        proto[DRIVER_NAME_KEY] = opts.name ?? value.name;
        proto[DRIVER_DEFAULT_KEY] = opts.default ?? false;
    };
}
