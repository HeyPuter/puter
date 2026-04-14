import { FSController } from './fs/FSController';
import { LegacyFSController } from './fs/LegacyFSController';
import type { IPuterControllerRegistry } from './types';

export const puterControllers = {
    fs: FSController,
    legacyFs: LegacyFSController,
} satisfies IPuterControllerRegistry;