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
    /** HMAC secret for signed file URLs (/file, /writeFile, /sign). */
    url_signature_secret: string;
    /** Public base URL for the API subdomain, e.g. `https://api.puter.com`. Used to build signed URLs. */
    api_base_url: string;
    /** Name of the session cookie the auth probe reads. */
    cookie_name: string;
    /** Primary domain for Puter (e.g., `puter.localhost`, `puter.com`). Used for host validation, CORS, and root-origin gating. */
    domain: string;
    /** Static hosting domain for user sites (e.g., `puter.site`). */
    static_hosting_domain: string;
    /** Alt static hosting domain. */
    static_hosting_domain_alt: string;
    /** Private app hosting domain (e.g., `app.puter.localhost`). */
    private_app_hosting_domain: string;
    /** Alt private app hosting domain. */
    private_app_hosting_domain_alt: string;
    /** When true, accept any Host header value. Dev/testing only. */
    allow_all_host_values: boolean;
    /** When true, accept requests without a Host header. */
    allow_no_host_header: boolean;
    /** When true, allow nip.io wildcard domains. */
    allow_nipio_domains: boolean;
    /** When true, support custom domain resolution for hosted sites. */
    custom_domains_enabled: boolean;
    /** When true, enable IP validation via event bus. */
    enable_ip_validation: boolean;
    /** Minimum password length for login/signup validation. */
    min_pass_length: number;
    /** When true, allow the 'system' user to log in. */
    allow_system_login: boolean;
    /** Captcha configuration. */
    captcha: { enabled: boolean; difficulty?: 'easy' | 'medium' | 'hard' };
    /** Default S3 bucket for file storage. */
    s3_bucket: string;
    /** Default S3 region. */
    s3_region: string;
    /** Fallback AWS region. */
    region: string;
    /** Default storage capacity per user (bytes). */
    storage_capacity: number;
    /** When false, storage is effectively unlimited (bounded by device space). */
    is_storage_limited: boolean;
    /** Bytes of device storage available (used when is_storage_limited=false). */
    available_device_storage: number;
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
