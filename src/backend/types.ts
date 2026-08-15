/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import type { PuterRouter } from './core/http/PuterRouter';

export interface IAWSCredentials {
    access_key?: string;
    secret_key?: string;
    region?: string;
}

export interface IDynamoConfig {
    aws?: IAWSCredentials;
    endpoint?: string;
    /**
     * Filesystem path for the local dynalite store. Defaults to
     * `./volatile/runtime/puter-ddb`. Pass `':memory:'` (or set `inMemory:
     * true`) to run dynalite without persistence — the recommended setup for
     * unit/integration tests.
     */
    path?: string;
    /**
     * Run dynalite in-memory with no on-disk state. Equivalent to `path:
     * ':memory:'`. Intended for tests so each suite gets a pristine in-process
     * DynamoDB.
     */
    inMemory?: boolean;
    /**
     * Create required tables on startup if they don't exist. Off by default
     * because real-AWS deployments provision tables externally (Terraform /
     * IaC). Set to `true` when pointing at a local DynamoDB emulator so
     * self-hosters don't have to bootstrap by hand.
     */
    bootstrapTables?: boolean;
}

export interface IRedisConfig {
    startupNodes?: Array<{
        host: string;
        port: number;
    }>;
    /**
     * Use TLS for cluster connections. Defaults to `true` (matches prod
     * ElastiCache). Set `false` for self-host plain-TCP Valkey/Redis.
     */
    tls?: boolean;
    /**
     * Use ioredis-mock instead of a real Redis cluster — fully in-process, no
     * network. Defaults to `true` when `startupNodes` is empty (so tests with
     * no redis config get a mock for free). Intended for unit/integration
     * tests.
     */
    useMock?: boolean;
}

/**
 * Redis-backed read cache in front of the KV store's point reads (`get`, and
 * the per-key half of a batch `get`). Off unless `enabled` is set.
 *
 * Only user/app namespaces are cached; internal state under the system
 * namespace is always read through, as are consistent reads.
 *
 * Turning the cache off does not clear what it already holds. Entries stop
 * being read but also stop being invalidated, so a disable followed by a
 * re-enable inside `ttlSeconds` can serve values written in between — wait out
 * `ttlSeconds` before switching back on.
 */
export interface IKvCacheConfig {
    /** Master switch. Default false. */
    enabled?: boolean;
    /** Seconds a cached value is served for. Default 60. */
    ttlSeconds?: number;
    /**
     * Seconds a cached absence is served for. Shorter than `ttlSeconds` because
     * a key that doesn't exist yet is the one most likely to appear. Default
     * 10.
     */
    missTtlSeconds?: number;
    /**
     * Seconds after a write during which that key's reads bypass the cache.
     * Must comfortably exceed how long a mutation takes to become visible to
     * every reader, or a read that raced the write can re-cache the old value.
     * Default 5.
     */
    blockSeconds?: number;
    /**
     * Largest cached entry, in bytes of serialized envelope. Bigger values are
     * read through — they earn the least per byte of cache memory. Default
     * 32768.
     */
    maxEntryBytes?: number;
    /**
     * Milliseconds invalidations accumulate for before one broadcast carries
     * them all. Local invalidation is always immediate; this only batches the
     * message to peers. 0 sends one per write. Default 250.
     */
    broadcastCoalesceMs?: number;
}

/**
 * Alert severity. Ordered `info` < `warning` < `error` < `critical`; each alert
 * transport takes everything at or above its own `minSeverity`, so the severity
 * a call site picks is what decides where the alarm lands.
 */
export type PagerSeverity = 'critical' | 'error' | 'warning' | 'info';

/** A severity, or `mute` to drop the alarm before any transport sees it. */
export type SeverityRule = PagerSeverity | 'mute';

export interface IPagerDutyConfig {
    enabled?: boolean;
    routingKey?: string;
    /**
     * Lowest severity that reaches PagerDuty. Default `warning`, which keeps
     * `info` alarms out of the paging system entirely.
     */
    minSeverity?: PagerSeverity;
}

