import { AppController } from './apps/AppController.js';
import { AuthController } from './auth/AuthController.js';
import { BroadcastController } from './broadcast/BroadcastController.js';
import { DesktopController } from './desktop/DesktopController.js';
import { DriverController } from './drivers/DriverController.js';
import { EntriController } from './entri/EntriController.js';
import { FSController } from './fs/FSController.js';
import { HomepageController } from './homepage/HomepageController.js';
import { HostingController } from './hosting/HostingController.js';
import { LegacyFSController } from './fs/LegacyFSController.js';
import { NotificationController } from './notification/NotificationController.js';
import { OIDCController } from './oidc/OIDCController.js';
import { PuterAIController } from './puterai/PuterAIController.js';
import { ShareController } from './share/ShareController.js';
import { StaticAssetsController } from './static/StaticAssetsController.js';
import { StaticPagesController } from './static/StaticPagesController.js';
import { SystemController } from './system/SystemController.js';
import { WebDAVController } from './webdav/WebDAVController.js';
import { WispController } from './wisp/WispController.js';
import type { IPuterControllerRegistry } from './types.js';

export const puterControllers = {
    staticAssets: StaticAssetsController,
    staticPages: StaticPagesController,
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
    wisp: WispController,
    // Last so its catch-all static fallback doesn't shadow earlier routes.
    homepage: HomepageController,
} satisfies IPuterControllerRegistry;
