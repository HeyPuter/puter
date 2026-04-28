import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import {
    ICON_DATA_URL_MIME_ALLOWLIST,
    isAppIconEndpointUrl,
    isRawBase64ImageString,
    normalizeRawBase64ImageString,
} from '../../util/appIcon.js';
import { resolvePrivateLaunchAccess } from '../../util/privateLaunchAccess.js';
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

    get appStore() {
        return this.stores.app;
    }
    get permService() {
        return this.services.permission;
    }

    // ── Driver methods ───────────────────────────────────────────────

    async create({ object, options } = {}) {
        if (!object || typeof object !== 'object') {
            throw new HttpError(400, 'Missing or invalid `object`');
        }
        const actor = this.#requireActor();
        this.#requireUserOrAppActor(actor);

        const fields = await this.#validateInput(object, { isCreate: true });

        // Name conflict handling
        if (await this.appStore.existsByName(fields.name)) {
            if (options?.dedupe_name) {
                let candidate;
                let n = 1;
                do {
                    candidate = `${fields.name}-${++n}`;
                    if (n > 50)
                        throw new HttpError(400, 'Failed to dedupe app name');
                } while (await this.appStore.existsByName(candidate));
                fields.name = candidate;
            } else {
                throw new HttpError(
                    400,
                    'An app with this name already exists',
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
        if (!app) throw new HttpError(404, 'App not found');

        await this.#checkReadAccess(app, actor);

        // puter-js's `puter.apps.get(name, opts)` packages opts under `params`
        // (see `make_driver_method` / `Apps.get`), so stats options live at
        // `args.params.stats_period` rather than the top level. Accept both
        // shapes for forward-compat with anything that still flattens.
        const stats_period = params.stats_period ?? rest.stats_period;
        const stats_grouping = params.stats_grouping ?? rest.stats_grouping;

        // Detailed period/grouping is per-app only — skip the batch cache
        // and go straight to the live query. The default (no options) goes
        // through the cached batched path.
        const hasDetailed = Boolean(stats_period || stats_grouping);
        const stats = hasDetailed
            ? await this.appStore.getAppStatsDetailed(app.uid, {
                  period: stats_period,
                  grouping: stats_grouping,
                  createdAt: app.created_at ?? app.timestamp,
              })
            : (await this.appStore.getAppsStats([app.uid])).get(app.uid);

        return this.#toClient(app, actor, { ...params, stats });
    }

    async select({ predicate, params = {} } = {}) {
        const actor = this.#requireActor();
        this.#requireUserOrAppActor(actor);

        const filters = {};
        // predicate: ['user-can-edit'] → scope to owner
        if (Array.isArray(predicate) && predicate[0] === 'user-can-edit') {
            filters.ownerUserId = actor.user.id;
        }

        const apps = await this.appStore.list(filters);

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

        return Promise.all(
            visible.map((app) =>
                this.#toClient(app, actor, {
                    ...params,
                    stats: statsByUid.get(app.uid),
                    filetypes: filetypesByAppId.get(app.id) ?? [],
                }),
            ),
        );
    }

    async update({ uid, id, object } = {}) {
        if (!object || typeof object !== 'object') {
            throw new HttpError(400, 'Missing or invalid `object`');
        }
        const actor = this.#requireActor();
        this.#requireUserOrAppActor(actor);

        const app = await this.#resolve({ uid, id });
        if (!app) throw new HttpError(404, 'App not found');

        await this.#checkWriteAccess(app, actor);

        const fields = await this.#validateInput(object, {
            isCreate: false,
            existing: app,
        });

        // Name conflict check (only if name is changing)
        if (fields.name && fields.name !== app.name) {
            if (await this.appStore.existsByName(fields.name)) {
                throw new HttpError(
                    400,
                    'An app with this name already exists',
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
        if (!app) throw new HttpError(404, 'App not found');

        if (app.protected) {
            throw new HttpError(403, 'Cannot delete a protected app');
        }

        await this.#checkWriteAccess(app, actor);
        await this.appStore.delete(app.id);

        this.#emitAppChanged({ app: null, old_app: app, action: 'deleted' });

        return { success: true, uid: app.uid };
    }

    // ── Event emission ───────────────────────────────────────────────
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

    // ── Public helpers (used by AppController) ──────────────────────

    /** Check if an app name is available. Mirrors the REST endpoint behaviour. */
    async isNameAvailable(name) {
        validateString(name, {
            key: 'name',
            maxLen: APP_NAME_MAX_LEN,
            regex: APP_NAME_REGEX,
        });
        return !(await this.appStore.existsByName(name));
    }

    // ── Validation ───────────────────────────────────────────────────

    async #validateInput(object, { isCreate }) {
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
                        );
                    }
                } else if (!isAppIconEndpointUrl(iconStr, this.config)) {
                    throw new HttpError(
                        400,
                        '`icon` must be base64, a data:image/… URL, or an app-icon endpoint URL',
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

    // ── Permission checks ────────────────────────────────────────────

    #requireActor() {
        const actor = Context.get('actor');
        if (!actor) throw new HttpError(401, 'Authentication required');
        return actor;
    }

    #requireUserOrAppActor(actor) {
        if (!actor.user) throw new HttpError(403, 'User actor required');
    }

    async #resolve({ uid, id }) {
        if (uid) return this.appStore.getByUid(uid);
        if (id?.uid) return this.appStore.getByUid(id.uid);
        if (id?.name) return this.appStore.getByName(id.name);
        if (id?.id) return this.appStore.getById(id.id);
        if (typeof id === 'number') return this.appStore.getById(id);
        if (typeof id === 'string') return this.appStore.getByUid(id);
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
        throw new HttpError(403, 'Access denied');
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
            throw new HttpError(403, 'Access denied');
        }
    }

    // ── Serialization ────────────────────────────────────────────────

    /**
     * Derive `created_from_origin`: the app's own `index_url` origin, but
     * only when AuthService agrees the origin canonically hashes back to
     * this app's UID. Apps hosted elsewhere (or mis-routed) get `null`.
     * Mirrors the v1 AppES behaviour one-for-one.
     */
    async #resolveCreatedFromOrigin(app) {
        if (!app.index_url) return null;
        try {
            const parsed = new URL(app.index_url);
            const origin = `${parsed.protocol}//${parsed.hostname}${
                parsed.port ? `:${parsed.port}` : ''
            }`;
            const expectedUid =
                await this.services.auth.appUidFromOrigin(origin);
            return expectedUid === app.uid ? origin : null;
        } catch {
            return null;
        }
    }

    async #toClient(app, actor, params = {}) {
        if (!app) return null;

        // `select` pre-fetches filetypes for every visible app in one
        // batched query and threads them through `params.filetypes` to
        // avoid the N+1 in this hot loop. Single-app callers (`read`,
        // `create`, `update`) fall back to the per-app query.
        const [filetypes, createdFromOrigin] = await Promise.all([
            params.filetypes !== undefined
                ? Promise.resolve(params.filetypes)
                : this.appStore.getFiletypeAssociations(app.id),
            this.#resolveCreatedFromOrigin(app),
        ]);

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
        if (result.is_private) {
            const isOwner =
                actor?.user?.id !== undefined &&
                actor.user.id === app.owner_user_id;
            const privateAccess = isOwner
                ? { hasAccess: true, checkedBy: 'core/app-owner' }
                : await resolvePrivateLaunchAccess({
                      app: { uid: app.uid, name: app.name, is_private: true },
                      eventClient: this.clients.event,
                      userUid: actor?.user?.uuid ?? null,
                      source: 'appDriver:toClient',
                      args: {},
                  });
            result.privateAccess = privateAccess;
            if (!privateAccess.hasAccess) {
                delete result.index_url;
            }
        }

        return result;
    }
}
