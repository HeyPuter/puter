import { ACLService } from './acl/ACLService';
import { AuthService } from './auth/AuthService';
import { TokenService } from './auth/TokenService';
import { FSEntryService } from './fs/FSEntryService';
import { MeteringService } from './metering/MeteringService';
import { PermissionService } from './permission/PermissionService';
import type { IPuterServiceRegistry } from './types';

// Ordering matters: services declared later see earlier ones as peers.
// ACLService depends on PermissionService (for scan + grant/revoke), so
// PermissionService must be constructed first.
// AuthService depends on TokenService (JWT verify).
// FSEntryService constructs its own internal repo + S3 provider in onServerStart.
export const puterServices = {
    metering: MeteringService,
    permission: PermissionService,
    acl: ACLService,
    token: TokenService,
    auth: AuthService,
    fsEntry: FSEntryService,
} satisfies IPuterServiceRegistry;
