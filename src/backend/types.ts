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

/**
 * Legacy billing extension — retained for existing Puter-paid subscribers
 * while a rebuilt flow ships. New customers go through the metering/
 * appStore stack instead.
 */
export interface ILegacyBillingConfig {
    /** Stripe secret key. Unset → extension disables itself. */
    api_secret?: string;
    /** Stripe publishable key (client-side). */
    stripe_publishable_key?: string;
    /** Stripe webhook signing secret. */
    endpoint_secret?: string;
    /** Map from `price_pseudo_id` (e.g. `price_basic`) → actual Stripe price id. */
    price_ids?: Record<string, string>;
}

export interface IAbuseConfig {
    /** Master toggle. When false the extension short-circuits every handler. */
    enabled?: boolean;
    /** IPs that bypass every signup check. */
    allowed_ips?: string[];
    /** IPInfo token used for geo / hosting / ASN lookups. Unset → checks disabled. */
    ipinfo_token?: string;
    /** Kickbox API key used for email deliverability. Unset → check skipped (permissive). */
    kickbox_api_key?: string;
    /** PagerDuty personal REST token (NOT an Events API routing key). */
    pagerduty_token?: string;
    /** PagerDuty service UID that incidents are filed against. */
    pagerduty_service_id?: string;
    /** `From:` header required by the Incidents API. */
    pagerduty_from_email?: string;
}

export interface ICfFileCacheConfig {
    /** POST endpoint that accepts batched `{ site, path }[]` invalidation payloads. */
    endpoint: string;
    /** Flush cadence in ms. Default 500. */
    throttle_ms?: number;
}

export interface IClickhouseConfig {
    url: string;
    username?: string;
    password?: string;
    /** Milliseconds. Default 15000. */
    request_timeout?: number;
    /** Max pending rows before backpressure drops oldest. Default 100000. */
    max_buffer_size?: number;
    /** Rows per flush. Default 500. */
    batch_size?: number;
    /** Flush cadence in ms. Default 5000. */
    flush_interval_ms?: number;
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

/**
 * S3-compatible bucket the thumbnails extension uses for storing generated
 * thumbnails. When unset, the extension falls back to the main `S3Client`
 * (fauxqs locally, real S3 in prod) and writes into the default bucket.
 */
export interface IThumbnailStoreConfig {
    /** Bucket name. Default: `puter-local`. */
    name?: string;
    /** Endpoint URL — unset forces the fallback. */
    endpoint?: string;
    credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
    };
}

export interface IConfig extends Partial<{
    s3: {
        localConfig: {
            inMemory?: boolean;
            host?: string;
            port?: number;
            dataDir?: string;
            s3StorageDir?: string;
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
    clickhouse: IClickhouseConfig;
    cf_file_cache: ICfFileCacheConfig;
    abuse: IAbuseConfig;
    legacyBilling: ILegacyBillingConfig;
    serverId: string;
    env: 'dev' | 'prod';
    blockedEmailDomains: string[];
    /** UID of the persistent group that non-temp users are enrolled in at signup. */
    default_user_group: string;
    /** UID of the persistent group that temporary users are enrolled in at signup. */
    default_temp_group: string;
    /** When true, ACL grants read/list/see on `/<user>/Public` to any actor (owner must have confirmed email, or be admin). */
    enable_public_folders: boolean;
    /** HMAC secret used to sign auth JWTs. */
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
    /** Don't launch browser when starting */
    no_browser_launch: boolean;
    /**
     * Absolute path to the directory holding native app bundles, each in a
     * subdirectory matching its subdomain (e.g. `<root>/editor/`). When unset,
     * native-app subdomain serving is disabled.
     */
    native_apps_root: string;
    /**
     * Absolute path to a directory laid out as
     *   <root>/puter.js/v1.js
     *   <root>/puter.js/v2.js
     *   <root>/putility.js/v1.js
     * Served at `/puter.js/v{1,2}` on any subdomain and at `/v{1,2}` /
     * `/putility/v1` on the `js` subdomain. When unset, those routes 404.
     */
    client_libs_root: string;
    /**
     * Absolute path to the GUI assets root (the `gui/` directory). Mounted as
     *   /dist/*  → <root>/dist
     *   /src/*   → <root>/src
     *   /assets/* → <root>/public  (only if that subdirectory exists)
     * All on the root subdomain only. Unset → mounts are skipped.
     */
    gui_assets_root: string;
    /** Which profile in `puter-gui.json` to load (e.g., `development`, `bundle`). Default: `development`. */
    gui_profile: string;
    /** Force the bundled GUI even in dev. Default: false. */
    use_bundled_gui: boolean;
    /** Override the GUI bundle JS path. Default: `/dist/bundle.min.js`. */
    gui_bundle: string;
    /** Override the GUI CSS path when bundled. Default: `/dist/bundle.min.css`. */
    gui_css: string;
    /** Override the puter.js preload URL when bundled. Default: `https://js.puter.com/v2/`. */
    gui_puterjs_bundle: string;
    /**
     * Free-form bag of values passed through to the client-side `gui()`
     * function. Escape hatch for arbitrary params (e.g., feature flags, regex
     * patterns, size limits) without ballooning this interface.
     */
    gui_params: Record<string, unknown>;
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
    /** Protocol used for the externally-visible origin ('http' or 'https'). Default: 'http'. */
    protocol: string;
    /** Externally-visible port. Defaults to `port`. Behind a reverse proxy, set this to the public port (e.g. 443). */
    pub_port: number;
    /** Fully-qualified externally-visible URL (protocol + domain + port). Computed from `protocol`/`domain`/`pub_port` if unset. */
    origin: string;
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
    /** Optional dedicated S3-compatible bucket used by the thumbnails extension. */
    thumbnailStore: IThumbnailStoreConfig;
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