export interface ISlackAlertConfig {
    enabled?: boolean;
    /** Incoming-webhook URL to post alerts to. */
    webhookUrl?: string;
    /** Channel override (e.g. `#alerts`). Defaults to the webhook's own. */
    channel?: string;
    /** Bot display name on the posted message. */
    username?: string;
    /** Lowest severity posted to Slack. Default `info`. */
    minSeverity?: PagerSeverity;
    /**
     * Highest severity posted to Slack. Defaults to `info` when PagerDuty is
     * configured — anything that pages belongs in the paging system, not in
     * chat — and to `critical` (everything) when Slack is the only transport.
     */
    maxSeverity?: PagerSeverity;
    /**
     * Don't repost the same alarm id within this window. The first occurrence
     * always posts; repeats inside the window only bump the occurrence count
     * that the next post reports. Default 15 minutes; `0` disables throttling.
     */
    repeatThrottleMs?: number;
}

export interface IPagerConfig {
    /** Severity used when a call site doesn't pass one. Default `critical`. */
    defaultSeverity?: PagerSeverity;
    /**
     * Operator overrides keyed by alarm id, or by prefix with a trailing `*`
     * (`cronMonitor:*`). Exact ids beat patterns and the longest matching
     * prefix wins. Applied after the call site's severity and any known-error
     * rule, so this is the final say — it can retier or mute a noisy alarm
     * without a deploy.
     */
    severityOverrides?: Record<string, SeverityRule>;
    pagerduty?: IPagerDutyConfig;
    slack?: ISlackAlertConfig;
}

