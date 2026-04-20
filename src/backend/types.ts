import type { PuterRouter } from './core/http/PuterRouter';

export interface IAWSCredentials {
    access_key?: string;
    secret_key?: string;
    region?: string;
}

export interface IDynamoConfig {
    aws?: IAWSCredentials;
    endpoint?: string;
    path?: string;
}

export interface IRedisConfig {
    startupNodes?: Array<{
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

/**
 * Shape of an entry under `config.providers.*` — each AI / integration driver
 * reads a slightly different subset of these keys. Kept permissive so new
 * providers don't have to touch the root type.
 */
export interface IAIProviderConfig {
    /** API key. Sole canonical name — drivers no longer accept `secret_key`/`api_key`/`key` aliases. */
    apiKey?: string;
    /** Cloudflare API token (semantically distinct from a regular key). Cloudflare-only. */
    apiToken?: string;
    /** Override the provider's HTTP base URL (OpenRouter, Cloudflare, ElevenLabs, Ollama). */
    apiBaseUrl?: string;
    /** Cloudflare account id. */
    accountId?: string;
    /** ElevenLabs default voice id. */
    defaultVoiceId?: string;
    /** ElevenLabs speech-to-speech model id. */
    speechToSpeechModelId?: string;
    /** Ollama toggle — defaults true; set `false` to disable. */
    enabled?: boolean;
    /** AWS credentials for AWS-backed providers (Polly, Textract). */
    aws?: IAWSCredentials;
    /** Escape hatch — providers often expose additional tuning knobs. */
    [key: string]: unknown;
}

/**
 * OIDC provider sub-config (google, custom, …). `google` uses discovery, so
 * only `client_id` + `client_secret` are required; custom providers must
 * also supply the three endpoint URLs explicitly.
 */
export interface IOIDCProviderConfig {
    client_id?: string;
    client_secret?: string;
    authorization_endpoint?: string;
    token_endpoint?: string;
    userinfo_endpoint?: string;
    /** Space-separated OAuth scopes. Default depends on provider. */
    scopes?: string;
    [key: string]: unknown;
}

export interface IOIDCConfig {
    providers?: Record<string, IOIDCProviderConfig>;
}

export interface IPeersConfig {
    /** WebRTC signaller URL returned to clients. */
    signaller_url?: string;
    /** Fallback ICE server list when TURN credential generation fails. */
    fallback_ice?: unknown[];
    /** TURN credential generation config (Cloudflare-backed). */
    turn?: {
        cloudflare_turn_service_id?: string;
        cloudflare_turn_api_token?: string;
        /** Credential TTL in seconds. Default 86400. */
        ttl?: number;
    };
    /** Shared secret for the internal `/turn/ingest-usage` endpoint. */
    internal_auth_secret?: string;
}

export interface IBroadcastPeerConfig {
    /** Stable id of the peer (also sent as `X-Broadcast-Peer-Id`). */
    peerId?: string;
    /** Whether this peer should receive webhooks. Non-webhook peers are skipped. */
    webhook?: boolean;
    /** HTTPS endpoint to POST broadcast events to. */
    webhook_url?: string;
    /** HMAC-SHA256 secret shared with the peer for signing. */
    webhook_secret?: string;
}

export interface IBroadcastConfig {
    peers?: IBroadcastPeerConfig[];
    webhook?: {
        /** This server's peerId, sent in outbound POSTs as `X-Broadcast-Peer-Id`. */
        peerId?: string;
        /** Secret used to sign OUTBOUND POSTs. */
        secret?: string;
    };
    /** Reject webhooks whose timestamp is more than this many seconds in the past. Default 300. */
    webhook_replay_window_seconds?: number;
    /** Time to wait coalescing outbound events into a single peer POST. Default 2000ms. */
    outbound_flush_ms?: number;
}

/**
 * Cloudflare Workers deployment config used by `WorkerDriver`.
 */
export interface IWorkersConfig {
    XAUTHKEY?: string;
    ACCOUNTID?: string;
    /** Optional dispatch namespace — when set, scripts deploy under `/dispatch/namespaces/<ns>`. */
    namespace?: string;
    /** Base URL included as the `puter_endpoint` binding. Default `https://api.puter.com`. */
    internetExposedUrl?: string;
    /** URL returned by `getLoggingUrl()` — surfaced to clients that render worker logs. */
    loggingUrl?: string;
    [key: string]: string | undefined;
}

export interface IEntriConfig {
    applicationId?: string;
    secret?: string;
}

export interface IWispConfig {
    /** WISP relay server address returned to clients on token create. */
    server?: string;
    [key: string]: unknown;
}

export interface IServerHealthConfig {
    /** DB liveness latency threshold (ms). Default 1500. */
    db_liveness_latency_fail_ms?: number;
    /** Staleness threshold for the health-check loop itself (ms). */
    stale_health_loop_fail_ms?: number;
}

export interface IS3LocalConfig {
    inMemory?: boolean;
    host?: string;
    port?: number;
    dataDir?: string;
    s3StorageDir?: string;
}

export interface IS3RemoteConfig {
    useCredentialChain?: boolean;
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    region?: string;
}

export interface IS3Config {
    localConfig?: IS3LocalConfig;
    s3Config?: IS3RemoteConfig;
}

export interface IDatabaseConfig {
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
}

/**
 * Bucket of pass-through values surfaced to the client-side `gui()` boot
 * function. Known fields are declared for lookup hygiene; unknown keys are
 * still tolerated so product teams can add one-off flags without churn.
 */
export interface IGuiParams {
    title?: string;
    short_description?: string;
    social_media_image?: string;
    [key: string]: unknown;
}

/**
 * Complete shape of Puter's root config. Everything is optional here —
 * mandatory fields (only `port` + `extensions`) are pulled out of the
 * `Partial<...>` below and listed after it.
 *
 * When adding a new config field, declare it here with a doc comment so
 * there's a single discoverable reference for every config-driven switch.
 *
 * One value, one location: each setting lives at exactly one key. There are
 * no legacy aliases or fallback paths — older configs that relied on them
 * need to migrate.
 */
interface IConfigOptional {
    // ── Environment / identity ──────────────────────────────────────

    /** Environment marker. `dev` disables blocked-email checks, opens auto-browser, etc. */
    env: 'dev' | 'prod';
    /** Free-form name of the config profile (e.g. `oss-default`). Surfaced in logs. */
    config_name: string;
    /** Server version. Falls back to `npm_package_version`. */
    version: string;
    /** Stable identity for this server node. Enables pager alerts + graceful shutdown delay. */
    serverId: string;

    // ── Networking / URLs ───────────────────────────────────────────

    /** Protocol used for the externally-visible origin ('http' or 'https'). Default: 'http'. */
    protocol: string;
    /** Primary domain for Puter (e.g., `puter.localhost`, `puter.com`). */
    domain: string;
    /** Externally-visible port. Defaults to `port`. Behind a reverse proxy, set this to the public port. */
    pub_port: number;
    /** Fully-qualified externally-visible URL (protocol + domain + port). Computed from `protocol`/`domain`/`pub_port` if unset. */
    origin: string;
    /** Public base URL for the API subdomain, e.g. `https://api.puter.com`. Used to build signed URLs. */
    api_base_url: string;
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
    /** Don't launch browser when starting. */
    no_browser_launch: boolean;

    // ── Auth / session ──────────────────────────────────────────────

    /** HMAC secret used to sign auth JWTs. */
    jwt_secret: string;
    /** HMAC secret for signed file URLs (/file, /writeFile, /sign). */
    url_signature_secret: string;
    /** Name of the session cookie the auth probe reads. */
    cookie_name: string;
    /** Minimum password length for login/signup validation. */
    min_pass_length: number;
    /** When true, allow the 'system' user to log in. */
    allow_system_login: boolean;
    /** Reject auth-gated routes unless the user has confirmed their email. */
    strict_email_verification_required: boolean;
    /** Captcha configuration. */
    captcha: { enabled: boolean; difficulty?: 'easy' | 'medium' | 'hard' };
    /** OIDC / OAuth2 providers (google + custom). */
    oidc: IOIDCConfig;

    // ── Groups / provisioning ───────────────────────────────────────

    /** UID of the persistent group that non-temp users are enrolled in at signup. */
    default_user_group: string;
    /** UID of the persistent group that temporary users are enrolled in at signup. */
    default_temp_group: string;
    /** When true, ACL grants read/list/see on `/<user>/Public` to any actor. */
    enable_public_folders: boolean;

    // ── Storage / S3 ────────────────────────────────────────────────

    /** S3 storage config (local fauxqs or remote). */
    s3: IS3Config;
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

    // ── Database ────────────────────────────────────────────────────

    database: IDatabaseConfig;

    // ── Clients / infra ─────────────────────────────────────────────

    dynamo: IDynamoConfig;
    redis: IRedisConfig;
    pager: IPagerConfig;
    email: IEmailConfig;
    clickhouse: IClickhouseConfig;
    cf_file_cache: ICfFileCacheConfig;

    // ── Rate limiting ───────────────────────────────────────────────

    rate_limit: {
        /**
         * Rate limiter backend selection.
         *   - `memory`: per-node in-memory counters.
         *   - `redis`:  sorted-sets in Redis — shared state across nodes (default).
         *   - `kv`:     per-hit rows in the system KV store (DynamoDB), with TTL.
         */
        backend?: 'memory' | 'redis' | 'kv';
    };

    // ── AI / integration providers ──────────────────────────────────
    //
    // All AI providers — chat, image, video, TTS, OCR, speech-to-text,
    // speech-to-speech — are configured under `providers[<provider-id>]`.
    // Provider ids match the driver-side identifier (e.g. `claude`,
    // `openai-image-generation`, `aws-textract`). There is no `services`
    // bag and no top-level `openai`/`gemini`/`mistral`/`elevenlabs`/`aws`
    // shortcut.
    providers: Record<string, IAIProviderConfig | undefined>;

    // ── Cross-node / external integrations ──────────────────────────

    /** Cross-node event replication config. */
    broadcast: IBroadcastConfig;
    /** WebRTC signalling + TURN. */
    peers: IPeersConfig;
    /** WISP relay proxy. */
    wisp: IWispConfig;
    /** Cloudflare Workers driver config. */
    workers: IWorkersConfig;
    /** Entri custom-domain integration. */
    entri: IEntriConfig;
    /** IPInfo / Kickbox / PagerDuty signup-abuse integration. */
    abuse: IAbuseConfig;
    /** Legacy Stripe billing extension. */
    legacyBilling: ILegacyBillingConfig;

    // ── GUI / static mounts ─────────────────────────────────────────

    /** Absolute path to the GUI assets root. */
    gui_assets_root: string;
    /** Which profile in `puter-gui.json` to load. Default: `development`. */
    gui_profile: string;
    /**
     * Map of built-in app name → local directory served at `/builtin/<name>`.
     */
    builtin_apps: Record<string, string>;
    /** Force the bundled GUI even in dev. Default: false. */
    use_bundled_gui: boolean;
    /** Override the GUI bundle JS path. Default: `/dist/bundle.min.js`. */
    gui_bundle: string;
    /** Override the GUI CSS path when bundled. Default: `/dist/bundle.min.css`. */
    gui_css: string;
    /** Override the puter.js preload URL when bundled. Default: `https://js.puter.com/v2/`. */
    gui_puterjs_bundle: string;
    /** Free-form bag of values passed through to the client-side `gui()` function. */
    gui_params: IGuiParams;
    /**
     * Absolute path to the directory holding native app bundles, each in a
     * subdirectory matching its subdomain (e.g. `<root>/editor/`).
     */
    native_apps_root: string;
    /** Absolute path to a directory holding `puter.js`/`putility.js` version bundles. */
    client_libs_root: string;
    /** Path to the puter-js SDK root (serves `/sdk/*` and `/puter.js/v{1,2}`). */
    puterjs_root: string;

    // ── Extension-specific ──────────────────────────────────────────

    /**
     * Flat `{ flag_name: boolean }` bag surfaced to clients via `/whoami`.
     * Non-boolean values are coerced.
     */
    feature_flags: Record<string, boolean | string | number>;
    /** Blocked email TLDs / domains — checked in `prod` only. */
    blockedEmailDomains: string[];
    /** Contact-form recipient. Default `support@puter.com`. */
    support_email: string;
    /** Worker / subdomain names that cannot be allocated by users. */
    reserved_words: string[];
    /** Max subdomains a single user may own. Default 10. */
    max_subdomains_per_user: number;
    /** Health-check tuning. */
    server_health: IServerHealthConfig;
}

export type IConfig = Partial<IConfigOptional> & {
    extensions: string[];
    port: number;
};

// eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
export interface WithLifecycle extends Object {
    onServerStart?: () => Promise<void> | void;
    onServerShutdown?: () => Promise<void> | void;
    onServerPrepareShutdown?: () => Promise<void> | void;
}

export interface WithControllerRegistration extends WithLifecycle {
    registerRoutes: (router: PuterRouter) => void;
}

export type LayerInstances<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string, (new (...args: any[]) => any) | any>,
> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [K in keyof T]: T[K] extends new (...args: any[]) => any
        ? InstanceType<T[K]>
        : T[K];
};
