import type { IPuterClientRegistry } from './clients/types';
import type { IPuterControllerRegistry } from './controllers/types';
import type { IPuterDriverRegistry } from './drivers/types';
import type { IPuterServiceRegistry } from './services/types';
import type { IPuterStoreRegistry } from './stores/types';
import type { IConfig, LayerInstances } from './types';

export const configContainer: IConfig = {} as IConfig;

export const clientsContainers: LayerInstances<IPuterClientRegistry> = {};
export const storesContainers: LayerInstances<IPuterStoreRegistry> = {};
export const servicesContainers: LayerInstances<IPuterServiceRegistry> = {};
export const controllersContainers: LayerInstances<IPuterControllerRegistry> =
    {};
export const driversContainers: LayerInstances<IPuterDriverRegistry> = {};
