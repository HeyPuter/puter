/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { AppController } from './apps/AppController.js';
import { AuthController } from './auth/AuthController.js';
import { BroadcastController } from './broadcast/BroadcastController.js';
import { DesktopController } from './desktop/DesktopController.js';
import { DriverController } from './drivers/DriverController.js';
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
import { PeerController } from './peer/PeerController.js';

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
    notification: NotificationController,
    share: ShareController,
    webdav: WebDAVController,
    oidc: OIDCController,
    wisp: WispController,
    peer: PeerController,
    // Last so its catch-all static fallback doesn't shadow earlier routes.
    homepage: HomepageController,
} satisfies IPuterControllerRegistry;
