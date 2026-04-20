// Shared helpers for migrateConfig.mjs / migrateServers.mjs.

// ── JSON loading ──────────────────────────────────────────────────────────
// Old files may be multiple JSON objects glued together with `//` comments.
// Strip line-comments + trailing commas, then walk brace depth to split.

const stripLineComments   = (src) => src.replace(/^\s*\/\/.*$/gm, '');
const stripTrailingCommas = (src) => src.replace(/,(\s*[}\]])/g, '$1');

const splitJsonDocs = (src) => {
    const docs = [];
    let depth = 0;
    let start = -1;
    let inStr = false;
    let esc = false;
    for ( let i = 0; i < src.length; i++ ) {
        const c = src[i];
        if ( inStr ) {
            if ( esc ) esc = false;
            else if ( c === '\\' ) esc = true;
            else if ( c === '"' ) inStr = false;
            continue;
        }
        if ( c === '"' ) { inStr = true; continue; }
        if ( c === '{' ) {
            if ( depth === 0 ) start = i;
            depth++;
        } else if ( c === '}' ) {
            depth--;
            if ( depth === 0 && start !== -1 ) {
                docs.push(src.slice(start, i + 1));
                start = -1;
            }
        }
    }
    return docs;
};

// Strip any `$`-prefixed keys at every depth (e.g. `$preserve`).
const stripDollarKeys = (value) => {
    if ( Array.isArray(value) ) return value.map(stripDollarKeys);
    if ( value && typeof value === 'object' ) {
        const out = {};
        for ( const [k, v] of Object.entries(value) ) {
            if ( k.startsWith('$') ) continue;
            out[k] = stripDollarKeys(v);
        }
        return out;
    }
    return value;
};

export const loadDocs = (raw) => {
    const cleaned = stripTrailingCommas(stripLineComments(raw));
    const texts = splitJsonDocs(cleaned);
    return texts.map((text, idx) => {
        try { return stripDollarKeys(JSON.parse(text)); }
        catch ( e ) {
            throw new Error(`Failed to parse JSON document #${idx + 1}: ${e.message}`);
        }
    });
};

// ── Doc classification ───────────────────────────────────────────────────

export const pickServersDoc = (docs) => docs.find(d => Array.isArray(d?.servers));

export const pickBaseDoc = (docs) => {
    // Prefer prod base (has `services` and no `servers`), then OSS default,
    // then any non-servers doc.
    const prodBase   = docs.find(d => d && !Array.isArray(d.servers) && d.services && d.config_name && d.env !== 'dev');
    if ( prodBase ) return prodBase;
    const ossDefault = docs.find(d => d && !Array.isArray(d.servers) && (d.nginx_mode || d.env === 'dev'));
    if ( ossDefault ) return ossDefault;
    return docs.find(d => d && !Array.isArray(d.servers)) ?? null;
};

// ── Deep merge ───────────────────────────────────────────────────────────
// Plain deep merge: objects recurse, arrays + primitives replace.

export const deepMerge = (base, override) => {
    if ( override === undefined ) return base;
    if ( base === undefined )     return override;
    if ( base === null || override === null ) return override;
    if ( typeof base !== 'object' || typeof override !== 'object' ) return override;
    if ( Array.isArray(base) || Array.isArray(override) )           return override;
    const out = { ...base };
    for ( const [k, v] of Object.entries(override) ) {
        out[k] = deepMerge(base[k], v);
    }
    return out;
};

// ── v1 → v2 transformation ───────────────────────────────────────────────

const copyIfSet = (src, sk, dst, dk = sk) => {
    if ( src[sk] !== undefined ) dst[dk] = src[sk];
};

