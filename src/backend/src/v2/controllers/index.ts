import { AppController } from './apps/AppController.js';
import { AuthController } from './auth/AuthController.js';
import { BroadcastController } from './broadcast/BroadcastController';
import { DesktopController } from './desktop/DesktopController.js';
import { DriverController } from './drivers/DriverController';
import { EntriController } from './entri/EntriController';
import { FSController } from './fs/FSController';
import { HostingController } from './hosting/HostingController.js';
import { LegacyFSController } from './fs/LegacyFSController';
import { NotificationController } from './notification/NotificationController';
import { OIDCController } from './oidc/OIDCController';
import { PuterAIController } from './puterai/PuterAIController';
import { ShareController } from './share/ShareController';
import { SystemController } from './system/SystemController.js';
import { WebDAVController } from './webdav/WebDAVController';
import type { IPuterControllerRegistry } from './types';

export const puterControllers = {
    auth: AuthController,
    apps: AppController,
    desktop: DesktopController,
    hosting: HostingController,
    system: SystemController,
    fs: FSController,
    legacyFs: LegacyFSController,
    puterAi: PuterAIController,
    drivers: DriverController,
    broadcast: BroadcastController,
    entri: EntriController,
    notification: NotificationController,
    share: ShareController,
    webdav: WebDAVController,
    oidc: OIDCController,
} satisfies IPuterControllerRegistry;
