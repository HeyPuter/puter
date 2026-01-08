import type { AI } from './modules/ai.d.ts';
import type { Apps } from './modules/apps.d.ts';
import type { Auth } from './modules/auth.d.ts';
import type { Debug } from './modules/debug.d.ts';
import type { Drivers } from './modules/drivers.d.ts';
import type { FS } from './modules/filesystem.d.ts';
import type { FSItem } from './modules/fs-item.d.ts';
import type { Hosting } from './modules/hosting.d.ts';
import type { KV } from './modules/kv.d.ts';
import type { Networking } from './modules/networking.d.ts';
import type { OS } from './modules/os.d.ts';
import type { Perms } from './modules/perms.d.ts';
import type { UI } from './modules/ui.d.ts';
import type Util from './modules/util.d.ts';
import type { WorkersHandler } from './modules/workers.d.ts';
import type { APICallLogger, APILoggingConfig, PuterEnvironment, ToolSchema } from './shared.d.ts';

export interface PuterArgs {
    [key: string]: unknown;
}

export interface PuterUser extends Record<string, unknown> {
    username?: string;
}

export class Puter {
    env: PuterEnvironment;
    appID?: string;
    appName?: string;
    appDataPath?: string;
    appInstanceID?: string;
    parentInstanceID?: string;
    args: PuterArgs;
    onAuth?: (user: PuterUser) => void;
    authToken?: string | null;
    APIOrigin: string;
    logger: unknown;
    apiCallLogger?: APICallLogger;
    puterAuthState: {
        isPromptOpen: boolean;
        authGranted: boolean | null;
        resolver: { resolve: () => void; reject: (reason?: unknown) => void } | null;
    };

    // Core modules
    util: Util;
    ai: AI;
    apps: Apps;
    auth: Auth;
    os: OS;
    fs: FS;
    ui: UI;
    hosting: Hosting;
    kv: KV;
    perms: Perms;
    drivers: Drivers;
    debug: Debug;
    path: {
        join: (...parts: string[]) => string;
        dirname: (p: string) => string;
        basename: (p: string) => string;
        normalize?: (p: string) => string;
        [key: string]: unknown;
    };

    net: Networking;
    workers: WorkersHandler;

    static FSItem: typeof FSItem;

    setAuthToken(authToken: string): void;
    resetAuthToken(): void;
    setAPIOrigin(APIOrigin: string): void;
    setAppID(appID: string): void;

    get defaultAPIOrigin(): string;
    set defaultAPIOrigin(value: string);
    get defaultGUIOrigin(): string;
    set defaultGUIOrigin(value: string);

    print(text: string, options?: { code?: boolean; escapeHTML?: boolean }): void;
    randName(separator?: string): string;
    exit(statusCode?: number): void;

    getUser(options?: { success?: (user: PuterUser) => void; error?: (reason: unknown) => void }): Promise<PuterUser>;
    configureAPILogging(config?: APILoggingConfig): this;
    enableAPILogging(config?: APILoggingConfig): this;
    disableAPILogging(): this;

    // Utilities for caches and network; exposed but not all internals are typed.
    checkAndUpdateGUIFScache(): void;
    initNetworkMonitoring(): void;

    tools: ToolSchema[];
}
