import { FSController } from './fs/FSController';
import type { IPuterControllerRegistry } from './types';

export const puterControllers = {
    fs: FSController,
} satisfies IPuterControllerRegistry;