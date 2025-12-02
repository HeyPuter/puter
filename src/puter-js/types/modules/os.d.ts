import type { RequestCallbacks } from '../shared.d.ts';
import type { AuthUser } from './auth.d.ts';

export class OS {
    constructor (context: { authToken?: string; APIOrigin: string; appID?: string });

    setAuthToken (authToken: string): void;
    setAPIOrigin (APIOrigin: string): void;

    user (options?: RequestCallbacks<AuthUser> & { query?: Record<string, string> }): Promise<AuthUser>;
    version (options?: RequestCallbacks<Record<string, unknown>>): Promise<Record<string, unknown>>;
}