export interface ICfFileCacheConfig {
    /**
     * POST endpoint that accepts batched `{ site, path }[]` invalidation
     * payloads.
     */
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

/** Prelude (https://prelude.so) Verify v2 — SMS phone verification provider. */
export interface IPreludeConfig {
    /** Prelude v2 API key (sent as `Authorization: Bearer <apiKey>`). */
    apiKey?: string;
    /** Default region for parsing local-format phone numbers (e.g. 'US'). */
    defaultCountry?: string;
    /** Per-SMS cost ceiling in EUR. */
    maxSmsCostEur?: number;
    /**
     * Verification template id (from the Prelude dashboard) that controls the
     * SMS wording — e.g. a "Your Puter verification code is {{code}}" template.
     * The message text itself is authored in Prelude, not here; this just
     * selects it. Omit to use the dashboard default.
     */
    templateId?: string;
    /**
     * Alphanumeric Sender ID to brand who the SMS is "from" (e.g. "Puter").
     * Must be pre-enabled by Prelude and isn't supported by all
     * carriers/regions (notably US long/short codes). Omit to use Prelude's
     * default sender.
     */
    senderId?: string;
    /**
     * Channel Prelude prioritizes for delivery. Defaults to 'rcs' (much cheaper
     * than SMS); Prelude falls back to SMS when RCS isn't reachable. Requires
     * an RCS agent provisioned in the Prelude account to actually use RCS.
     */
    preferredChannel?:
        'sms' | 'rcs' | 'whatsapp' | 'viber' | 'zalo' | 'telegram';
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
    /**
     * API key. Sole canonical name — drivers no longer accept
     * `secret_key`/`api_key`/`key` aliases.
     */
    apiKey?: string;
    /**
     * Cloudflare API token (semantically distinct from a regular key).
     * Cloudflare-only.
     */
    apiToken?: string;
    /**
     * Override the provider's HTTP base URL (OpenRouter, Cloudflare,
     * ElevenLabs, Ollama).
     */
    apiBaseUrl?: string;
    /**
     * Azure AI Foundry deployment endpoint (azure-openai). Required alongside
     * `apiKey`.
     */
    apiURL?: string;
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
 * only `client_id` + `client_secret` are required; custom providers must also
 * supply the three endpoint URLs explicitly.
 */
export interface IOIDCProviderConfig {
    client_id?: string;
    client_secret?: string;
    authorization_endpoint?: string;
    token_endpoint?: string;
    userinfo_endpoint?: string;
    /** Space-separated OAuth scopes. Default depends on provider. */
    scopes?: string;
    /** Apple Developer Team ID (apple provider only). */
    team_id?: string;
    /** Key ID for the Sign in with Apple private key (apple provider only). */
    key_id?: string;
    /** PKCS#8 PEM private key content from Apple (apple provider only). */
    private_key?: string;
    /** Azure AD tenant ID (microsoft provider only). Defaults to "common". */
    tenant_id?: string;
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
        /**
         * This server's peerId, sent in outbound POSTs as
         * `X-Broadcast-Peer-Id`.
         */
        peerId?: string;
        /** Secret used to sign OUTBOUND POSTs. */
        secret?: string;
    };
    /**
     * Reject webhooks whose timestamp is more than this many seconds in the
     * past. Default 300.
     */
    webhook_replay_window_seconds?: number;
    /**
     * Time to wait coalescing outbound events into a single peer POST. Default
     * 2000ms.
     */
    outbound_flush_ms?: number;
}

/** Cloudflare Workers deployment config used by `WorkerDriver`. */
export interface IWorkersConfig {
    XAUTHKEY?: string;
    ACCOUNTID?: string;
    /**
     * Optional dispatch namespace — when set, scripts deploy under
     * `/dispatch/namespaces/<ns>`.
     */
    namespace?: string;
    /**
     * Base URL included as the `puter_endpoint` binding. Default
     * `https://api.puter.com`.
     */
    internetExposedUrl?: string;
    /**
     * URL returned by `getLoggingUrl()` — surfaced to clients that render
     * worker logs.
     */
    loggingUrl?: string;
    [key: string]: string | undefined;
}

/**
 * Optional outbound-fetch proxy used by `secureFetch()` when the backend has to
 * fetch a user-supplied URL (e.g. image-gen `input_image`). Requests get
 * prefixed with `url` and sent through the Worker with `x-cors-proxy-auth-
 * secret: <secret>`; the Worker authenticates the secret, fetches the real URL,
 * and strips CORS on the response. Unset → fetches go direct (still guarded by
 * the URL/redirect/DNS checks in secureFetch).
 */
export interface ISecureCorsProxyConfig {
    url: string;
    secret: string;
}

export interface IWispConfig {
    /** WISP relay server address returned to clients on token create. */
    server?: string;
    [key: string]: unknown;
}

export interface IServerHealthConfig {
    /** DB liveness latency threshold (ms). Default 1500. */
    db_liveness_latency_fail_ms?: number;
    /**
     * Latency threshold for the primary-pinned probe (ms). Separate from
     * `db_liveness_latency_fail_ms` because that one measures the local read
     * path while this one crosses to whichever region holds the primary.
     * Default 3000. Values at or above the 4000ms per-check timeout are moot —
     * the check runner gives up first.
     */
    db_primary_liveness_latency_fail_ms?: number;
    /**
     * Consecutive over-threshold runs before the primary probe reports
     * unhealthy. Default 2, i.e. sustained slowness rather than one slow round
     * trip. A primary that errors or hangs fails on the first run regardless.
     */
    db_primary_liveness_breaches_to_fail?: number;
    /** Staleness threshold for the health-check loop itself (ms). */
    stale_health_loop_fail_ms?: number;
    /**
     * Cadence for the external-dependency probes (redis, dynamo, object store,
     * primary database). Deliberately slower than the 5s check loop so probing
     * a paid, rate-limited backing service stays a rounding error against real
     * traffic. Default 30000.
     */
    dependency_check_interval_ms?: number;
    /** Redis liveness latency threshold (ms). Default 1000. */
    redis_liveness_latency_fail_ms?: number;
    /** Dynamo liveness latency threshold (ms). Default 1500. */
    dynamo_liveness_latency_fail_ms?: number;
    /** Object-store liveness latency threshold (ms). Default 2000. */
    s3_liveness_latency_fail_ms?: number;
    /**
     * Check names to skip registering entirely — an operator kill switch for a
     * probe that turns out to be noisy, without waiting on a deploy.
     */
    disabled_checks?: string[];
}

export interface IS3LocalConfig {
    /**
     * Run fauxqs entirely in-memory: random port on `127.0.0.1`, no `dataDir` /
     * `s3StorageDir`. Intended for tests so each suite gets a pristine
     * in-process S3.
     */
    inMemory?: boolean;
    host?: string;
    port?: number;
    dataDir?: string;
    s3StorageDir?: string;
}

export interface IS3RemoteConfig {
    useCredentialChain?: boolean;
    endpoint: string;
    /**
     * Endpoint used when generating presigned URLs handed to clients (browser
     * uploads/downloads). Defaults to `endpoint`. Set this when the server-side
     * S3 endpoint isn't reachable from the browser — e.g. self-host with
     * `endpoint: http://s3:9000` (docker-internal) and `publicEndpoint:
     * http://localhost:9000` (host-published port).
     */
    publicEndpoint?: string;
    accessKeyId: string;
    secretAccessKey: string;
    region?: string;
    /**
     * Use path-style URLs (`<endpoint>/<bucket>`) instead of virtual-hosted
     * style (`<bucket>.<endpoint>`). Defaults to AWS SDK's default (virtual-
     * hosted, which only works on real AWS S3). Set `true` for S3-compatible
     * servers (RustFS, MinIO, fauxqs) where DNS-style addressing fails.
     */
    forcePathStyle?: boolean;
}

export interface IS3Config {
    localConfig?: IS3LocalConfig;
    s3Config?: IS3RemoteConfig;
}

export interface IDatabaseConfig {
    engine: 'sqlite' | 'mysql' | 'postgres';
    // sqlite
    /**
     * SQLite database file path. Defaults to `':memory:'` (the better-sqlite3
     * in-memory mode), which is also what tests should use. `inMemory: true` is
     * an explicit alias for the same.
     */
    path?: string;
    /**
     * Force in-memory SQLite (ignores `path`). Equivalent to `path:
     * ':memory:'`. Intended for tests so each suite gets a pristine in-process
     * database. Test utilities also use `engine: 'postgres'` with `inMemory:
     * true` to run against pgmock.
     */
    inMemory?: boolean;
    targetVersion?: number;
    // mysql
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    connectionString?: string;
    url?: string;
    replica?: {
        host?: string;
        port?: number;
        user?: string;
        password?: string;
        database?: string;
        connectionString?: string;
        url?: string;
    };
    /**
     * Server-side execution cap for SELECT statements in ms (mysql engine;
     * applies to both pools — MySQL only enforces it on SELECTs, so writes are
     * unaffected). 0 disables. Default 30000.
     */
    selectTimeoutMs?: number;
    /**
     * Max time to wait for a pooled connection before the query batcher treats
     * acquisition as failed, in ms (mysql engine). 0 disables the bound.
     * Default 5000.
     */
    acquireTimeoutMs?: number;
    /**
     * Ordered list of directories whose `.sql` files are run sequentially at
     * server start (mysql/postgres engines). Numbered migration filenames sort
     * numerically; directories are processed in array order. Files MUST be
     * idempotent — there is no per-file applied-state tracking. Relative paths
     * resolve from `process.cwd()`.
     */
    migrationPaths?: string[];
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
    /**
     * Public SDK key for Prelude's JS Signals SDK. When set, the phone-
     * verification window collects a `dispatch_id` (browser signals) and
     * forwards it to /send-confirm-phone, which passes it to Prelude's Verify
     * API so its abuse model can weigh the device. Omit to disable collection.
     */
    preludeSdkKey?: string;
    [key: string]: unknown;
}

export interface IDevWatcherConfig {
    /** Force-enable/disable the dev watcher. Defaults to enabled in dev. */
    enabled?: boolean;
    /** Root path for watcher entries. Relative paths resolve from package root. */
    root?: string;
    /** Delay after watcher startup before boot continues. Default: 5000. */
    ready_delay_ms?: number;
    /** Optional extra child processes to start with the dev watcher. */
    commands?: Array<{
        name: string;
        directory: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
    }>;
    /**
     * Optional webpack watcher entries. Omit to use the built-in GUI/puter.js
     * watchers.
     */
    webpack?: Array<{
        name?: string;
        directory: string;
        env?: Record<string, string>;
    }>;
}

/**
 * Complete shape of Puter's root config. Everything is optional here —
 * mandatory fields (only `port` + `extensions`) are pulled out of the
 * `Partial<...>` below and listed after it.
 *
 * When adding a new config field, declare it here with a doc comment so there's
 * a single discoverable reference for every config-driven switch.
 *
 * One value, one location: each setting lives at exactly one key. There are no
 * legacy aliases or fallback paths — older configs that relied on them need to
 * migrate.
 */
interface IConfigOptional {
    // -- Environment / identity --------------------------------------