export const transformToV2 = (source) => {
    const out = {};

    // Scalar + renamed top-level keys.
    copyIfSet(source, 'config_name', out);
    copyIfSet(source, 'env', out);
    copyIfSet(source, 'server_id', out, 'serverId');
    copyIfSet(source, 'id', out, 'serverId');
    copyIfSet(source, 'region', out);
    copyIfSet(source, 'domain', out);
    copyIfSet(source, 'protocol', out);
    copyIfSet(source, 'pub_port', out);
    copyIfSet(source, 'cookie_name', out);
    copyIfSet(source, 'jwt_secret', out);
    copyIfSet(source, 'url_signature_secret', out);
    copyIfSet(source, 'blocked_email_domains', out, 'blockedEmailDomains');
    copyIfSet(source, 'enable_public_folders', out);
    copyIfSet(source, 'is_storage_limited', out);
    copyIfSet(source, 'storage_capacity', out);
    copyIfSet(source, 'static_hosting_domain', out);
    copyIfSet(source, 'static_hosting_domain_alt', out);
    copyIfSet(source, 'private_app_hosting_domain', out);
    copyIfSet(source, 'private_app_hosting_domain_alt', out);
    copyIfSet(source, 'min_pass_length', out);
    copyIfSet(source, 'allow_system_login', out);
    copyIfSet(source, 'allow_all_host_values', out);
    copyIfSet(source, 'allow_no_host_header', out);
    copyIfSet(source, 'allow_nipio_domains', out);
    copyIfSet(source, 'custom_domains_enabled', out);
    copyIfSet(source, 'enable_ip_validation', out);
    copyIfSet(source, 'default_user_group', out);
    copyIfSet(source, 'default_temp_group', out);
    copyIfSet(source, 'api_base_url', out);
    copyIfSet(source, 'origin', out);
    copyIfSet(source, 'contact_email', out, 'support_email');

    // `extensions` in v1 was overloaded — array form = scan dirs, object form
    // = per-extension config bag. JSON.parse keeps only the last declaration
    // per key, so in prod files where both appear we typically only see the
    // object. Promote object-shape entries onto top-level keys (scoped npm
    // names → camelCase: `@heyputer/app-store-and-purchases` → `appStoreAndPurchases`).
    // v1 also had `mod_directories: string[]` with `{repo}/...` placeholders.
    // v2 uses `extensions: string[]` of plain directory paths; post-cutover the
    // only dir that survives is the repo-root `./extensions`, so synthesize that
    // when only the config-bag (object) or mod_directories form is present.
    if ( Array.isArray(source.extensions) ) {
        out.extensions = source.extensions;
    } else if ( source.extensions && typeof source.extensions === 'object' ) {
        for ( const [k, v] of Object.entries(source.extensions) ) {
            const bare = k.split('/').pop() ?? k;
            const camel = bare.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
            if ( out[camel] === undefined ) out[camel] = v;
        }
    }
    if ( out.extensions === undefined && (
        Array.isArray(source.mod_directories) ||
        (source.extensions && typeof source.extensions === 'object')
    ) ) {
        out.extensions = ['./extensions'];
    }

    // Port: http_port → port. Drop string "auto" (v2 requires numeric).
    if ( source.http_port !== undefined && source.http_port !== 'auto' ) {
        out.port = source.http_port;
    } else if ( source.port !== undefined ) {
        out.port = source.port;
    }

    // S3: old flat keys → `s3.s3Config`.
    if ( source.s3_access_key || source.s3_secret_key ) {
        out.s3 = {
            s3Config: {
                endpoint:        source.s3_endpoint ?? '',
                accessKeyId:     source.s3_access_key,
                secretAccessKey: source.s3_secret_key,
                ...(source.s3_region ? { region: source.s3_region } : {}),
            },
        };
    }
    copyIfSet(source, 's3_bucket', out);
    copyIfSet(source, 's3_region', out);

    // Database: prefer services.database.{primary, engine}; else db_* flat.
    const svc = source.services ?? {};
    if ( svc.database ) {
        const db = {};
        if ( svc.database.engine )  db.engine = svc.database.engine;
        if ( svc.database.primary ) {
            for ( const k of ['host', 'port', 'user', 'password', 'database'] ) {
                if ( svc.database.primary[k] !== undefined ) db[k] = svc.database.primary[k];
            }
        }
        if ( svc.database.path ) db.path = svc.database.path;
        if ( Object.keys(db).length ) out.database = db;
    }
    if ( ! out.database && source.db_host ) {
        out.database = {
            engine: 'mysql',
            host:     source.db_host,
            port:     source.db_port,
            user:     source.db_user,
            password: source.db_password,
            database: source.db_database,
        };
    }
    if ( source.read_replica_db ) {
        out.database = out.database ?? { engine: 'mysql' };
        const r = source.read_replica_db;
        out.database.replica = {
            host: r.host, port: r.port, user: r.user, password: r.password, database: r.database,
        };
    }

    // Dynamo (services.dynamo → top-level)
    if ( svc.dynamo ) out.dynamo = svc.dynamo;

    // Email (services.email → email; drop `engine` adapter switch). Fallback
    // to old flat smtp_* fields.
    if ( svc.email ) {
        const { engine: _engine, ...rest } = svc.email;
        out.email = rest;
    } else if ( source.smtp_server || source.smtp_host ) {
        out.email = {
            host:   source.smtp_server ?? source.smtp_host,
            port:   source.smtp_port   ?? source.smpt_port,
            secure: true,
            auth:   { user: source.smtp_username, pass: source.smtp_password },
        };
    }

    // Pager: routing_key → routingKey.
    if ( source.pager?.pagerduty ) {
        const pd = source.pager.pagerduty;
        out.pager = {
            pagerduty: {
                enabled: pd.enabled,
                ...(pd.routing_key ? { routingKey: pd.routing_key } : {}),
            },
        };
    }

    // Captcha
    if ( svc.captcha ) out.captcha = svc.captcha;

    // Homepage GUI bundle promotion (services.puter-homepage.* → top-level).
    if ( svc['puter-homepage'] ) {
        const h = svc['puter-homepage'];
        copyIfSet(h, 'gui_bundle', out);
        copyIfSet(h, 'gui_puterjs_bundle', out);
        copyIfSet(h, 'gui_css', out);
    }

    // Legacy billing consolidation (stripe/offerings/__subs-serve → legacyBilling).
    const legacyBilling = {};
    if ( svc.stripe ) {
        if ( svc.stripe.api_secret )      legacyBilling.api_secret = svc.stripe.api_secret;
        if ( svc.stripe.endpoint_secret ) legacyBilling.endpoint_secret = svc.stripe.endpoint_secret;
    }
    if ( svc['__subs-serve']?.stripe_publishable_key ) {
        legacyBilling.stripe_publishable_key = svc['__subs-serve'].stripe_publishable_key;
    }
    if ( svc.offerings?.price_ids ) legacyBilling.price_ids = svc.offerings.price_ids;
    if ( Object.keys(legacyBilling).length ) out.legacyBilling = legacyBilling;

    // Abuse / clickhouse / cf_file_cache pass through if already top-level.
    if ( source.abuse )         out.abuse = source.abuse;
    if ( source.clickhouse )    out.clickhouse = source.clickhouse;
    if ( source.cf_file_cache ) out.cf_file_cache = source.cf_file_cache;

    // v1 services that became top-level IConfig entries (some with renames).
    if ( svc.oidc )              out.oidc      = svc.oidc;
    if ( svc.wisp )              out.wisp      = svc.wisp;
    if ( svc.peer )              out.peers     = svc.peer;
    if ( svc.broadcast )         out.broadcast = svc.broadcast;
    if ( svc['worker-service'] ) out.workers   = svc['worker-service'];
    if ( svc['entri-service'] )  out.entri     = svc['entri-service'];
    // v1's services.thumbnails wrapped the bucket config in `.bucket` and also
    // carried an unrelated `engine`/`host` pointer to the thumbnail HTTP
    // service. v2's IThumbnailStoreConfig is strictly the bucket — unwrap.
    if ( svc.thumbnails?.bucket ) out.thumbnailStore = svc.thumbnails.bucket;

    // AI / integration providers: v1 kept each under `services.<id>` (plus a
    // top-level `openai` shortcut in some configs). v2 unifies them under
    // `providers[<id>]` and accepts only the canonical camelCase field names
    // on IAIProviderConfig, so we rename the common snake_case aliases here.
    const PROVIDER_IDS = [
        'openai', 'claude', 'gemini', 'mistral', 'groq', 'deepseek',
        'xai', 'openrouter', 'together-ai', 'ollama',
        'elevenlabs', 'aws-polly', 'aws-textract', 'mistral-ocr', 'cloudflare',
        'openai-completion', 'openai-responses',
        'openai-image-generation', 'openai-video-generation',
        'gemini-image-generation', 'gemini-video-generation',
        'together-image-generation', 'together-video-generation',
        'cloudflare-image-generation', 'xai-image-generation',
    ];
    const PROVIDER_RENAMES = [
        ['api_key', 'apiKey'], ['secret_key', 'apiKey'], ['key', 'apiKey'],
        ['api_token', 'apiToken'],
        ['api_base_url', 'apiBaseUrl'],
        ['account_id', 'accountId'],
        ['default_voice_id', 'defaultVoiceId'],
        ['speech_to_speech_model_id', 'speechToSpeechModelId'],
    ];
    const normalizeProvider = (raw) => {
        if ( ! raw || typeof raw !== 'object' ) return raw;
        const p = { ...raw };
        for ( const [from, to] of PROVIDER_RENAMES ) {
            if ( p[from] !== undefined && p[to] === undefined ) p[to] = p[from];
            delete p[from];
        }
        return p;
    };
    const providers = {};
    for ( const id of PROVIDER_IDS ) {
        if ( svc[id] ) providers[id] = normalizeProvider(svc[id]);
    }
    if ( source.openai && providers.openai === undefined ) {
        providers.openai = normalizeProvider(source.openai);
    }
    // Backward-compat fan-out: v1 had a single `openai` / `gemini` / `together-ai`
    // / `xai` entry used for chat + image + video. v2 drivers look up split ids
    // (e.g. `openai-completion`, `openai-image-generation`), so seed each
    // split id from the base id when the split key isn't already set.
    const FAN_OUT = {
        openai:        ['openai-completion', 'openai-responses', 'openai-image-generation', 'openai-video-generation'],
        gemini:        ['gemini-image-generation', 'gemini-video-generation'],
        'together-ai': ['together-image-generation', 'together-video-generation'],
        xai:           ['xai-image-generation'],
    };
    for ( const [base, splits] of Object.entries(FAN_OUT) ) {
        if ( ! providers[base] ) continue;
        for ( const split of splits ) {
            if ( providers[split] === undefined ) providers[split] = providers[base];
        }
    }
    if ( Object.keys(providers).length ) out.providers = providers;

    // Anything left in `services` that we didn't claim above is promoted to
    // top-level (v2's IConfig has no `services` bag). Known consumers that
    // live outside `services` in v2 are listed in `consumedServiceKeys` so
    // we don't double-emit; known-dead v1 services are listed in
    // `droppedServiceKeys` so their data is intentionally discarded.
    const consumedServiceKeys = new Set([
        'database', 'dynamo', 'email', 'captcha', 'puter-homepage',
        'stripe', 'offerings', '__subs-serve',
        'oidc', 'wisp', 'peer', 'broadcast', 'worker-service', 'entri-service',
        'thumbnails',
        ...PROVIDER_IDS,
    ]);
    const droppedServiceKeys = new Set([
        'heap-monitor', 'file-cache', 'telemetry', 'monitor', 'spending',
        'judge0', 'convert-api',
    ]);
    for ( const [k, v] of Object.entries(svc) ) {
        if ( consumedServiceKeys.has(k) || droppedServiceKeys.has(k) ) continue;
        if ( out[k] === undefined ) out[k] = v;
    }

    // Preserve any other top-level keys we haven't explicitly translated
    // (e.g. puter_hosted_data, custom extension configs).
    const handledTop = new Set([
        'config_name', 'env', 'http_port', 'port', 'pub_port', 'domain', 'protocol',
        'blocked_email_domains', 'toConsole', 'is_storage_limited',
        'legacy_token_migrate', 'forwarded', 'cross_origin_isolation',
        'enable_public_folders', 'cookie_name', 'jwt_secret', 'url_signature_secret',
        'extensions', 'mod_directories',
        'db_host', 'db_port', 'db_user', 'db_password', 'db_database',
        'db_waitForConnections', 'db_connectionLimit', 'db_enableKeepAlive',
        'db_queueLimit', 'db_read_replica_wait', 'read_replica_db',
        's3_access_key', 's3_secret_key', 's3_bucket', 's3_region', 's3_endpoint',
        'mailchimp', 'cloudwatch', 'monitor',
        'smtp_server', 'smtp_host', 'smtp_port', 'smpt_port', 'smtp_username', 'smtp_password',
        'max_subdomains_per_user',
        'storage_capacity',
        'static_hosting_domain', 'static_hosting_domain_alt',
        'private_app_hosting_domain', 'private_app_hosting_domain_alt',
        'openai',
        'pager',
        'defaultjs_asset_path',
        'services',
        'server_id', 'id', 'region', 'host',
        'nginx_mode', 'contact_email',
        'api_base_url', 'origin',
        'min_pass_length', 'allow_system_login', 'allow_all_host_values',
        'allow_no_host_header', 'allow_nipio_domains', 'custom_domains_enabled',
        'enable_ip_validation',
        'default_user_group', 'default_temp_group',
        'abuse', 'clickhouse', 'cf_file_cache', 'legacyBilling',
        'providers', 'thumbnailStore',
    ]);
    for ( const [k, v] of Object.entries(source) ) {
        if ( handledTop.has(k) || k === '' ) continue;
        out[k] = v;
    }

    return out;
};
