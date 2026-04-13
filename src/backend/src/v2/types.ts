import type { PuterRouter } from './core/http/PuterRouter';

export interface IDynamoConfig {
    aws?: {
        accessKeyId?: string;
        secretAccessKey?: string;
        region?: string;
        access_key?: string;
        secret_key?: string;
    };
    endpoint?: string;
    path?: string;
}

export interface IRedisConfig {
    startupNodes?: Array<{
        host: string;
        port: number;
    }>;
    clusterNodes?: Array<{
        host: string;
        port: number;
    }>;
    useMock?: boolean;
}

export interface IPagerConfig {
    pagerduty?: {
        enabled?: boolean;
        routingKey?: string;
    };
}

export interface IEmailConfig {
    /** "From" address used when callers don't override. */
    from?: string;
    // nodemailer transport options (passed through as-is)
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: {
        user?: string;
        pass?: string;
    };
    service?: string;
    [key: string]: unknown;
}

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
    };
    database: {
        engine: 'sqlite' | 'mysql';
        // sqlite
        path?: string;
        targetVersion?: number;
        // mysql
        host?: string;
        port?: number;
        user?: string;
        password?: string;
        database?: string;
        replica?: {
            host?: string;
            port?: number;
            user?: string;
            password?: string;
            database?: string;
        };
    };
    dynamo: IDynamoConfig;
    dynamoDb: IDynamoConfig;
    redis: IRedisConfig;
    pager: IPagerConfig;
    email: IEmailConfig;
    serverId: string;
    env: 'dev' | 'prod';
    blockedEmailDomains: string[];
    /** UID of the persistent group that non-temp users are enrolled in at signup. */
    default_user_group: string;
    /** UID of the persistent group that temporary users are enrolled in at signup. */
    default_temp_group: string;
    /** When true, ACL grants read/list/see on `/<user>/Public` to any actor (owner must have confirmed email, or be admin). */
    enable_public_folders: boolean;
    /** HMAC secret used to sign auth JWTs. Must match v1 during transition. */
    jwt_secret: string;
    /** Name of the session cookie the auth probe reads. */
    cookie_name: string;
    services: {
        dynamo?: IDynamoConfig;
        redis?: IRedisConfig;
    };
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
    registerRoutes: (router: PuterRouter) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LayerInstances<T extends Record<string, (new (...args: any[]) => any) | any>> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [K in keyof T]: T[K] extends new (...args: any[]) => any ? InstanceType<T[K]> : T[K];
};