    /**
     * Environment marker. `dev` disables blocked-email checks, opens
     * auto-browser, etc.
     */
    env: 'dev' | 'prod';
    /**
     * Free-form name of the config profile (e.g. `oss-default`). Surfaced in
     * logs.
     */
    config_name: string;
    /**
     * Console output format. `json` replaces the global console so every call
     * emits one structured JSON line (`level`, `timestamp`, `msg`, and the
     * active `traceId`) — one event per call, so a line-oriented log collector
     * can't split stack traces across events, and level filtering works. `text`
     * (the default) leaves console output human-readable for local/dev.
     */
    log_format: 'json' | 'text';
    /**
     * Keep serving after an uncaught exception instead of exiting. Uncaught
     * exceptions are always logged either way; this only decides whether one
     * ends the process. Default: false, matching Node's own behavior. Set it
     * where losing the node costs more than running a possibly-degraded one — a
     * small pool behind a health check that replaces bad nodes anyway.
     */
    keep_alive_on_uncaught: boolean;
    /** Server version. Falls back to `npm_package_version`. */
    version: string;
    /**
     * Stable identity for this server node. Enables pager alerts + graceful
     * shutdown delay.
     */
    serverId: string;

    // -- Networking / URLs -------------------------------------------

    /**
     * Protocol used for the externally-visible origin ('http' or 'https').
     * Default: 'http'.
     */
    protocol: string;
    /** Primary domain for Puter (e.g., `puter.localhost`, `puter.com`). */
    domain: string;
    /**
     * Externally-visible port. Defaults to `port`. Behind a reverse proxy, set
     * this to the public port.
     */
    pub_port: number;
    /**
     * Fully-qualified externally-visible URL (protocol + domain + port).
     * Computed from `protocol`/`domain`/`pub_port` if unset.
     */
    origin: string;
    /**
     * Public base URL for the API subdomain, e.g. `https://api.puter.com`. Used
     * to build signed URLs.
     */
    api_base_url: string;
    /** Static hosting domain for user sites (e.g., `puter.site`). */
    static_hosting_domain: string;
    /** Alt static hosting domain. */
    static_hosting_domain_alt: string;
    /** Private app hosting domain (e.g., `app.puter.localhost`). */
    private_app_hosting_domain: string;
    /** Alt private app hosting domain. */
    private_app_hosting_domain_alt: string;
    /**
     * Groups of equivalent app index_url hosts. Each group lists hosts that
     * should resolve to the same canonical app: `appUidFromOrigin` looks up any
     * DB row whose `index_url` is one of the group's hosts and returns that
     * row's UID for every host in the group.
     *
     * Hosts listed here are also reserved — `apps.create` / `apps.update`
     * reject any attempt to register a different app under one of these hosts,
     * so the group is owned by exactly one app row.
     *
     * Entries are bare hosts (no scheme), lowercased. Example: [
     * ["camera.puter.com", "camera.puter.site", "camera.ca"],
     * ["player.puter.com", "player.puter.site"], ]
     */
    app_origin_aliases?: string[][];
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
    /**
     * Express `trust proxy` setting — controls how `req.ip` is derived from
     * `X-Forwarded-For`. Set to the number of reverse-proxy hops in front of
     * the server (e.g. `1` for a single Cloudflare or nginx hop, `2` for
     * Cloudflare → ALB → app), or to a CIDR / IP / list of trusted proxy
     * addresses. `false` (default) disables XFF parsing — `req.ip` returns the
     * direct socket peer, which is the safe choice when no proxy is in front.
     * Never set to `true` in production: it trusts _every_ hop and makes XFF
     * forgeable. See https://expressjs.com/en/guide/behind-proxies.html.
     */
    trust_proxy: boolean | number | string | string[];
    /** Don't launch browser when starting. */
    no_browser_launch: boolean;
    /** Disable dev-time frontend webpack watchers. */
    no_devwatch: boolean;
    /**
     * Skip first-boot bootstrap of the `admin` user and the credentials banner
     * that DefaultUserService prints. Intended for tests.
     */
    no_default_user: boolean;
    /**
     * Import `.ts` extension sources instead of built `.js`. Only for
     * transform-capable runtimes (the test harness sets this); plain node
     * cannot execute the TypeScript sources.
     */
    import_ts_extensions?: boolean;
    /** Optional dev-time frontend watcher overrides. */
    devwatch: IDevWatcherConfig;

