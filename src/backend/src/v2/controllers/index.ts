import { AppController } from './apps/AppController.js';
import { AuthController } from './auth/AuthController.js';
import { DesktopController } from './desktop/DesktopController.js';
import { FSController } from './fs/FSController';
import { HostingController } from './hosting/HostingController.js';
import { LegacyFSController } from './fs/LegacyFSController';
import { SystemController } from './system/SystemController.js';
import type { IPuterControllerRegistry } from './types';

export const puterControllers = {
    auth: AuthController,
    apps: AppController,
    desktop: DesktopController,
    hosting: HostingController,
    system: SystemController,
    fs: FSController,
    legacyFs: LegacyFSController,
} satisfies IPuterControllerRegistry;
