import type { Puter } from '../types/puter.d.ts';

export declare function init(authToken?: string): Puter;
export declare function getAuthToken(guiOrigin?: string): Promise<string>;
