import type { IPuterDriverRegistry } from './types';
import { KVStoreDriver } from './kv/KVStoreDriver';

export { DriverRegistry, resolveDriverMeta } from './DriverRegistry';
export { Driver } from './decorators';

export const puterDrivers = {
    kvStore: KVStoreDriver,
} satisfies IPuterDriverRegistry;