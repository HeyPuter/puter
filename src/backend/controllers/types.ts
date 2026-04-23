import type { puterClients } from '../clients';
import type { PuterRouter } from '../core/http/PuterRouter';
import type { puterDrivers } from '../drivers';
import type { puterServices } from '../services';
import type { puterStores } from '../stores';
import type {
    IConfig,
    LayerInstances,
    WithControllerRegistration,
} from '../types';

export type IPuterController<
    T extends WithControllerRegistration = WithControllerRegistration,
> = new (
    config: IConfig,
    clients: LayerInstances<typeof puterClients>,
    stores: LayerInstances<typeof puterStores>,
    services: LayerInstances<typeof puterServices>,
    drivers: LayerInstances<typeof puterDrivers>,
) => T;

/**
 * Base class for v2 controllers. `registerRoutes(router)` receives a
 * `PuterRouter` (not an express app) — see `core/http/PuterRouter.ts`.
 * Controllers either override `registerRoutes` imperatively or lean on the
 * `@Controller` / `@Post` / etc. decorators, which install a default
 * `registerRoutes` walker on the prototype.
 */
export const PuterController =
    class PuterController implements WithControllerRegistration {
        constructor(
            protected config: IConfig,
            protected clients: LayerInstances<typeof puterClients>,
            protected stores: LayerInstances<typeof puterStores>,
            protected services: LayerInstances<typeof puterServices>,
            protected drivers: LayerInstances<typeof puterDrivers>,
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
        public registerRoutes(_router: PuterRouter) {}
    } satisfies IPuterController<WithControllerRegistration>;

export type IPuterControllerRegistry = Record<
    string,
    | IPuterController<WithControllerRegistration>
    | (InstanceType<IPuterController<WithControllerRegistration>> &
          Record<string, unknown>)
>;
