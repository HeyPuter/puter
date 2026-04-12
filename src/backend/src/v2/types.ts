import type { Application } from 'express';

export interface IConfig extends Partial<{
    s3: {
        localConfig: {
            inMemory?: boolean;
            host?: string;
        }
        s3Config?: never
    } | {
        localConfig?: never;
        s3Config: {
            useCredentialChain?: boolean;
            endpoint: string;
            accessKeyId: string;
            secretAccessKey: string;
            region?: string;
        }
    }
}> {
    extensions: string[];
    port: number;
    // allowed mandatory configs
}

export interface WithLifecycle extends Object {
    onServerStart?: () => Promise<void> | void;
    onServerShutdown?: () => Promise<void> | void;
    onServerPrepareShutdown?: () => Promise<void> | void;
}

export interface WithControllerRegistration extends WithLifecycle {
    registerRoutes: (app: Omit<Application, 'listen'>) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LayerInstances<T extends Record<string, (new (...args: any[]) => any) | any>> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [K in keyof T]: T[K] extends new (...args: any[]) => any ? InstanceType<T[K]> : T[K];
};
