import { EventClient } from './EventClient';
import type { IPuterClientRegistry } from './types';

export const puterClients = {
    event: EventClient,
} satisfies IPuterClientRegistry;