import { ACLService } from './acl/ACLService';
import { AppPermissionService } from './apps/AppPermissionService';
import { RecommendedAppsService } from './apps/RecommendedAppsService';
import { SuggestedAppsService } from './apps/SuggestedAppsService';
import { AuthService } from './auth/AuthService';
import { BroadcastService } from './broadcast/BroadcastService';
import { NotificationService } from './notification/NotificationService';
import { AppIconService } from './appIcon/AppIconService';
import { DefaultUserService } from './selfhosted/DefaultUserService';
import { PuterHomepageService } from './homepage/PuterHomepageService';
import { OIDCService } from './auth/OIDCService';
import { TokenService } from './auth/TokenService';
import { FSService } from './fs/FSService';
import { MeteringService } from './metering/MeteringService';
import { PermissionService } from './permission/PermissionService';
import { ServerHealthService } from './health/ServerHealthService';
import { SocketService } from './socket/SocketService';
import { SubdomainPermissionService } from './subdomain/SubdomainPermissionService';
import type { IPuterServiceRegistry } from './types';

// Ordering matters: services declared later see earlier ones as peers.
// ACLService depends on PermissionService (for scan + grant/revoke), so
// PermissionService must be constructed first.
// AuthService depends on TokenService (JWT verify).
// FSService constructs its own internal repo + S3 provider in onServerStart.
// SocketService depends on AuthService (for handshake auth).
// NotificationService depends on notification store (for DB) + event client (for socket push).
// BroadcastService is independent — only needs the event client.
export const puterServices = {
    metering: MeteringService,
    permission: PermissionService,
    acl: ACLService,
    token: TokenService,
    auth: AuthService,
    fs: FSService,
    // AppPermissionService + SubdomainPermissionService register permission
    // rewriters/implicators only; no runtime state. Placed after fsEntry so
    // the FS rewriter runs first for `fs:/path` → `fs:<uuid>` before any
    // downstream check that might chain app-root-dir → fs.
    appPermission: AppPermissionService,
    subdomainPermission: SubdomainPermissionService,
    recommendedApps: RecommendedAppsService,
    suggestedApps: SuggestedAppsService,
    socket: SocketService,
    notification: NotificationService,
    broadcast: BroadcastService,
    oidc: OIDCService,
    appIcon: AppIconService,
    defaultUser: DefaultUserService,
    homepage: PuterHomepageService,
    // Health comes after socket so its default `socket-initialized`
    // check can reference the peer.
    health: ServerHealthService,
} satisfies IPuterServiceRegistry;
