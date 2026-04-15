import type { IPuterDriverRegistry } from './types';
import { ChatCompletionDriver } from './ai-chat/ChatCompletionDriver';
import { AppDriver } from './apps/AppDriver.js';
import { KVStoreDriver } from './kv/KVStoreDriver';

export { DriverRegistry, resolveDriverMeta } from './DriverRegistry';
export { Driver } from './decorators';

export const puterDrivers = {
    kvStore: KVStoreDriver,
    aiChat: ChatCompletionDriver,
    apps: AppDriver,
} satisfies IPuterDriverRegistry;