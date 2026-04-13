import { MeteringService } from './metering/MeteringService';
import { PermissionService } from './permission/PermissionService';
import type { IPuterServiceRegistry } from './types';

// Ordering matters: services declared later see earlier ones as peers.
export const puterServices = {
    metering: MeteringService,
    permission: PermissionService,
} satisfies IPuterServiceRegistry;