    // -- Auth / session ----------------------------------------------

    /** HMAC secret used to sign and verify auth JWTs (`kid: 'v2'`). */
    jwt_secret_v2: string;
    /**
     * Optional extra `Origin` header values allowed to call the routes that
     * hand back a session credential (`/login`, `/signup`,
     * `/session/sync-cookie` — see `guiOriginGate`). The main `origin` is
     * always allowed, and callers with no `Origin` at all (CLI, mobile,
     * server-side, tests) are never gated.
     *
     * Only for deployments that genuinely serve their GUI from a different
     * origin than `config.origin`. Do NOT list loopback origins in production:
     * `http://localhost:4000` is not an authenticatable origin, it's whatever
     * is listening on that port on the visitor's machine. A local GUI should
     * obtain its token via the AuthMe flow instead.
     */
    allow_gui_origins?: string[];
    /** HMAC secret for signed file URLs (/file, /writeFile, /sign). */
    url_signature_secret: string;
    /** Name of the session cookie the auth probe reads. */
    cookie_name: string;
    /** Minimum password length for login/signup validation. */
    min_pass_length: number;
    /** When true, allow the 'system' user to log in. */
    allow_system_login: boolean;
    /**
     * When true, anonymous users cannot create new accounts or temporary
     * sessions. Existing accounts can still log in, and pre-existing
     * placeholder rows may still be claimed.
     */
    disable_user_signup: boolean;
    /** Reject auth-gated routes unless the user has confirmed their email. */
    strict_email_verification_required: boolean;
    /**
     * Force SMS phone verification on every new signup, regardless of abuse
     * reputation. Off by default; mainly a test/QA switch so the phone gate can
     * be exercised on demand (it otherwise only triggers for low-reputation
     * signups). Requires `prelude.apiKey` to actually deliver codes.
     */
    always_require_phone_verification: boolean;
    /**
     * Force credit-card verification on every new signup, regardless of abuse
     * reputation. Off by default; mainly a test/QA switch so the card gate can
     * be exercised on demand (it otherwise only triggers for low-reputation
     * signups). Requires a payments extension to actually run the $0 auth.
     */
    always_require_card_verification: boolean;
    /**
     * Let a user who keeps getting blocked on SMS phone verification fall back
     * to credit-card verification, which clears the phone gate (and the card
     * gate too, when one is set). Off by default.
     *
     * The fallback opens after `after_attempts` SMS _send_ attempts inside the
     * send rate-limit window — successful sends count too, so a user who
     * receives codes fine can still choose the card path after that many
     * requests. This trades the phone signal for a card signal; it does NOT
     * guarantee SMS actually failed. Once open, the fallback stays open for 24
     * hours so the user can finish the card flow. Requires a payments extension
     * to run the actual card check.
     */
    phone_verification_card_fallback: {
        enabled: boolean;
        /**
         * SMS send attempts (within the send rate-limit window) before the card
         * fallback opens. Defaults to 2 when omitted. Values above the send
         * route's rate limit (10/hour) are clamped down to it — requests past
         * the route limit never reach the attempt counter, so a higher
         * threshold could never be crossed.
         */
        after_attempts?: number;
    };
    /** Captcha configuration. */
    captcha: { enabled: boolean; difficulty?: 'easy' | 'medium' | 'hard' };
    /** OIDC / OAuth2 providers (google + custom). */
    oidc: IOIDCConfig;

