import { AuthController } from './auth/AuthController.js';
import { FSController } from './fs/FSController';
import { LegacyFSController } from './fs/LegacyFSController';
import type { IPuterControllerRegistry } from './types';

export const puterControllers = {
    auth: AuthController,
    fs: FSController,
    legacyFs: LegacyFSController,
} satisfies IPuterControllerRegistry;
