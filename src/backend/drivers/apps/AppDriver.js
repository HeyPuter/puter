/**
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

import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../../services/metering/consts.js';
import {
    ICON_DATA_URL_MIME_ALLOWLIST,
    isAppIconEndpointUrl,
    isRawBase64ImageString,
    normalizeRawBase64ImageString,
} from '../../util/appIcon.js';
import { resolvePrivateLaunchAccess } from '../../util/privateLaunchAccess.js';
import {
    decodeCursor,
    encodeCursor,
    normalizeLimit,
    normalizeOffset,
} from '../../util/pagination.js';
import {
    validateArrayOfStrings,
    validateBool,
    validateJsonObject,
    validateString,
    validateUrl,
} from '../../util/validation.js';
import { PuterDriver } from '../types.js';

const APP_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const APP_NAME_MAX_LEN = 100;
const APP_TITLE_MAX_LEN = 100;
const APP_DESCRIPTION_MAX_LEN = 7000;

// Index-url uniqueness exemptions: legacy "coming soon" placeholder apps
// that intentionally share the same hosted index_url. Anything starting
// with one of these strings skips the uniqueness check so multiple rows
// can keep that placeholder URL without merging into each other.
const INDEX_URL_UNIQUENESS_EXEMPTION_CANDIDATES = [
    'https://dev-center.puter.com/coming-soon',
];

// Sentinel host for builtin apps. The GUI rewrites index_urls on this
// host to `<gui origin>/builtin/<name>` (see launch_app.js), so rows
// carrying it are reserved for migration-seeded builtins — a user app
// claiming it would load its code same-origin with the desktop.
const BUILTIN_APPS_HOST = 'builtins.namespaces.puter.com';

// Canonical-uid alias namespace. When a user-created app is merged into
// an existing origin-bootstrap row, the source uid is mapped to the
// canonical (kept) uid so any client that still holds the old uid keeps
// resolving to the joined row. TTL keeps abandoned entries from
// accumulating indefinitely.
const APP_UID_ALIAS_KEY_PREFIX = 'app:canonicalUidAlias';
const APP_UID_ALIAS_REVERSE_KEY_PREFIX = 'app:canonicalUidAliasReverse';
const APP_UID_ALIAS_TTL_SECONDS = 60 * 60 * 24 * 90;

const hasIndexUrlUniquenessExemption = (candidates) => {
    for (const candidate of candidates) {
        if (
            INDEX_URL_UNIQUENESS_EXEMPTION_CANDIDATES.find((exception) =>
                candidate.startsWith(exception),
            )
        ) {
            return true;
        }
    }
    return false;
};

/**
 * Driver exposing the `puter-apps` interface.
 *
 * Wraps AppStore with input validation + permission checks.
 * Methods follow the `crud-q` shape client SDKs expect:
 *   create, read, select, update, upsert, delete
 *
 * Permission model:
 *   - Owner (apps.owner_user_id === actor.user.id) has full access
 *   - App actor matching app_owner has full access
 *   - `system:es:write-all-owners` grants blanket write
 *   - `app:uid#<app_uid>:access` grants protected-app access
 */
export class AppDriver extends PuterDriver {
    driverInterface = 'puter-apps';
    // `es:app` is the wire name puter-js sends in `/drivers/call`'s `driver`
    // field. Origin/main registered the service under that exact key; keep
    // it so existing clients + hardcoded permission keys (`service:es\Capp:…`)
    // resolve without a translation layer.
    driverName = 'es:app';
    isDefault = true;

