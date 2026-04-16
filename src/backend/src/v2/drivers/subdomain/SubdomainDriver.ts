import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import { PuterDriver } from '../types.js';
import type { Actor } from '../../core/actor.js';

const SUBDOMAIN_MAX_LEN = 64;
const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const DEFAULT_MAX_SUBDOMAINS = 500;

// Reserved words — mirrors v1's default list. Extend via config if needed.
const RESERVED_SUBDOMAINS = new Set([
    'www', 'api', 'mail', 'ftp', 'admin', 'localhost', 'ns1', 'ns2',
    'smtp', 'pop', 'imap', 'blog', 'dev', 'staging', 'test',
]);

/**
 * Driver exposing the `puter-subdomains` interface.
 *
 * Wraps SubdomainStore with validation + permission checks.
 * Methods match v1's `crud-q` shape: create, read, select, update,
 * upsert, delete.
 *
 * Permission model:
 *   - Owner (user_id) can read/write their own subdomains
 *   - App actor matching app_owner can read/write scoped subdomains
 *   - `system:es:write-all-owners` grants blanket write
 *   - `read-all-subdomains` grants cross-user reads
 */
export class SubdomainDriver extends PuterDriver {
    readonly driverInterface = 'puter-subdomains';
    readonly driverName = 'subdomains';
    readonly isDefault = true;

    // ── Driver methods ──────────────────────────────────────────────

    async create (args: Record<string, unknown>): Promise<unknown> {
        const object = args.object as Record<string, unknown> | undefined;
        if ( !object || typeof object !== 'object' ) {
            throw new HttpError(400, 'Missing or invalid `object`');
        }
        const actor = this.#requireActor();
        this.#requireUser(actor);

        const subdomain = this.#validateSubdomain(object.subdomain);

        // Uniqueness
        if ( await this.stores.subdomain.existsBySubdomain(subdomain) ) {
            throw new HttpError(409, 'A site with this subdomain already exists');
        }

        // Quota
        const maxSubdomains = (actor.user as unknown as Record<string, unknown>).max_subdomains as number | undefined
            ?? this.#configMaxSubdomains();
        const currentCount = await this.stores.subdomain.countByUserId(actor.user.id) as number;
        if ( currentCount >= maxSubdomains ) {
            throw new HttpError(403, 'Subdomain limit reached');
        }

        const created = await this.stores.subdomain.create({
            userId: actor.user.id,
            subdomain,
            rootDirId: object.root_dir_id != null ? Number(object.root_dir_id) : null,
            associatedAppId: object.associated_app_id != null ? Number(object.associated_app_id) : null,
            appOwner: actor.app?.id ?? null,
        });
        return this.#toClient(created);
    }

    async read (args: Record<string, unknown>): Promise<unknown> {
        const actor = this.#requireActor();
        const row = await this.#resolve(args);
        if ( ! row ) throw new HttpError(404, 'Subdomain not found');
        await this.#checkReadAccess(row, actor);
        return this.#toClient(row);
    }

    async select (args: Record<string, unknown>): Promise<unknown[]> {
        const actor = this.#requireActor();
        this.#requireUser(actor);

        const predicate = args.predicate as unknown[] | string | undefined;
        const limit = Math.min(Number(args.limit ?? 5000), 5000);

        // Default: only the actor's own subdomains
        let rows = await this.stores.subdomain.listByUserId(actor.user.id, { limit });

        // If we have read-all permission, widen to all users
        if ( predicate !== 'user-can-edit' && await this.#hasPermission(actor, 'read-all-subdomains') ) {
            // Currently no store method for cross-user list; stick to
            // user-scoped for safety. A cross-user list would need
            // pagination anyway.
        }

        // App-limited: app actors only see subdomains they own
        if ( actor.app ) {
            rows = rows.filter(r => r.app_owner === actor.app!.id);
        }

        return rows.map(r => this.#toClient(r));
    }

    async update (args: Record<string, unknown>): Promise<unknown> {
        const object = args.object as Record<string, unknown> | undefined;
        if ( !object || typeof object !== 'object' ) {
            throw new HttpError(400, 'Missing or invalid `object`');
        }
        const actor = this.#requireActor();
        this.#requireUser(actor);

        const row = await this.#resolve(args);
        if ( ! row ) throw new HttpError(404, 'Subdomain not found');
        await this.#checkWriteAccess(row, actor);

        // Subdomain name is immutable — strip if provided
        const patch: Record<string, unknown> = {};
        if ( object.root_dir_id !== undefined ) patch.root_dir_id = object.root_dir_id != null ? Number(object.root_dir_id) : null;
        if ( object.associated_app_id !== undefined ) patch.associated_app_id = object.associated_app_id != null ? Number(object.associated_app_id) : null;
        if ( object.domain !== undefined ) patch.domain = object.domain != null ? String(object.domain) : null;

        const updated = await this.stores.subdomain.update(row.uuid, patch, { userId: row.user_id });
        return this.#toClient(updated);
    }

    async upsert (args: Record<string, unknown>): Promise<unknown> {
        const existing = await this.#resolve(args);
        if ( existing ) return this.update({ uid: existing.uuid, object: args.object as Record<string, unknown> });
        return this.create(args);
    }

    async delete (args: Record<string, unknown>): Promise<unknown> {
        const actor = this.#requireActor();
        this.#requireUser(actor);

        const row = await this.#resolve(args);
        if ( ! row ) throw new HttpError(404, 'Subdomain not found');

        if ( row.protected ) {
            throw new HttpError(403, 'Cannot delete a protected subdomain');
        }

        await this.#checkWriteAccess(row, actor);
        await this.stores.subdomain.deleteByUuid(row.uuid, { userId: row.user_id });
        return { success: true, uid: row.uuid };
    }

    // ── Resolve ─────────────────────────────────────────────────────

    async #resolve (args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
        if ( args.uid ) return this.stores.subdomain.getByUuid(String(args.uid));
        const id = args.id as Record<string, unknown> | string | undefined;
        if ( typeof id === 'string' ) return this.stores.subdomain.getByUuid(id);
        if ( id && typeof id === 'object' ) {
            if ( id.uid ) return this.stores.subdomain.getByUuid(String(id.uid));
            if ( id.subdomain ) return this.stores.subdomain.getBySubdomain(String(id.subdomain));
        }
        return null;
    }

