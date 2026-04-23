import type { puterClients } from '../clients';
import type { puterServices } from '../services';
import type { puterStores } from '../stores';
import type { IConfig, LayerInstances, WithCostsReporting } from '../types';

export type IPuterDriver<T extends WithCostsReporting = WithCostsReporting> =
    new (
        config: IConfig,
        clients: LayerInstances<typeof puterClients>,
        stores: LayerInstances<typeof puterStores>,
        services: LayerInstances<typeof puterServices>,
    ) => T;

/**
 * Base class for v2 drivers.
 *
 * A driver implements a named interface (e.g., `puter-chat-completion`) and
 * exposes methods that match the interface contract. Multiple drivers can
 * implement the same interface (e.g., `openai-completion` and `claude` both
 * implement `puter-chat-completion`).
 *
 * **Two ways to declare a driver:**
 *
 * 1. Decorator:
 *    ```ts
 *    @Driver('puter-chat-completion', { name: 'openai', default: true })
 *    class OpenAIChat extends PuterDriver { ... }
 *    ```
 *
 * 2. Imperative (no decorator):
 *    ```ts
 *    class OpenAIChat extends PuterDriver {
 *        readonly driverInterface = 'puter-chat-completion';
 *        readonly driverName = 'openai';
 *        readonly isDefault = true;
 *    }
 *    ```
 */
export const PuterDriver = class PuterDriver implements WithCostsReporting {
    /** The interface this driver implements. Set by `@Driver` or override. */
    declare readonly driverInterface?: string;
    /** Unique name within its interface. Set by `@Driver` or override. */
    declare readonly driverName?: string;
    /** When true, this is the default driver for its interface. */
    declare readonly isDefault?: boolean;

    constructor(
        protected config: IConfig,
        protected clients: LayerInstances<typeof puterClients>,
        protected stores: LayerInstances<typeof puterStores>,
        protected services: LayerInstances<typeof puterServices>,
    ) {}
    public onServerStart() {
        return;
    }
    public onServerPrepareShutdown() {
        return;
    }
    public onServerShutdown() {
        return;
    }
    public getReportedCosts(): Record<string, unknown>[] {
        return [];
    }
} satisfies IPuterDriver<WithCostsReporting>;

export type IPuterDriverRegistry = Record<
    string,
    | IPuterDriver<WithCostsReporting>
    | (InstanceType<IPuterDriver<WithCostsReporting>> & Record<string, unknown>)
>;
