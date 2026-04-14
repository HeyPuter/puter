import { DriverController } from './drivers/DriverController';
import { FSController } from './fs/FSController';
import { LegacyFSController } from './fs/LegacyFSController';
import type { IPuterControllerRegistry } from './types';

export const puterControllers = {
    drivers: DriverController,
    fs: FSController,
    legacyFs: LegacyFSController,
} satisfies IPuterControllerRegistry;