    // ── Validation ──────────────────────────────────────────────────

    #validateSubdomain (raw: unknown): string {
        if ( typeof raw !== 'string' || raw.trim().length === 0 ) {
            throw new HttpError(400, 'Missing or empty `subdomain`');
        }
        if ( raw.length > SUBDOMAIN_MAX_LEN ) {
            throw new HttpError(400, `Subdomain exceeds max length (${SUBDOMAIN_MAX_LEN})`);
        }
        const s = raw.trim().toLowerCase();

        if ( ! SUBDOMAIN_REGEX.test(s) ) {
            throw new HttpError(400, 'Invalid subdomain format (lowercase alphanumeric + hyphens, must not start/end with hyphen)');
        }
        if ( RESERVED_SUBDOMAINS.has(s) ) {
            throw new HttpError(400, `Subdomain '${s}' is reserved`);
        }
        return s;
    }

    // ── Permissions ─────────────────────────────────────────────────

    #requireActor (): Actor & { user: { id: number; uuid: string; username: string } } {
        const actor = Context.get('actor') as Actor | undefined;
        if ( ! actor?.user?.id ) throw new HttpError(401, 'Authentication required');
        return actor as Actor & { user: { id: number; uuid: string; username: string } };
    }

    #requireUser (actor: Actor): void {
        if ( ! actor.user?.id ) throw new HttpError(403, 'User actor required');
    }

    async #hasPermission (actor: Actor, permission: string): Promise<boolean> {
        try {
            return await this.services.permission.check(actor, permission);
        } catch { return false; }
    }

    async #checkReadAccess (row: Record<string, unknown>, actor: Actor): Promise<void> {
        // Owner
        if ( actor.user?.id === row.user_id ) return;
        // App actor matching app_owner
        if ( actor.app?.id && actor.app.id === row.app_owner ) return;
        // Cross-user read permission
        if ( await this.#hasPermission(actor, 'read-all-subdomains') ) return;
        throw new HttpError(403, 'Access denied');
    }

    async #checkWriteAccess (row: Record<string, unknown>, actor: Actor): Promise<void> {
        // App actor matching app_owner
        if ( actor.app?.id && actor.app.id === row.app_owner ) return;
        // Owner
        if ( actor.user?.id === row.user_id ) return;
        // System-wide write
        if ( await this.#hasPermission(actor, 'system:es:write-all-owners') ) return;
        throw new HttpError(403, 'Access denied');
    }

    // ── Config ──────────────────────────────────────────────────────

    #configMaxSubdomains (): number {
        const cfg = this.config as unknown as Record<string, unknown>;
        const n = Number(cfg.max_subdomains_per_user ?? DEFAULT_MAX_SUBDOMAINS);
        return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_SUBDOMAINS;
    }

    // ── Serialization ───────────────────────────────────────────────

    #toClient (row: Record<string, unknown> | null): Record<string, unknown> | null {
        if ( ! row ) return null;
        return {
            uid: row.uuid,
            subdomain: row.subdomain,
            domain: row.domain ?? null,
            user_id: row.user_id,
            root_dir_id: row.root_dir_id ?? null,
            associated_app_id: row.associated_app_id ?? null,
            app_owner: row.app_owner ?? null,
            protected: Boolean(row.protected),
            created_at: row.ts ?? null,
        };
    }
}
