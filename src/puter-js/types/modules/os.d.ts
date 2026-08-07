import type { RequestCallbacks } from '../shared.d.ts';
import type { User } from './auth.d.ts';

export class OS {
    user (options?: RequestCallbacks<User> & { query?: Record<string, string> }): Promise<User>;
    user (success: (value: User) => void, error?: (reason: unknown) => void): Promise<User>;
    version (options?: RequestCallbacks<Record<string, unknown>>): Promise<Record<string, unknown>>;
    version (success: (value: Record<string, unknown>) => void, error?: (reason: unknown) => void): Promise<Record<string, unknown>>;
}
