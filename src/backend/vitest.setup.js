// Vitest setup file - runs before all test files
// Initializes globalThis.kv which is required by PermissionService and other services

import { kv } from './src/util/kvSingleton';
globalThis.kv = kv;
