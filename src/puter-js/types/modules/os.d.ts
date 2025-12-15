import type { RequestCallbacks } from '../shared.d.ts';
import type { User } from './auth.d.ts';

export class OS {
    user (options?: RequestCallbacks<User> & { query?: Record<string, string> }): Promise<User>;
    version (options?: RequestCallbacks<Record<string, unknown>>): Promise<Record<string, unknown>>;
}
