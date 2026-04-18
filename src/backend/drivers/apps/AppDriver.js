import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import { PuterDriver } from '../types.js';
import {
    validateArrayOfStrings,
    validateBool,
    validateJsonObject,
    validateString,
    validateUrl,
} from '../../util/validation.js';

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

    get appStore () {
        return this.stores.app;
    }
    get permService () {
        return this.services.permission;
    }

    // ── Driver methods ───────────────────────────────────────────────

    async create ({ object, options } = {}) {
        if ( !object || typeof object !== 'object' ) {
            throw new HttpError(400, 'Missing or invalid `object`');
        }
        const actor = this.#requireActor();
        this.#requireUserOrAppActor(actor);

        const fields = await this.#validateInput(object, { isCreate: true });

        // Name conflict handling
        if ( await this.appStore.existsByName(fields.name) ) {
            if ( options?.dedupe_name ) {
                let candidate;
                let n = 1;
                do {
                    candidate = `${fields.name}-${++n}`;
                    if ( n > 50 ) throw new HttpError(400, 'Failed to dedupe app name');
                } while ( await this.appStore.existsByName(candidate) );
                fields.name = candidate;
            } else {
                throw new HttpError(400, 'An app with this name already exists');
            }
        }

        // Set owner
        fields.owner_user_id = actor.user.id;
        if ( actor.app?.id ) fields.app_owner = actor.app.id;

        const filetypes = fields.filetype_associations;
        delete fields.filetype_associations;

        const app = await this.appStore.create(fields);
        if ( filetypes ) await this.appStore.setFiletypeAssociations(app.id, filetypes);

        this.#emitAppChanged({ app, action: 'created' });

        return this.#toClient(app, actor);
    }

    async read ({ uid, id } = {}) {
        const actor = this.#requireActor();
        const app = await this.#resolve({ uid, id });
        if ( ! app ) throw new HttpError(404, 'App not found');

        await this.#checkReadAccess(app, actor);
        return this.#toClient(app, actor);
    }

    async select ({ predicate, params = {} } = {}) {
        const actor = this.#requireActor();
        this.#requireUserOrAppActor(actor);

        const filters = {};
        // predicate: ['user-can-edit'] → scope to owner
        if ( Array.isArray(predicate) && predicate[0] === 'user-can-edit' ) {
            filters.ownerUserId = actor.user.id;
        }

        const apps = await this.appStore.list(filters);

        // Filter out protected apps the actor can't access
        const out = [];
        for ( const app of apps ) {
            if ( await this.#canReadApp(app, actor) ) {
                out.push(await this.#toClient(app, actor, params));
            }
        }
        return out;
    }

    async update ({ uid, id, object } = {}) {
        if ( !object || typeof object !== 'object' ) {
            throw new HttpError(400, 'Missing or invalid `object`');
        }
        const actor = this.#requireActor();
        this.#requireUserOrAppActor(actor);

        const app = await this.#resolve({ uid, id });
        if ( ! app ) throw new HttpError(404, 'App not found');

        await this.#checkWriteAccess(app, actor);

        const fields = await this.#validateInput(object, { isCreate: false, existing: app });

        // Name conflict check (only if name is changing)
        if ( fields.name && fields.name !== app.name ) {
            if ( await this.appStore.existsByName(fields.name) ) {
                throw new HttpError(400, 'An app with this name already exists');
            }
        }

        const filetypes = fields.filetype_associations;
        delete fields.filetype_associations;

        const updated = await this.appStore.update(app.id, fields);
        if ( filetypes !== undefined ) {
            await this.appStore.setFiletypeAssociations(app.id, filetypes);
        }

        this.#emitAppChanged({ app: updated, old_app: app, action: 'updated' });
        if ( fields.name && fields.name !== app.name ) {
            this.#emitAppRename({ app: updated, old_name: app.name, new_name: fields.name });
        }

        return this.#toClient(updated, actor);
    }

    async upsert ({ uid, id, object, options } = {}) {
        const existing = (uid || id) ? await this.#resolve({ uid, id }) : null;
        if ( existing ) return this.update({ uid: existing.uid, object });
        return this.create({ object, options });
    }

    async delete ({ uid, id } = {}) {
        const actor = this.#requireActor();
        this.#requireUserOrAppActor(actor);

        const app = await this.#resolve({ uid, id });
        if ( ! app ) throw new HttpError(404, 'App not found');

        if ( app.protected ) {
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

    #emitAppChanged ({ app, old_app, action }) {
        const app_uid = app?.uid ?? old_app?.uid;
        if ( ! app_uid ) return;
        try {
            this.clients.event.emit('app.changed', { app_uid, app, old_app, action }, {});
        } catch {
            // Non-critical.
        }
    }

    #emitAppRename ({ app, old_name, new_name }) {
        try {
            this.clients.event.emit('app.rename', {
                app_uid: app.uid,
                old_name,
                new_name,
                app,
            }, {});
        } catch {
            // Non-critical.
        }
    }

    // ── Public helpers (used by AppController) ──────────────────────

    /** Check if an app name is available. Mirrors the REST endpoint behaviour. */
    async isNameAvailable (name) {
        validateString(name, { key: 'name', maxLen: APP_NAME_MAX_LEN, regex: APP_NAME_REGEX });
        return !(await this.appStore.existsByName(name));
    }

    // ── Validation ───────────────────────────────────────────────────

    async #validateInput (object, { isCreate }) {
        const out = {};

        if ( isCreate || object.name !== undefined ) {
            out.name = validateString(object.name, {
                key: 'name',
                maxLen: APP_NAME_MAX_LEN,
                regex: APP_NAME_REGEX,
                required: isCreate,
            });
        }
        if ( isCreate || object.title !== undefined ) {
            out.title = validateString(object.title, {
                key: 'title',
                maxLen: APP_TITLE_MAX_LEN,
                required: isCreate,
            });
        }
        if ( object.description !== undefined ) {
            out.description = validateString(object.description, {
                key: 'description',
                maxLen: APP_DESCRIPTION_MAX_LEN,
                required: false,
                allowEmpty: true,
            });
        }
        if ( isCreate || object.index_url !== undefined ) {
            out.index_url = validateUrl(object.index_url, {
                key: 'index_url',
                maxLen: 3000,
                required: isCreate,
            });
        }
        if ( object.icon !== undefined ) {
            // Accept raw base64, data URLs, or full URLs. Basic length cap.
            validateString(object.icon, { key: 'icon', maxLen: 5 * 1024 * 1024, required: false });
            out.icon = object.icon;
        }
        if ( object.maximize_on_start !== undefined ) {
            out.maximize_on_start = validateBool(object.maximize_on_start, { key: 'maximize_on_start' }) ? 1 : 0;
        }
        if ( object.background !== undefined ) {
            out.background = validateBool(object.background, { key: 'background' }) ? 1 : 0;
        }
        if ( object.metadata !== undefined ) {
            const meta = validateJsonObject(object.metadata, { key: 'metadata' });
            out.metadata = JSON.stringify(meta);
        }
        if ( object.filetype_associations !== undefined ) {
            out.filetype_associations = validateArrayOfStrings(object.filetype_associations, {
                key: 'filetype_associations',
            });
        }

        return out;
    }

    // ── Permission checks ────────────────────────────────────────────

    #requireActor () {
        const actor = Context.get('actor');
        if ( ! actor ) throw new HttpError(401, 'Authentication required');
        return actor;
    }

    #requireUserOrAppActor (actor) {
        if ( ! actor.user ) throw new HttpError(403, 'User actor required');
    }

    async #resolve ({ uid, id }) {
        if ( uid ) return this.appStore.getByUid(uid);
        if ( id?.uid ) return this.appStore.getByUid(id.uid);
        if ( id?.name ) return this.appStore.getByName(id.name);
        if ( id?.id ) return this.appStore.getById(id.id);
        if ( typeof id === 'number' ) return this.appStore.getById(id);
        if ( typeof id === 'string' ) return this.appStore.getByUid(id);
        return null;
    }

    async #canReadApp (app, actor) {
        if ( ! app.protected ) return true;
        // Self-app access
        if ( actor.app?.uid === app.uid ) return true;
        // Owner access
        if ( actor.user?.id === app.owner_user_id ) return true;
        // Permission check
        try {
            return await this.permService.check(actor, `app:uid#${app.uid}:access`);
        } catch {
            return false;
        }
    }

    async #checkReadAccess (app, actor) {
        if ( await this.#canReadApp(app, actor) ) return;
        throw new HttpError(403, 'Access denied');
    }

    async #checkWriteAccess (app, actor) {
        // App actor matching app_owner
        if ( actor.app?.id && actor.app.id === app.app_owner ) return;
        // Owner
        if ( actor.user?.id === app.owner_user_id ) return;
        // System-wide write permission
        try {
            if ( await this.permService.check(actor, 'system:es:write-all-owners') ) return;
        } catch {
            // fall through
        }
        throw new HttpError(403, 'Access denied');
    }

    // ── Serialization ────────────────────────────────────────────────

    async #toClient (app, actor, params = {}) {
        if ( ! app ) return null;

        const filetypes = await this.appStore.getFiletypeAssociations(app.id);

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
            approved_for_incentive_program: Boolean(app.approved_for_incentive_program),
            metadata: app.metadata ?? null,
            filetype_associations: filetypes,
            created_at: app.created_at ?? app.timestamp,
        };

        // Owner info — only expose if actor is the owner or has access
        if ( actor?.user?.id === app.owner_user_id ) {
            result.owner = { user_id: app.owner_user_id };
        }

        // Icon sizing hook (for future AppIconService integration)
        if ( params.icon_size ) {
            result.icon_size = params.icon_size;
        }

        return result;
    }
}