    // -- Groups / provisioning ---------------------------------------

    /**
     * UID of the persistent group that non-temp users are enrolled in at
     * signup.
     */
    default_user_group: string;
    /**
     * UID of the persistent group that temporary users are enrolled in at
     * signup.
     */
    default_temp_group: string;
    /** When true, ACL grants read/list/see on `/<user>/Public` to any actor. */
    enable_public_folders: boolean;

    // -- Storage / S3 ------------------------------------------------

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

    // -- Database ----------------------------------------------------

    database: IDatabaseConfig;

    // -- Clients / infra ---------------------------------------------

    dynamo: IDynamoConfig;
    redis: IRedisConfig;
    /** Read cache in front of KV point reads. Off unless `enabled` is set. */
    kvCache: IKvCacheConfig;
    pager: IPagerConfig;
    email: IEmailConfig;
    /** Optional — only set when SMS phone verification (Prelude) is wired in. */
    prelude: IPreludeConfig;
    /** Optional — only set when a ClickHouse analytics client is wired in. */
    clickhouse?: IClickhouseConfig;
    cf_file_cache: ICfFileCacheConfig;

    // -- Rate limiting -----------------------------------------------

    rate_limit: {
        /**
         * Rate limiter backend selection.
         *
         * - `memory`: per-node in-memory counters.
         * - `redis`: sorted-sets in Redis — shared state across nodes (default).
         * - `kv`: per-hit rows in the system KV store (DynamoDB), with TTL.
         */
        backend?: 'memory' | 'redis' | 'kv';
    };

