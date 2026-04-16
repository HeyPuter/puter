import { AppController } from './apps/AppController.js';
import { AuthController } from './auth/AuthController.js';
import { BroadcastController } from './broadcast/BroadcastController';
import { DesktopController } from './desktop/DesktopController.js';
import { DriverController } from './drivers/DriverController';
import { EntriController } from './entri/EntriController';
import { FSController } from './fs/FSController';
import { HostingController } from './hosting/HostingController.js';
import { LegacyFSController } from './fs/LegacyFSController';
import { PuterAIController } from './puterai/PuterAIController';
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
    puterAi: PuterAIController,
    drivers: DriverController,
    broadcast: BroadcastController,
    entri: EntriController,
} satisfies IPuterControllerRegistry;
