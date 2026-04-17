import { ACLService } from './acl/ACLService';
import { RecommendedAppsService } from './apps/RecommendedAppsService';
import { SuggestedAppsService } from './apps/SuggestedAppsService';
import { AuthService } from './auth/AuthService';
import { BroadcastService } from './broadcast/BroadcastService';
import { NotificationService } from './notification/NotificationService';
import { AppIconService } from './appIcon/AppIconService';
import { DefaultUserService } from './selfhosted/DefaultUserService';
import { OIDCService } from './auth/OIDCService';
import { TokenService } from './auth/TokenService';
import { FSEntryService } from './fs/FSEntryService';
import { MeteringService } from './metering/MeteringService';
import { PermissionService } from './permission/PermissionService';
import { SocketService } from './socket/SocketService';
import type { IPuterServiceRegistry } from './types';

// Ordering matters: services declared later see earlier ones as peers.
// ACLService depends on PermissionService (for scan + grant/revoke), so
// PermissionService must be constructed first.
// AuthService depends on TokenService (JWT verify).
// FSEntryService constructs its own internal repo + S3 provider in onServerStart.
// SocketService depends on AuthService (for handshake auth).
// NotificationService depends on notification store (for DB) + event client (for socket push).
// BroadcastService is independent — only needs the event client.
export const puterServices = {
    metering: MeteringService,
    permission: PermissionService,
    acl: ACLService,
    token: TokenService,
    auth: AuthService,
    fsEntry: FSEntryService,
    recommendedApps: RecommendedAppsService,
    suggestedApps: SuggestedAppsService,
    socket: SocketService,
    notification: NotificationService,
    broadcast: BroadcastService,
    oidc: OIDCService,
    appIcon: AppIconService,
    defaultUser: DefaultUserService,
} satisfies IPuterServiceRegistry;
