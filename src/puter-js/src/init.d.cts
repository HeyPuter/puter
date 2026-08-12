import type { Puter } from '../types/index.js';

export declare function init(authToken?: string): Puter;
export declare function getAuthToken(guiOrigin?: string): Promise<string>;