    // Inherited from the pre-v2 `temp.es` / `user.es` policies that lived
    // on permission grants in `hardcoded-permissions.js`. Re-expressed
    // here as subscription-tier overrides — the metering service maps
    // anonymous users to `temp_free` and registered users to `user_free`.
    rateLimit = {
        default: {
            limit: 100,
            window: 10_000,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 100,
                [DEFAULT_TEMP_SUBSCRIPTION]: 50,
            },
        },
    };

    get appStore() {
        return this.stores.app;
    }
    get permService() {
        return this.services.permission;
    }

    // -- Driver methods -----------------------------------------------

    async create({ object, options } = {}) {
        if (!object || typeof object !== 'object') {
            throw new HttpError(400, 'Missing or invalid `object`', {
                legacyCode: 'bad_request',
            });
        }
        const actor = this.#requireActor();
        this.#requireUserOrAppActor(actor);

        const fields = await this.#validateInput(object, { isCreate: true });

        // Puter-hosted index_url handling. Order matches v1 AppES:
        //   1. Refuse if the index_url's subdomain isn't owned by this user.
        //   2. Try to merge into an existing row with the same index_url
        //      (origin-bootstrap takeover, or claiming an unowned row).
        //   3. Otherwise enforce index_url uniqueness so two rows can't
        //      share a hosted URL.
        await this.#ensurePuterSiteSubdomainIsOwned(
            fields.index_url,
            actor.user,
        );
        const joinedApp = await this.#maybeJoinOwnedHostedIndexUrlApp({
            object,
            options,
            user: actor.user,
        });
        if (joinedApp) {
            return joinedApp;
        }
        await this.#ensureIndexUrlNotAlreadyInUse({
            indexUrl: fields.index_url,
        });

        // Name conflict handling
        if (await this.appStore.existsByName(fields.name)) {
            if (options?.dedupe_name) {
                let candidate;
                let i = 0;
                do {
                    const randString = Math.random().toString(36).slice(2, 6);
                    candidate = `${fields.name}-${randString}`;

                    if (i >= 3)
                        throw new HttpError(400, 'Failed to dedupe app name', {
                            legacyCode: 'app_name_already_in_use',
                        });
                    i++;
                } while (await this.appStore.existsByName(candidate));
                fields.name = candidate;
            } else {
                throw new HttpError(
                    400,
                    'An app with this name already exists',
                    { legacyCode: 'app_name_already_in_use' },
                );
            }
        }

        const filetypes = fields.filetype_associations;
        delete fields.filetype_associations;

        // Ownership is passed as a separate, privileged arg — the store
        // filters `owner_user_id` / `app_owner` out of `fields` (both are
        // in READ_ONLY_COLUMNS), so the only way to stamp ownership is
        // through this explicit contract. Keeps any future caller that
        // forwards raw input into `create` from spoofing the owner.
        const app = await this.appStore.create(fields, {
            ownerUserId: actor.user.id,
            appOwner: actor.app?.id ?? null,
        });
        if (filetypes)
            await this.appStore.setFiletypeAssociations(app.id, filetypes);

        this.#emitAppChanged({ app, action: 'created' });

        return this.#toClient(app, actor);
    }

    async read({ uid, id, params = {}, ...rest } = {}) {
        const actor = this.#requireActor();
        const app = await this.#resolve({ uid, id });
        if (!app)
            throw new HttpError(404, 'App not found', {
                legacyCode: 'not_found',
            });

        await this.#checkReadAccess(app, actor);

        // puter-js's `puter.apps.get(name, opts)` packages opts under `params`
        // (see `make_driver_method` / `Apps.get`), so stats options live at
        // `args.params.stats_period` rather than the top level. Accept both
        // shapes for forward-compat with anything that still flattens.
        const stats_period = params.stats_period ?? rest.stats_period;
        const stats_grouping = params.stats_grouping ?? rest.stats_grouping;

        const needsStats =
            params.stats !== false && (stats_period || stats_grouping);

        // Detailed period/grouping is per-app only — skip the batch cache
        // and go straight to the live query. The default (no options) goes
        // through the cached batched path.
        const hasDetailed = Boolean(stats_period || stats_grouping);
        const stats = !needsStats
            ? undefined
            : hasDetailed
              ? await this.appStore.getAppStatsDetailed(app.uid, {
                    period: stats_period,
                    grouping: stats_grouping,
                    createdAt: app.created_at ?? app.timestamp,
                })
              : (await this.appStore.getAppsStats([app.uid])).get(app.uid);

        return this.#toClient(app, actor, { ...params, stats });
    }

    async select(args = {}) {
        const { predicate, params = {} } = args;
        const actor = this.#requireActor();
        this.#requireUserOrAppActor(actor);

        const limit = normalizeLimit(args.limit, { cap: 5000 }) ?? 500;
        const offset = normalizeOffset(args.offset);
        const hasCursor = Object.prototype.hasOwnProperty.call(args, 'cursor');
        const payload = decodeCursor(args.cursor);
        if (payload && offset !== undefined) {
            throw new HttpError(400, 'cursor and offset cannot be combined', {
                legacyCode: 'bad_request',
            });
        }
        const includeTotal = args.includeTotal === true;
        const paginated = hasCursor || offset !== undefined || includeTotal;

        const filters = {};
        // predicate: ['user-can-edit'] → scope to owner
        const ownerScoped =
            Array.isArray(predicate) && predicate[0] === 'user-can-edit';
        if (ownerScoped) {
            filters.ownerUserId = actor.user.id;
        }

        let apps = await this.appStore.list({
            ...filters,
            limit: paginated ? limit + 1 : limit,
            offset,
            afterId: payload?.id !== undefined ? Number(payload.id) : undefined,
        });

        let cursor;
        if (paginated && apps.length > limit) {
            apps = apps.slice(0, limit);
            // The cursor tracks the last fetched row, not the last visible
            // one, so rows hidden by the permission filter below aren't
            // re-scanned on the next page.
            cursor = encodeCursor({ id: Number(apps[apps.length - 1].id) });
        }

        // Resolve protected-app visibility:
        //  1. Cheap local short-circuits (non-protected, self-app, owner).
        //  2. Single batched permission check for whatever's left — one
        //     scan pass covers every remaining app, vs a per-app round
        //     trip through the permission service.
        const needsPermCheck = [];
        const localVisible = new Set();
        for (const app of apps) {
            if (
                !app.protected ||
                actor.app?.uid === app.uid ||
                actor.user?.id === app.owner_user_id
            ) {
                localVisible.add(app);
            } else {
                needsPermCheck.push(app);
            }
        }

        let permGrants;
        if (needsPermCheck.length > 0) {
            try {
                permGrants = await this.permService.checkMany(
                    actor,
                    needsPermCheck.map((a) => `app:uid#${a.uid}:access`),
                );
            } catch {
                permGrants = new Map();
            }
        } else {
            permGrants = new Map();
        }

        const visible = apps.filter(
            (app) =>
                localVisible.has(app) ||
                permGrants.get(`app:uid#${app.uid}:access`),
        );

        // Pre-fetch in parallel:
        //  - per-uid stats (already pipelined inside getAppsStats)
        //  - filetype associations as a single IN-list query (was N queries)
        const [statsByUid, filetypesByAppId] = await Promise.all([
            this.appStore.getAppsStats(visible.map((a) => a.uid)),
            this.appStore.getFiletypeAssociationsByIds(
                visible.map((a) => a.id),
            ),
        ]);

        const items = await Promise.all(
            visible.map((app) =>
                this.#toClient(app, actor, {
                    ...params,
                    stats: statsByUid.get(app.uid),
                    filetypes: filetypesByAppId.get(app.id) ?? [],
                }),
            ),
        );
        if (!paginated) return items;

        let total;
        if (includeTotal) {
            total = ownerScoped
                ? await this.appStore.count({ ownerUserId: actor.user.id })
                : await this.appStore.count({
                      visibleToUserId: actor.user?.id ?? null,
                  });
        }

        return {
            items,
            ...(cursor ? { cursor } : {}),
            ...(total !== undefined ? { total } : {}),
        };
    }

    async update({ uid, id, object } = {}) {
        if (!object || typeof object !== 'object') {
            throw new HttpError(400, 'Missing or invalid `object`', {
                legacyCode: 'bad_request',
            });
        }
        const actor = this.#requireActor();
        this.#requireUserOrAppActor(actor);

        const app = await this.#resolve({ uid, id });
        if (!app)
            throw new HttpError(404, 'App not found', {
                legacyCode: 'not_found',
            });

        await this.#checkWriteAccess(app, actor);

        const fields = await this.#validateInput(object, {
            isCreate: false,
            existing: app,
        });

        // Puter-hosted index_url handling on update — same flow as create
        // but only when the index_url is actually changing. Self-app is
        // excluded from the conflict search via `excludeAppId`.
        if (fields.index_url && fields.index_url !== app.index_url) {
            await this.#ensurePuterSiteSubdomainIsOwned(
                fields.index_url,
                actor.user,
            );
            const joinedApp = await this.#maybeJoinOwnedHostedIndexUrlApp({
                object,
                options: undefined,
                user: actor.user,
                sourceAppUid: app.uid,
                excludeAppId: app.id,
            });
            if (joinedApp) {
                return joinedApp;
            }
            await this.#ensureIndexUrlNotAlreadyInUse({
                indexUrl: fields.index_url,
                excludeAppId: app.id,
            });
        }

        // Name conflict check (only if name is changing)
        if (fields.name && fields.name !== app.name) {
            if (await this.appStore.existsByName(fields.name)) {
                throw new HttpError(
                    409,
                    'An app with this name already exists',
                    { legacyCode: 'conflict' },
                );
            }
        }

        const filetypes = fields.filetype_associations;
        delete fields.filetype_associations;

        const updated = await this.appStore.update(app.id, fields);
        if (filetypes !== undefined) {
            await this.appStore.setFiletypeAssociations(app.id, filetypes);
        }

        this.#emitAppChanged({ app: updated, old_app: app, action: 'updated' });
        if (fields.name && fields.name !== app.name) {
            this.#emitAppRename({
                app: updated,
                old_name: app.name,
                new_name: fields.name,
            });
        }

        return this.#toClient(updated, actor);
    }

    async upsert({ uid, id, object, options } = {}) {
        const existing = uid || id ? await this.#resolve({ uid, id }) : null;
        if (existing) return this.update({ uid: existing.uid, object });
        return this.create({ object, options });
    }

    async delete({ uid, id } = {}) {
        const actor = this.#requireActor();
        this.#requireUserOrAppActor(actor);

        const app = await this.#resolve({ uid, id });
        if (!app)
            throw new HttpError(404, 'App not found', {
                legacyCode: 'not_found',
            });

        if (app.protected) {
            throw new HttpError(403, 'Cannot delete a protected app', {
                legacyCode: 'forbidden',
            });
        }

        await this.#checkWriteAccess(app, actor);
        await this.appStore.delete(app.id);

        this.#emitAppChanged({ app: null, old_app: app, action: 'deleted' });

        return { success: true, uid: app.uid };
    }

    // -- Event emission -----------------------------------------------
    //
    // Consumers (AppIconService, future cf-file-cache port, billing
    // event handlers) key off `app_uid`; the full `app` / `old_app`
    // payload lets cache invalidators compute exact origins.

    #emitAppChanged({ app, old_app, action }) {
        const app_uid = app?.uid ?? old_app?.uid;
        if (!app_uid) return;
        try {
            this.clients.event.emit(
                'app.changed',
                { app_uid, app, old_app, action },
                {},
            );
        } catch {
            // Non-critical.
        }
    }

    #emitAppRename({ app, old_name, new_name }) {
        try {
            this.clients.event.emit(
                'app.rename',
                {
                    app_uid: app.uid,
                    old_name,
                    new_name,
                    app,
                },
                {},
            );
        } catch {
            // Non-critical.
        }
    }

    // -- Public helpers (used by AppController) ----------------------

    /** Check if an app name is available. Mirrors the REST endpoint behaviour. */
    async isNameAvailable(name) {
        validateString(name, {
            key: 'name',
            maxLen: APP_NAME_MAX_LEN,
            regex: APP_NAME_REGEX,
        });
        return !(await this.appStore.existsByName(name));
    }

    // -- Validation ---------------------------------------------------

    async #validateInput(object, { isCreate, existing }) {
        const out = {};

        if (isCreate || object.name !== undefined) {
            out.name = validateString(object.name, {
                key: 'name',
                maxLen: APP_NAME_MAX_LEN,
                regex: APP_NAME_REGEX,
                required: isCreate,
            });
        }
        if (isCreate || object.title !== undefined) {
            out.title = validateString(object.title, {
                key: 'title',
                maxLen: APP_TITLE_MAX_LEN,
                required: isCreate,
            });
        }
        if (object.description !== undefined) {
            out.description = validateString(object.description, {
                key: 'description',
                maxLen: APP_DESCRIPTION_MAX_LEN,
                required: false,
                allowEmpty: true,
            });
        }
        if (isCreate || object.index_url !== undefined) {
            out.index_url = validateUrl(object.index_url, {
                key: 'index_url',
                maxLen: 3000,
                required: isCreate,
            });
            // Only enforce on new/changed values so rows that already
            // carry a reserved host (migration-seeded builtins) can still
            // have their other fields updated.
            if (
                out.index_url !== undefined &&
                out.index_url !== existing?.index_url
            ) {
                this.#assertIndexUrlHostAllowed(out.index_url);
            }
        }
        if (object.icon !== undefined) {
            validateString(object.icon, {
                key: 'icon',
                maxLen: 5 * 1024 * 1024,
                required: false,
                allowEmpty: true,
            });
            let iconStr = object.icon;
            // Accepted shapes (mirrors v1's `image-base64` proptype so
            // puter-js callers keep working):
            //   1. Empty string — unset
            //   2. Raw base64 (no prefix) — normalized to a PNG data URL
            //   3. `data:image/<mime>;…` with an allow-listed MIME
            //   4. `/app-icon/<uid>` endpoint URL (relative, or absolute
            //      on a host we control)
            // Anything else (including arbitrary http(s) URLs) is rejected:
            // the unauthenticated GET /app-icon/:uid would otherwise 302
            // there and turn this endpoint into a Puter-branded open
            // redirector (cached publicly for 15 min).
            if (iconStr && iconStr.length > 0) {
                // Raw base64 → wrap as data URL (v1 parity)
                if (isRawBase64ImageString(iconStr)) {
                    iconStr = normalizeRawBase64ImageString(iconStr);
                } else if (iconStr.startsWith('data:')) {
                    const semi = iconStr.indexOf(';');
                    const comma = iconStr.indexOf(',');
                    const mimeEnd =
                        semi !== -1 && (comma === -1 || semi < comma)
                            ? semi
                            : comma;
                    const mime =
                        mimeEnd !== -1
                            ? iconStr.slice(5, mimeEnd).toLowerCase()
                            : '';
                    if (!ICON_DATA_URL_MIME_ALLOWLIST.includes(mime)) {
                        throw new HttpError(
                            400,
                            '`icon` data URL must use an image MIME type',
                            { legacyCode: 'bad_request' },
                        );
                    }
                } else if (!isAppIconEndpointUrl(iconStr, this.config)) {
                    throw new HttpError(
                        400,
                        '`icon` must be base64, a data:image/… URL, or an app-icon endpoint URL',
                        { legacyCode: 'bad_request' },
                    );
                }
            }
            out.icon = iconStr;
        }
        if (object.maximize_on_start !== undefined) {
            out.maximize_on_start = validateBool(object.maximize_on_start, {
                key: 'maximize_on_start',
            })
                ? 1
                : 0;
        }
        if (object.background !== undefined) {
            out.background = validateBool(object.background, {
                key: 'background',
            })
                ? 1
                : 0;
        }
        if (object.metadata !== undefined) {
            const meta = validateJsonObject(object.metadata, {
                key: 'metadata',
            });
            out.metadata = JSON.stringify(meta);
        }
        if (object.filetype_associations) {
            out.filetype_associations = validateArrayOfStrings(
                object.filetype_associations,
                {
                    key: 'filetype_associations',
                },
            );
        }

        return out;
    }

    /**
     * App iframes run with `allow-same-origin allow-scripts`, so an
     * index_url loading from the GUI host would execute third-party code
     * same-origin with the desktop — a full sandbox escape. The API host
     * is reserved for the same reason, and the builtin sentinel host is
     * rewritten by the GUI to `<gui origin>/builtin/…` (see
     * BUILTIN_APPS_HOST above). Host comparison (rather than full origin)
     * deliberately also catches scheme/port variants of these hosts.
     */
    #assertIndexUrlHostAllowed(indexUrl) {
        let hostname;
        try {
            hostname = new URL(indexUrl).hostname;
        } catch {
            // Unparseable values are rejected by `validateUrl` upstream.
            return;
        }

        const config = this.config ?? {};
        const reserved = new Set([BUILTIN_APPS_HOST]);
        // `origin`/`api_base_url` are computed at boot from `domain`; the
        // domain-based fallbacks cover callers (tests, embedders) that
        // construct a server without that normalization step.
        const candidates = [config.origin, config.api_base_url];
        if (config.domain) {
            candidates.push(
                `http://${config.domain}`,
                `http://api.${config.domain}`,
            );
        }
        for (const candidate of candidates) {
            if (!candidate) continue;
            try {
                reserved.add(new URL(candidate).hostname);
            } catch {
                // Malformed config value — nothing to reserve from it.
            }
        }

        if (reserved.has(hostname)) {
            throw new HttpError(
                400,
                '`index_url` cannot point at a Puter system host',
                { legacyCode: 'bad_request' },
            );
        }
    }

    // -- Permission checks --------------------------------------------

    #requireActor() {
        const actor = Context.get('actor');
        if (!actor)
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });
        return actor;
    }

    #requireUserOrAppActor(actor) {
        if (!actor.user)
            throw new HttpError(403, 'User actor required', {
                legacyCode: 'forbidden',
            });
    }

    async #resolve({ uid, id }) {
        if (uid) return this.#getByUidWithAlias(uid);
        if (id?.uid) return this.#getByUidWithAlias(id.uid);
        if (id?.name) return this.appStore.getByName(id.name);
        if (id?.id) return this.appStore.getById(id.id);
        if (typeof id === 'number') return this.appStore.getById(id);
        if (typeof id === 'string') return this.#getByUidWithAlias(id);
        return null;
    }

    /**
     * uid lookup with canonical-uid alias fallback. When two app rows
     * have been merged (see {@link #maybeJoinOwnedHostedIndexUrlApp}),
     * the source uid is recorded as an alias to the canonical uid. A
     * direct uid miss therefore re-queries with the canonical uid so
     * any client still holding the old uid keeps resolving to the
     * joined row. Mirrors v1 AppES's `#read` alias plumbing.
     *
     * The alias query is fired in parallel with the direct lookup so
     * the common (no-alias) case pays only one round-trip.
     */
    async #getByUidWithAlias(uid) {
        const aliasPromise = this.#readCanonicalAppUidAlias(uid);
        const direct = await this.appStore.getByUid(uid);
        if (direct) return direct;
        const canonicalUid = await aliasPromise;
        if (
            typeof canonicalUid === 'string' &&
            canonicalUid &&
            canonicalUid !== uid
        ) {
            return this.appStore.getByUid(canonicalUid);
        }
        return null;
    }

    async #canReadApp(app, actor) {
        if (!app.protected) return true;
        // Self-app access
        if (actor.app?.uid === app.uid) return true;
        // Owner access
        if (actor.user?.id === app.owner_user_id) return true;
        // Permission check
        try {
            return await this.permService.check(
                actor,
                `app:uid#${app.uid}:access`,
            );
        } catch {
            return false;
        }
    }

    async #checkReadAccess(app, actor) {
        if (await this.#canReadApp(app, actor)) return;
        throw new HttpError(403, 'Access denied', { legacyCode: 'forbidden' });
    }

    async #checkWriteAccess(app, actor) {
        // App actor matching app_owner
        let hasAccess = false;
        if (!actor.app?.id) {
            hasAccess = actor.user?.id === app.owner_user_id;
        } else if (actor.app.id === app.app_owner) {
            hasAccess = actor.user?.id === app.owner_user_id;
        }
        // System-wide write
        if (!hasAccess) {
            hasAccess = await this.permService.check(
                actor,
                'system:es:write-all-owners',
            );
        }
        if (!hasAccess) {
            throw new HttpError(403, 'Access denied', {
                legacyCode: 'forbidden',
            });
        }
    }

    // -- Serialization ------------------------------------------------

    /**
     * Resolve the canonical app row that backs `app.index_url`.
     *
     * Returns `{ origin, expectedUid, canonicalApp }`:
     *   - `origin`    — the parsed origin string from `index_url`.
     *   - `expectedUid` — the canonical app uid for that origin (oldest
     *     `apps.index_url` match, or a deterministic UUIDv5 fallback for
     *     unknown origins).
     *   - `canonicalApp` — the actual `apps` row at `expectedUid`, or
     *     `null` when the uid is a UUIDv5 fallback with no DB row.
     *
     * Used in `#toClient` for two things:
     *   1. `created_from_origin` derivation (only set when
     *      `expectedUid === app.uid`, mirroring v1 AppES).
     *   2. The canonical-private gate — when `expectedUid !== app.uid`
     *      and `canonicalApp.is_private`, the row is squatting on
     *      someone else's private hosted URL. We must run the
     *      privateAccess gate against the *canonical* row, not the
     *      possibly-public squatter row, otherwise pre-existing data
     *      from before the `subdomain_not_owned` check leaks the
     *      victim's index_url.
     *
     * Returns `null` when there's no `index_url` or it doesn't parse.
     */
    async #resolveCanonicalForIndexUrl(app) {
        if (!app.index_url) return null;
        let origin;
        try {
            const parsed = new URL(app.index_url);
            origin = `${parsed.protocol}//${parsed.hostname}${
                parsed.port ? `:${parsed.port}` : ''
            }`;
        } catch {
            return null;
        }
        try {
            const expectedUid =
                await this.services.auth.appUidFromOrigin(origin);
            // Avoid a needless DB hit on the self-match common case —
            // `app` is already the row we'd be re-fetching.
            const canonicalApp =
                expectedUid && expectedUid !== app.uid
                    ? await this.appStore.getByUid(expectedUid)
                    : app;
            return { origin, expectedUid, canonicalApp };
        } catch {
            return null;
        }
    }

    /**
     * Launch-safety check for puter-hosted `index_url`s.
     *
     * A hosted subdomain (`*.<hosting-domain>`) can be deleted by its owner
     * and then re-registered by anyone else, but the app row keeps the stale
     * URL — nothing rewrites it on subdomain deletion. Without this check the
     * desktop would build the app iframe on a now-reclaimable origin and
     * append the launch token to it (the GUI launcher appends
     * `puter.auth.token` to the index_url), handing a valid token to whoever
     * controls that subdomain today.
     *
     * Returns true when the app's hosted subdomain is missing, or is
     * currently owned by a different user than the app's owner. Non-hosted
     * index_urls (a developer's own external domain, builtins) return false:
     * we don't manage their DNS and can't reason about their ownership.
     */
    async #hostedIndexUrlBackingIsUnavailable(app) {
        const subdomain = this.#extractPuterHostedSubdomain(app.index_url);
        if (!subdomain) return false;

        let row = await this.stores.subdomain.getBySubdomain(subdomain);
        if (!row) {
            // A freshly-created subdomain may not have reached a replica or
            // the local cache yet; confirm against the primary before
            // treating the backing as gone (mirrors the create/update
            // ownership check in `#ensurePuterSiteSubdomainIsOwned`).
            row = await this.stores.subdomain.getBySubdomain(subdomain, {
                primary: true,
            });
        }
        if (!row) return true; // subdomain no longer exists → dangling

        const appOwnerId = Number(app.owner_user_id);
        const subdomainOwnerId = Number(row.user_id);
        if (
            !Number.isInteger(appOwnerId) ||
            !Number.isInteger(subdomainOwnerId)
        ) {
            return true;
        }
        // Subdomain exists but belongs to someone other than the app owner —
        // it was reclaimed; launching would leak the token to the new owner.
        return subdomainOwnerId !== appOwnerId;
    }

    /**
     * Public wrapper over the authoritative client serializer. Callers
     * outside the driver (e.g. the homepage shell baking app metadata into
     * the rendered GUI) must never embed a raw store row — it carries
     * `owner_user_id`, admin flags, and the private `index_url`. This
     * projects the safe field subset and applies the private-app
     * `index_url` gate for `actor`, which may be null for an anonymous
     * request.
     *
     * @param {Record<string, unknown>} app - raw app store row
     * @param {any} [actor] - request actor, or null when anonymous
     * @param {Record<string, unknown>} [params]
     */
    async toClientView(app, actor = null, params = {}) {
        return this.#toClient(app, actor, params);
    }

    async #toClient(app, actor, params = {}) {
        if (!app) return null;

        // `select` pre-fetches filetypes for every visible app in one
        // batched query and threads them through `params.filetypes` to
        // avoid the N+1 in this hot loop. Single-app callers (`read`,
        // `create`, `update`) fall back to the per-app query.
        const [filetypes, canonicalForIndexUrl, hostedBackingUnavailable] =
            await Promise.all([
                params.filetypes !== undefined
                    ? Promise.resolve(params.filetypes)
                    : this.appStore.getFiletypeAssociations(app.id),
                this.#resolveCanonicalForIndexUrl(app),
                this.#hostedIndexUrlBackingIsUnavailable(app),
            ]);

        const createdFromOrigin =
            canonicalForIndexUrl && canonicalForIndexUrl.expectedUid === app.uid
                ? canonicalForIndexUrl.origin
                : null;

        const result = {
            uid: app.uid,
            name: app.name,
            title: app.title,
            description: app.description,
            icon: app.icon,
            index_url: app.index_url,
            background: Boolean(app.background),
            maximize_on_start: Boolean(app.maximize_on_start),
            godmode: Boolean(app.godmode),
            is_private: Boolean(app.is_private),
            protected: Boolean(app.protected),
            approved_for_listing: Boolean(app.approved_for_listing),
            approved_for_opening_items: Boolean(app.approved_for_opening_items),
            approved_for_incentive_program: Boolean(
                app.approved_for_incentive_program,
            ),
            metadata: app.metadata ?? null,
            filetype_associations: filetypes,
            created_at: app.created_at ?? app.timestamp,
            created_from_origin: createdFromOrigin,
            stats: params.stats ?? null,
        };

        // Owner info — only expose if actor is the owner or has access
        if (actor?.user?.id === app.owner_user_id) {
            result.owner = {
                username: actor.user.username,
                uuid: actor.user.uuid,
            };
        }

        // Icon sizing hook (for future AppIconService integration)
        if (params.icon_size) {
            result.icon_size = params.icon_size;
        }

        // Private-app gate: callers without an ownership / purchase / grant
        // must not receive `index_url` (the direct hosting URL). They still
        // see metadata (title, icon, description) so the marketplace UI can
        // render a purchase CTA. Owners + entitled users pass through
        // unchanged. Attach `privateAccess` so clients know to redirect to
        // app-center rather than launch.
        //
        // Gate target picking:
        //   1. Canonical mismatch + canonical is private → gate against
        //      the *canonical* row. Catches pre-existing bug data where
        //      a row's `index_url` points at someone else's private hosted
        //      URL but the row itself has `is_private = 0`. The
        //      authoritative privacy decision belongs to the canonical
        //      row's owner, not the squatter.
        //   2. Otherwise, if this row is itself private → gate against
        //      this row (the legitimate path).
        //   3. Otherwise no gate — public app, no entitlement check.
        const canonicalApp = canonicalForIndexUrl?.canonicalApp ?? null;
        const expectedUid = canonicalForIndexUrl?.expectedUid;
        const canonicalMismatchPrivate =
            !!expectedUid &&
            expectedUid !== app.uid &&
            !!canonicalApp?.is_private;
        const gateTarget = canonicalMismatchPrivate
            ? canonicalApp
            : result.is_private
              ? app
              : null;
        if (gateTarget) {
            const isOwner =
                actor?.user?.id !== undefined &&
                actor.user.id === gateTarget.owner_user_id;
            const privateAccess = isOwner
                ? { hasAccess: true, checkedBy: 'core/app-owner' }
                : await resolvePrivateLaunchAccess({
                      app: {
                          uid: gateTarget.uid,
                          name: gateTarget.name,
                          is_private: true,
                      },
                      eventClient: this.clients.event,
                      userUid: actor?.user?.uuid ?? null,
                      source: canonicalMismatchPrivate
                          ? 'appDriver:toClient:canonical-private'
                          : 'appDriver:toClient',
                      args: {},
                  });
            result.privateAccess = privateAccess;
            if (!privateAccess.hasAccess) {
                delete result.index_url;
            }
        }

        // Hosted-subdomain launch guard (independent of the private-app
        // gate): deny launch when the app's puter-hosted backing is gone or
        // has been reclaimed by another user, so the GUI never appends the
        // launch token to an origin the app owner no longer controls. Empty
        // `fallbackAppName` keeps the launcher from redirecting to
        // app-center — this isn't an entitlement problem, the backing is
        // simply unavailable. Only set when not already denied so a private
        // app's existing decision is preserved.
        if (
            hostedBackingUnavailable &&
            result.privateAccess?.hasAccess !== false
        ) {
            result.privateAccess = {
                hasAccess: false,
                fallbackAppName: '',
                reason: 'hosted_backing_unavailable',
                checkedBy: 'core/hosted-subdomain-guard',
            };
        }

        return result;
    }

    // -- Puter-hosted index_url merge logic ---------------------------
    //
    // Ported from v1 AppES (`#maybeJoinOwnedHostedIndexUrlAppOnCreate`,
    // `#ensure_puter_site_subdomain_is_owned`, `#ensureIndexUrlNotAlreadyInUse`,
    // and the `app:canonicalUidAlias:*` kvstore pair). When a user creates
    // or repoints an app at a puter-hosted subdomain (`*.puter.site`,
    // `*.puter.app`, …) — or at a custom host claimed by an
    // `app_origin_aliases` group — we want exactly one app row to back
    // that URL:
    //   • If a no-owner row exists (origin-bootstrap stub auto-created
    //     when an unknown origin first hit Puter) → claim it for the
    //     user, merge the new fields into it.
    //   • If the same user already has an origin-bootstrap row at that
    //     URL → merge into it; otherwise reject as a duplicate.
    //   • If a different user owns the row → reject with
    //     `app_index_url_already_in_use`.
    // Source uid (when called from `update`) is recorded in a kvstore
    // alias so `#resolve` can redirect old uids to the canonical row.

    #normalizeConfiguredHostedDomain(domainValue) {
        if (typeof domainValue !== 'string') return null;
        const normalizedDomain = domainValue
            .trim()
            .toLowerCase()
            .replace(/^\./, '');
        if (!normalizedDomain) return null;
        return normalizedDomain.split(':')[0] || null;
    }

    #getPuterHostedDomains() {
        const domains = new Set();
        const config = this.config ?? {};
        for (const configuredDomain of [
            config.static_hosting_domain,
            config.static_hosting_domain_alt,
            config.private_app_hosting_domain,
            config.private_app_hosting_domain_alt,
        ]) {
            const normalized =
                this.#normalizeConfiguredHostedDomain(configuredDomain);
            if (normalized) domains.add(normalized);
        }
        return [...domains];
    }

    #extractPuterHostedSubdomain(indexUrl) {
        if (typeof indexUrl !== 'string' || !indexUrl) return null;

        let hostname;
        try {
            hostname = new URL(indexUrl).hostname.toLowerCase();
        } catch {
            return null;
        }

        // Sort longest-first so `foo.puter.app` matches `puter.app` (not
        // a shorter `app` if it ever appeared in the configured list).
        const hostedDomains = this.#getPuterHostedDomains().sort(
            (a, b) => b.length - a.length,
        );

        for (const hostedDomain of hostedDomains) {
            const suffix = `.${hostedDomain}`;
            if (hostname.endsWith(suffix)) {
                const subdomain = hostname.slice(
                    0,
                    hostname.length - suffix.length,
                );
                return subdomain || null;
            }
        }

        return null;
    }

    #isPuterHostedIndexUrl(indexUrl) {
        return !!this.#extractPuterHostedSubdomain(indexUrl);
    }

    /**
     * Read normalized origin-alias groups from config. Each group is a deduped
     * list of lowercased, trimmed bare hosts. Malformed entries are skipped so
     * a bad config row doesn't brick app create/update for everyone else.
     */
    #getOriginAliasGroups() {
        const config = this.config ?? {};
        const raw = config.app_origin_aliases;
        if (!Array.isArray(raw)) return [];

        const groups = [];
        for (const group of raw) {
            if (!Array.isArray(group)) continue;
            const normalized = [
                ...new Set(
                    group
                        .filter((h) => typeof h === 'string')
                        .map((h) => h.trim().toLowerCase())
                        .filter((h) => h.length > 0),
                ),
            ];
            if (normalized.length > 0) groups.push(normalized);
        }
        return groups;
    }

    /**
     * Return the alias group containing this index_url's host, or null when
     * the host isn't claimed by any group.
     */
    #findOriginAliasGroupForIndexUrl(indexUrl) {
        if (typeof indexUrl !== 'string' || !indexUrl) return null;
        let hostname;
        try {
            hostname = new URL(indexUrl).hostname.toLowerCase();
        } catch {
            return null;
        }
        for (const group of this.#getOriginAliasGroups()) {
            if (group.includes(hostname)) return group;
        }
        return null;
    }

    /**
     * Generate the set of equivalent index_url strings that should
     * collide with a given input. We only collapse trailing-slash and
     * `/index.html` variants — the underlying `apps.index_url` column
     * is matched by exact string, so anything not in this list won't
     * be deduped. Mirrors v1 AppES exactly.
     */
    #buildEquivalentIndexUrlCandidates(indexUrl) {
        if (typeof indexUrl !== 'string' || !indexUrl.trim()) {
            return [];
        }

        try {
            const parsed = new URL(indexUrl);
            const origin = `${parsed.protocol}//${parsed.host.toLowerCase()}`;
            const pathname = parsed.pathname || '/';

            const candidates = new Set();
            if (pathname === '/' || pathname.toLowerCase() === '/index.html') {
                candidates.add(origin);
                candidates.add(`${origin}/`);
                candidates.add(`${origin}/index.html`);
            } else {
                const normalizedPath = pathname.endsWith('/')
                    ? pathname.slice(0, -1)
                    : pathname;
                candidates.add(`${origin}${normalizedPath}`);
                candidates.add(`${origin}${normalizedPath}/`);
            }

            return [...candidates];
        } catch {
            return [indexUrl.trim()];
        }
    }

    async #findIndexUrlConflictRow({ indexUrl, excludeAppId } = {}) {
        const aliasGroup = this.#findOriginAliasGroupForIndexUrl(indexUrl);
        if (!this.#isPuterHostedIndexUrl(indexUrl) && !aliasGroup) return null;

        const candidates = new Set(
            this.#buildEquivalentIndexUrlCandidates(indexUrl),
        );

        // For alias-group hosts, treat the group as a host-level reservation:
        // any row whose index_url is the root URL of any group member counts
        // as a conflict, so a single app owns the whole group.
        if (aliasGroup) {
            for (const host of aliasGroup) {
                for (const proto of ['https', 'http']) {
                    const base = `${proto}://${host}`;
                    candidates.add(base);
                    candidates.add(`${base}/`);
                    candidates.add(`${base}/index.html`);
                }
            }
        }

        if (candidates.size === 0) return null;
        const candidateList = [...candidates];
        if (hasIndexUrlUniquenessExemption(candidateList)) return null;

        return this.appStore.findByIndexUrlCandidates(candidateList, {
            excludeAppId,
        });
    }

    async #ensureIndexUrlNotAlreadyInUse({ indexUrl, excludeAppId } = {}) {
        const conflictRow = await this.#findIndexUrlConflictRow({
            indexUrl,
            excludeAppId,
        });
        if (conflictRow) {
            throw new HttpError(400, 'App index_url already in use', {
                legacyCode: 'app_index_url_already_in_use',
                fields: {
                    index_url: indexUrl,
                    app_uid: conflictRow.uid,
                },
            });
        }
    }

    async #ensurePuterSiteSubdomainIsOwned(indexUrl, user) {
        if (!user) return;
        const subdomain = this.#extractPuterHostedSubdomain(indexUrl);
        if (!subdomain) return;

        let row = await this.stores.subdomain.getBySubdomain(subdomain);
        if (!row) {
            // Deploys create the subdomain and immediately point the app
            // at it, so a replica or peer-cache miss here would wrongly
            // refuse the owner. Confirm against the primary before failing.
            row = await this.stores.subdomain.getBySubdomain(subdomain, {
                primary: true,
            });
        }
        if (!row || row.user_id !== user.id) {
            throw new HttpError(400, 'Subdomain not owned by user', {
                legacyCode: 'subdomain_not_owned',
                fields: { subdomain },
            });
        }
    }

    /**
     * Origin-bootstrap detection: rows auto-created when an unknown
     * origin first needed an app row (no human-supplied metadata).
     * Marker is `name === uid && title === uid` and a description
     * starting with "App created from origin ". Only these rows are
     * eligible for same-owner merging — refusing to merge arbitrary
     * same-owner apps prevents accidental data loss.
     */
    #isOriginBootstrapApp(app) {
        if (!app || typeof app !== 'object') return false;
        if (typeof app.uid !== 'string' || !app.uid) return false;
        if (app.name !== app.uid) return false;
        if (app.title !== app.uid) return false;
        if (typeof app.description !== 'string') return false;
        return app.description.startsWith('App created from origin ');
    }

    // -- Canonical-uid alias kvstore pair -----------------------------
    //
    // After a merge, the source app uid → canonical uid mapping is
    // kept in `stores.kv` (system namespace) so any client that still
    // holds the old uid keeps resolving to the joined row via
    // `#getByUidWithAlias`. Reverse map lets callers enumerate aliases
    // for a canonical uid (matches v1 plumbing).

    #buildCanonicalAppUidAliasKey(oldAppUid) {
        return `${APP_UID_ALIAS_KEY_PREFIX}:${oldAppUid}`;
    }

    #buildCanonicalAppUidAliasReverseKey(canonicalAppUid) {
        return `${APP_UID_ALIAS_REVERSE_KEY_PREFIX}:${canonicalAppUid}`;
    }

    #normalizeCanonicalAliasUidList(value) {
        if (!Array.isArray(value)) return [];
        const out = [];
        const seen = new Set();
        for (const item of value) {
            if (typeof item !== 'string' || !item) continue;
            if (seen.has(item)) continue;
            seen.add(item);
            out.push(item);
        }
        return out;
    }

    async #readCanonicalAppUidAlias(oldAppUid) {
        if (typeof oldAppUid !== 'string' || !oldAppUid) return null;
        const key = this.#buildCanonicalAppUidAliasKey(oldAppUid);
        try {
            const { res } = await this.stores.kv.get({ key });
            if (typeof res === 'string' && res) return res;
        } catch {
            // Alias reads are best-effort.
        }
        return null;
    }

    async #writeCanonicalAppUidAlias({ oldAppUid, canonicalAppUid }) {
        if (typeof oldAppUid !== 'string' || !oldAppUid) return;
        if (typeof canonicalAppUid !== 'string' || !canonicalAppUid) return;
        if (oldAppUid === canonicalAppUid) return;

        const key = this.#buildCanonicalAppUidAliasKey(oldAppUid);
        const reverseKey =
            this.#buildCanonicalAppUidAliasReverseKey(canonicalAppUid);
        const expireAt =
            Math.floor(Date.now() / 1000) + APP_UID_ALIAS_TTL_SECONDS;
        try {
            const { res: reverseValue } = await this.stores.kv.get({
                key: reverseKey,
            });
            const reverseAliases =
                this.#normalizeCanonicalAliasUidList(reverseValue);
            if (!reverseAliases.includes(oldAppUid)) {
                reverseAliases.push(oldAppUid);
            }

            await this.stores.kv.set({
                key,
                value: canonicalAppUid,
                expireAt,
            });
            await this.stores.kv.set({
                key: reverseKey,
                value: reverseAliases,
                expireAt,
            });
        } catch {
            // Alias writes are best-effort.
        }
    }

    /**
     * Merge an incoming create/update into an existing app row that
     * already owns the same puter-hosted or alias-group index_url.
     * Returns the joined
     * (client-shaped) app on success, or `null` when no merge applied.
     * Throws `app_index_url_already_in_use` when a conflict exists but
     * cannot be merged (different owner, or same-owner non-bootstrap).
     *
     * `sourceAppUid` is set when called from update — when present and
     * different from the conflict row's uid, the source row is deleted
     * and an alias is recorded so old-uid clients keep resolving.
     */
    async #maybeJoinOwnedHostedIndexUrlApp({
        object,
        options,
        user,
        sourceAppUid,
        excludeAppId,
    } = {}) {
        const indexUrl = object?.index_url;
        // Alias-group hosts (`app_origin_aliases`) get the same merge
        // treatment as puter-hosted subdomains. Without this, a bootstrap
        // stub on a custom domain could never be absorbed — and since
        // `#findIndexUrlConflictRow` *does* honor alias groups, the
        // uniqueness check below would hard-reject the owner's own
        // create/update instead of merging into the stub.
        if (
            !this.#isPuterHostedIndexUrl(indexUrl) &&
            !this.#findOriginAliasGroupForIndexUrl(indexUrl)
        ) {
            return null;
        }

        const conflictRow = await this.#findIndexUrlConflictRow({
            indexUrl,
            excludeAppId,
        });
        if (!conflictRow) return null;

        const conflictOwnerUserId = Number(conflictRow.owner_user_id);
        if (
            Number.isInteger(conflictOwnerUserId) &&
            conflictOwnerUserId > 0 &&
            conflictOwnerUserId !== user.id
        ) {
            throw new HttpError(400, 'App index_url already in use', {
                legacyCode: 'app_index_url_already_in_use',
                fields: {
                    index_url: indexUrl,
                    app_uid: conflictRow.uid,
                },
            });
        }

        // Unowned (origin-bootstrap) row → claim it before merging.
        if (
            !Number.isInteger(conflictOwnerUserId) ||
            conflictOwnerUserId <= 0
        ) {
            await this.appStore.claimOwnership(conflictRow.id, user.id);
        }

        const appToJoin = await this.appStore.getByUid(conflictRow.uid);
        if (!appToJoin || appToJoin.uid !== conflictRow.uid) {
            throw new HttpError(400, 'App index_url already in use', {
                legacyCode: 'app_index_url_already_in_use',
                fields: {
                    index_url: indexUrl,
                    app_uid: conflictRow.uid,
                },
            });
        }
        if (appToJoin.owner_user_id !== user.id) {
            throw new HttpError(400, 'App index_url already in use', {
                legacyCode: 'app_index_url_already_in_use',
                fields: {
                    index_url: indexUrl,
                    app_uid: conflictRow.uid,
                },
            });
        }
        if (
            Number.isInteger(conflictOwnerUserId) &&
            conflictOwnerUserId === user.id &&
            !this.#isOriginBootstrapApp(appToJoin)
        ) {
            // Prevent merging arbitrary same-owner apps; only allow the
            // auto-created origin bootstrap row to be absorbed.
            throw new HttpError(400, 'App index_url already in use', {
                legacyCode: 'app_index_url_already_in_use',
                fields: {
                    index_url: indexUrl,
                    app_uid: conflictRow.uid,
                },
            });
        }

        // Build the joined input. Pass the original (unvalidated)
        // object through the recursive `update` so its `#validateInput`
        // re-runs cleanly — `fields` is post-validation (stringified
        // metadata, 0/1 bools) and would fail a second pass.
        const joinedObject = { ...object };
        const requestedJoinedName =
            (typeof joinedObject.name === 'string'
                ? joinedObject.name.trim()
                : '') || null;
        const shouldReapplyRequestedNameAfterMerge =
            !!sourceAppUid && !!requestedJoinedName;
        // When called from update, defer the rename until after the
        // source row is deleted — otherwise the rename would collide
        // with the still-existing source app's name.
        if (sourceAppUid && joinedObject.name !== undefined) {
            delete joinedObject.name;
        }

        let joinedApp = await this.update({
            uid: appToJoin.uid,
            object: joinedObject,
            options,
        });

        if (sourceAppUid && sourceAppUid !== appToJoin.uid) {
            await this.#writeCanonicalAppUidAlias({
                oldAppUid: sourceAppUid,
                canonicalAppUid: appToJoin.uid,
            });
            const sourceApp = await this.appStore.getByUid(sourceAppUid);
            if (sourceApp) {
                await this.appStore.delete(sourceApp.id);
                this.#emitAppChanged({
                    app: null,
                    old_app: sourceApp,
                    action: 'deleted',
                });
            }
        }

        if (shouldReapplyRequestedNameAfterMerge) {
            joinedApp = await this.update({
                uid: appToJoin.uid,
                object: { name: requestedJoinedName },
                options,
            });
        }

        return joinedApp;
    }
}