    // -- AI / integration providers ----------------------------------
    //
    // All AI providers — chat, image, video, TTS, OCR, speech-to-text,
    // speech-to-speech — are configured under `providers[<provider-id>]`.
    // Provider ids match the driver-side identifier (e.g. `claude`,
    // `openai-image-generation`, `aws-textract`). There is no `services`
    // bag and no top-level `openai`/`gemini`/`mistral`/`elevenlabs`/`aws`
    // shortcut.
    providers: Record<string, IAIProviderConfig | undefined>;

    // -- Cross-node / external integrations --------------------------

    /** Cross-node event replication config. */
    broadcast: IBroadcastConfig;
    /** WebRTC signalling + TURN. */
    peers: IPeersConfig;
    /** WISP relay proxy. */
    wisp: IWispConfig;
    /** Cloudflare Workers driver config. */
    workers: IWorkersConfig;
    /** Optional CORS-stripping signed-Worker proxy used by `secureFetch`. */
    secureCorsProxy: ISecureCorsProxyConfig;
    /** Legacy Stripe billing extension. */

    // -- GUI / static mounts -----------------------------------------

    /** Absolute path to the GUI assets root. */
    gui_assets_root: string;
    /** Which profile in `puter-gui.json` to load. Default: `development`. */
    gui_profile: string;
    /** Map of built-in app name → local directory served at `/builtin/<name>`. */
    builtin_apps: Record<string, string>;
    /** Force the bundled GUI even in dev. Default: false. */
    use_bundled_gui: boolean;
    /** Override the GUI bundle JS path. Default: `/dist/bundle.min.js`. */
    gui_bundle: string;
    /** Override the GUI CSS path when bundled. Default: `/dist/bundle.min.css`. */
    gui_css: string;
    /**
     * Override the puter.js preload URL when bundled. Default:
     * `https://js.puter.com/v2/`.
     */
    gui_puterjs_bundle: string;
    /**
     * Free-form bag of values passed through to the client-side `gui()`
     * function.
     */
    gui_params: IGuiParams;
    /**
     * Absolute path to the directory holding native app bundles, each in a
     * subdirectory matching its subdomain (e.g. `<root>/editor/`).
     */
    native_apps_root: string;
    /**
     * Absolute path to a directory holding `puter.js`/`putility.js` version
     * bundles.
     */
    client_libs_root: string;
    /** Path to the puter-js SDK root (serves `/sdk/*` and `/puter.js/v{1,2}`). */
    puterjs_root: string;

    // -- Extension-specific ------------------------------------------

    /**
     * Flat `{ flag_name: boolean }` bag of feature toggles. Non-boolean values
     * are coerced before use.
     *
     * Server-only by default. Flags are surfaced to clients via `/whoami` only
     * if their key is on the allowlist in `extensions/whoami.ts`
     * (`CLIENT_VISIBLE_FEATURE_FLAGS`). New flags should be assumed internal —
     * add them to the allowlist explicitly if (and only if) the client needs to
     * read them.
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

    //Metering
    unlimitedMetering?: boolean;
    /**
     * Fleet-wide spend rate, in micro-cents per minute, past which the metering
     * service raises an alarm. There is no defensible default here — the right
     * number is a multiple of what this deployment's own traffic normally
     * costs, so set it from observed rate and revisit it as traffic grows. An
     * unset or non-positive value turns the check off rather than guessing.
     */
    maxGlobalUsagePerMinute?: number;
    /**
     * How long per-request usage (response bytes, object-store requests) is
     * held in memory before being written, in milliseconds. This is the dial
     * between how promptly that usage lands and how many writes it costs: every
     * actor active in a window settles once per window, so halving it doubles
     * the write rate. Unset uses the service default; a non-positive value is
     * ignored.
     */
    meteringUsageBufferFlushMs?: number;
    /**
     * Whether recorded usage is also enforced: an account with nothing left of
     * its budget is turned away from the operations that spend it (file
     * transfers, KV calls) with a 402. Metadata reads and deletions stay open,
     * as does serving a hosted site — those bytes are billed to the account
     * hosting it but requested by visitors who have no say in its balance.
     *
     * - `enabled` — defaults to on, and covers the plan gates below as well. The
     *   switch to reach for if enforcement is turning away traffic it
     *   shouldn't; usage is still recorded either way.
     * - `workers` — extend enforcement to worker-driven calls. Off by default: a
     *   worker has no prompt to show and nobody watching, so being cut off
     *   presents as a program that started failing.
     * - `subscriptions` — whether surfaces that declare a plan requirement
     *   (`requireSubscription`) enforce it. Defaults to on, and off wherever no
     *   paid plan exists to be on (self-hosted installs ship it off). Turning
     *   it off opens those surfaces to every account without unpicking the
     *   declarations; `enabled: false` turns it off along with everything
     *   else.
     */
    meteringEnforcement?: {
        enabled?: boolean;
        workers?: boolean;
        subscriptions?: boolean;
    };

    /**
     * Display multiplier converting metered amounts into the "credits" clients
     * show. Applied server-side by the usage-reporting endpoints, so raw
     * metered amounts never leave the API; purely presentational, so it can
     * change without a data migration. No default — when unset, the endpoints
     * report raw amounts and clients render dollars.
     */
    creditMultiplier?: number;
}

/**
 * Extension-augmentable config surface. Extensions add their own config keys
 * via TypeScript declaration merging:
 *
 *     declare module '@heyputer/backend/types' {
 *         interface IExtensionConfig {
 *             myExtension?: { foo: string };
 *         }
 *     }
 *
 * Augmentations flow into `IConfig`, which is what `this.config` /
 * `extension.config` are typed as everywhere.
 */
export interface IExtensionConfig {
    /**
     * Open index signature so config reads of extension-only keys return
     * `unknown` (not a type error). Extensions that declare-merge concrete keys
     * (`myExt?: { foo: string }`) override this for the named key — the
     * concrete property type wins over the index signature.
     */
    [key: string]: unknown;
}

export type IConfig = Partial<IConfigOptional> & {
    extensions: string[];
    port: number;
} & IExtensionConfig;

// eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
export interface WithLifecycle extends Object {
    onServerStart?: () => Promise<void> | void;
    onServerShutdown?: () => Promise<void> | void;
    onServerPrepareShutdown?: () => Promise<void> | void;
}

export interface WithCostsReporting extends WithLifecycle {
    getReportedCosts?: () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        | Promise<Record<string, any>[]>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        | Record<string, any>[];
}

export interface WithControllerRegistration extends WithCostsReporting {
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
