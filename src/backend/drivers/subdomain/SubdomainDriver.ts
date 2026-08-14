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

import { posix as pathPosix } from 'node:path';
import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import { assertVerifiedEmail } from '../../core/http/verifiedEmail.js';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../../services/metering/consts.js';
import { PuterDriver } from '../types.js';
import type { Actor } from '../../core/actor.js';
import type { DriverConcurrentConfig, DriverRateLimitConfig } from '../meta.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import { expandTildePath } from '../../services/fs/resolveNode.js';
import { isUniqueViolation } from '../../util/dbError.js';
import { buildHostedSubdomainIndexUrlCandidates } from '../../util/hostedAppBacking.js';
import { WORKER_SUBDOMAIN_PREFIX } from '../../stores/subdomain/SubdomainStore.js';
import {
    decodeCursor,
    encodeCursor,
    normalizeLimit,
    normalizeOffset,
} from '../../util/pagination.js';

const SUBDOMAIN_MAX_LEN = 64;
const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const DEFAULT_MAX_SUBDOMAINS = 500;

// Reserved words. Extend via config if needed.
const RESERVED_SUBDOMAINS = new Set([
    'www',
    'api',
    'mail',
    'ftp',
    'admin',
    'localhost',
    'ns1',
    'ns2',
    'smtp',
    'pop',
    'imap',
    'blog',
    'dev',
    'staging',
    'test',
]);

/**
 * Driver exposing the `puter-subdomains` interface.
 *
 * Wraps SubdomainStore with validation + permission checks. Methods follow the
 * `crud-q` shape: create, read, select, update, upsert, delete.
 *
 * Permission model:
 *
 * - Owner (user_id) can read/write their own subdomains
 * - An app actor is further scoped to the rows it created (app_owner), for reads
 *   as well as writes — never widened past its own user
 * - `system:es:write-all-owners` grants blanket write
 * - `read-all-subdomains` grants cross-user reads, and is the only thing that
 *   does
 */
export class SubdomainDriver extends PuterDriver {
    readonly driverInterface = 'puter-subdomains';
    // Matches origin/main's `iface_to_driver['puter-subdomains']` and the
    // hardcoded `service:es\Csubdomain:…` permission keys.
    readonly driverName = 'es:subdomain';
    readonly isDefault = true;

    // Mirrors the pre-v2 `temp.es` / `user.es` policies that used to ride
    // on permission grants. See AppDriver / NotificationDriver for the
    // same shape — the three crud-q drivers share one envelope.
    readonly rateLimit: DriverRateLimitConfig = {
        default: {
            limit: 200,
            window: 10_000,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 200,
                [DEFAULT_TEMP_SUBSCRIPTION]: 100,
            },
        },
        methods: {
            // Unlike the reads this shares an envelope with, `create`
            // consumes a name out of a global namespace nobody gets back.
            // A known abuse target, so it keeps its own tighter budget —
            // but publishing a site is also something the platform does on
            // the user's behalf (an app gets one, a worker gets one), so the
            // floor still has to clear a handful of those back to back.
            create: {
                limit: 120,
                window: 60_000,
                bySubscription: {
                    [DEFAULT_FREE_SUBSCRIPTION]: 60,
                    [DEFAULT_TEMP_SUBSCRIPTION]: 30,
                },
            },
        },
    };

    readonly concurrent: DriverConcurrentConfig = {
        default: {
            limit: 20,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 10,
                [DEFAULT_TEMP_SUBSCRIPTION]: 5,
            },
        },
    };

    // -- Driver methods ----------------------------------------------

    async create(args: Record<string, unknown>): Promise<unknown> {
        const object = args.object as Record<string, unknown> | undefined;

        if (!object || typeof object !== 'object') {
            throw new HttpError(400, 'Missing or invalid `object`', {
                legacyCode: 'bad_request',
            });
        }
        const actor = this.#requireActor();
        this.#requireUser(actor);
        this.#requireVerified(actor);

        const subdomain = this.#validateSubdomain(object.subdomain);

        // Uniqueness
        if (await this.stores.subdomain.existsBySubdomain(subdomain)) {
            throw new HttpError(
                409,
                'A site with this subdomain already exists',
                { legacyCode: 'conflict' },
            );
        }

        // Quota
        const maxSubdomains =
            ((actor.user as unknown as Record<string, unknown>)
                .max_subdomains as number | undefined) ??
            this.#configMaxSubdomains();
        const currentCount = (await this.stores.subdomain.countByUserId(
            actor.user.id,
        )) as number;
        if (currentCount >= maxSubdomains) {
            throw new HttpError(403, 'Subdomain limit reached', {
                legacyCode: 'subdomain_limit_reached',
            });
        }

        const rootDirPath = expandTildePath(
            String(object.root_dir ?? ''),
            actor.user.username,
        );
        const entry = await this.stores.fsEntry.getEntryByPath(rootDirPath);
        const rootDirId = entry?.id;
        if (!rootDirId) {
            throw new HttpError(400, 'root_dir_id does not exist', {
                legacyCode: 'bad_request',
            });
        }
        await this.services.fs.checkFSAccess(entry, actor);

        // A name some other user's app still points at is not free either.
        // Deleting a hosted subdomain leaves the app row's `index_url` intact,
        // and the GUI launcher appends `puter.auth.token` to whatever URL it is
        // given — so registering the freed name would hand that app's launch
        // token to whoever claimed it. The app's own owner is exempt:
        // re-creating their site restores their app rather than hijacking it.
        // See `util/hostedAppBacking.ts` for the wider rule.
        //
        // Last check before the insert on purpose: `apps.index_url` is
        // unindexed, so this scan only runs for a request that would otherwise
        // have created the row, and it stays behind the same root_dir gate as
        // the existing uniqueness answer.
        const appHoldingName = await this.stores.app.findByIndexUrlCandidates(
            buildHostedSubdomainIndexUrlCandidates(subdomain, this.config),
            { excludeOwnerUserId: actor.user.id },
        );
        if (appHoldingName) {
            throw new HttpError(
                409,
                'A site with this subdomain already exists',
                { legacyCode: 'conflict' },
            );
        }

        // `associated_app_id` is no longer accepted from clients. The
        // "associated app" for a subdomain is derived at read time from
        // `apps.owner_user_id = subdomain.user_id` + `index_url` match
        // (see `#hydrateRows`), so a subdomain row can never assert an
        // association with an app the caller doesn't own.
        //
        // The uniqueness answer above is a check-then-insert, so two callers
        // racing on the same name both pass it and the second one loses to the
        // unique index. That is the same conflict, learned a moment later —
        // report it the same way instead of letting the driver escape as a 500.
        let created;
        try {
            created = await this.stores.subdomain.create({
                userId: actor.user.id,
                subdomain,
                rootDirId,
                associatedAppId: null,
                appOwner: actor.app?.id ?? null,
            });
        } catch (err) {
            if (!isUniqueViolation(err)) throw err;
            throw new HttpError(
                409,
                'A site with this subdomain already exists',
                { legacyCode: 'conflict' },
            );
        }
        const [shaped] = await this.#hydrateRows(
            created ? [created as Record<string, unknown>] : [],
        );
        return shaped ?? null;
    }

    async read(args: Record<string, unknown>): Promise<unknown> {
        const actor = this.#requireActor();
        const row = await this.#resolve(args);
        // Worker deployments live in this table but aren't sites. `select`
        // excludes them and the workers driver serves them under its own
        // scoping, so answering for them here would make the hosting API a
        // by-name lookup for objects it doesn't manage. Same 404 as a miss:
        // the name is resolved globally, so a distinct refusal would confirm
        // the row exists.
        const isWorkerRow =
            typeof row?.subdomain === 'string' &&
            row.subdomain.startsWith(WORKER_SUBDOMAIN_PREFIX);
        if (!row || isWorkerRow)
            throw new HttpError(404, 'Subdomain not found', {
                legacyCode: 'not_found',
            });
        await this.#checkReadAccess(row, actor);
        const [shaped] = await this.#hydrateRows([row]);
        return shaped ?? null;
    }

    async select(args: Record<string, unknown>): Promise<unknown> {
        const actor = this.#requireActor();
        this.#requireUser(actor);

        const predicate = args.predicate as unknown[] | string | undefined;
        const limit = normalizeLimit(args.limit, { cap: 5000 }) ?? 5000;
        const offset = normalizeOffset(args.offset);
        const hasCursor = Object.prototype.hasOwnProperty.call(args, 'cursor');
        const payload = decodeCursor(
            args.cursor as string | null | undefined,
        ) as { id?: number } | undefined;
        if (payload && offset !== undefined) {
            throw new HttpError(400, 'cursor and offset cannot be combined', {
                legacyCode: 'bad_request',
            });
        }
        const includeTotal = args.includeTotal === true;
        const paginated = hasCursor || offset !== undefined || includeTotal;

        // Match v1: when the actor has `read-all-subdomains` (admin /
        // privileged accounts), widen to every subdomain. Without this
        // older accounts whose `user_id` rows drifted from the current
        // user.id only see a partial slice of their own list.
        const widenToAll =
            predicate !== 'user-can-edit' &&
            (await this.#hasPermission(actor, 'read-all-subdomains'));

        // App actors only see subdomains they own; read-all bypasses scoping.
        const appOwner = !widenToAll && actor.app ? actor.app.id : undefined;
        // Worker deployments live in the same table but aren't sites —
        // they're listed through the workers driver instead.
        const listOpts = {
            limit: paginated ? limit + 1 : limit,
            offset,
            afterId: payload?.id !== undefined ? Number(payload.id) : undefined,
            appOwner,
            excludePrefix: WORKER_SUBDOMAIN_PREFIX,
        };

        let rows = (
            widenToAll
                ? await this.stores.subdomain.listAll(listOpts)
                : await this.stores.subdomain.listByUserId(
                      actor.user.id,
                      listOpts,
                  )
        ) as Array<Record<string, unknown>>;

        let cursor: string | undefined;
        if (paginated && rows.length > limit) {
            rows = rows.slice(0, limit);
            const last = rows[rows.length - 1]!;
            cursor = encodeCursor({ id: Number(last.id) });
        }

        const items = await this.#hydrateRows(rows);
        if (!paginated) return items;

        let total: number | undefined;
        if (includeTotal) {
            total = widenToAll
                ? await this.stores.subdomain.count({
                      excludePrefix: WORKER_SUBDOMAIN_PREFIX,
                  })
                : await this.stores.subdomain.count({
                      userId: actor.user.id,
                      appOwner,
                      excludePrefix: WORKER_SUBDOMAIN_PREFIX,
                  });
        }

        return {
            items,
            ...(cursor ? { cursor } : {}),
            ...(total !== undefined ? { total } : {}),
        };
    }

    async update(args: Record<string, unknown>): Promise<unknown> {
        const object = args.object as Record<string, unknown> | undefined;
        if (!object || typeof object !== 'object') {
            throw new HttpError(400, 'Missing or invalid `object`', {
                legacyCode: 'bad_request',
            });
        }
        const actor = this.#requireActor();
        this.#requireUser(actor);
        this.#requireVerified(actor);

        const row = await this.#resolve(args);
        if (!row)
            throw new HttpError(404, 'Subdomain not found', {
                legacyCode: 'not_found',
            });
        await this.#checkWriteAccess(row, actor);

        // Subdomain name is immutable — strip if provided
        const patch: Record<string, unknown> = {};
        if (object.root_dir !== undefined) {
            const rootDirPath = expandTildePath(
                String(object.root_dir),
                actor.user.username,
            );
            const entry = await this.stores.fsEntry.getEntryByPath(rootDirPath);
            const rootDirId = entry?.id;
            if (!rootDirId) {
                throw new HttpError(400, 'root_dir_id does not exist', {
                    legacyCode: 'bad_request',
                });
            }
            if (rootDirId !== (row.root_dir_id ?? null)) {
                await this.services.fs.checkFSAccess(entry, actor);
            }
            patch.root_dir_id = rootDirId;
        }
        // `associated_app_uid` is silently ignored on update — the field is
        // derived at read time (see `#hydrateRows`). Same rationale as
        // `create`: no parallel source of truth that the system can't verify.
        if (object.domain !== undefined)
            patch.domain = object.domain != null ? String(object.domain) : null;

        const updated = await this.stores.subdomain.update(
            String(row.uuid),
            patch,
            { userId: row.user_id as number },
        );
        const [shaped] = await this.#hydrateRows(
            updated ? [updated as Record<string, unknown>] : [],
        );

        try {
            this.clients.event.emit(
                'subdomain.update',
                {
                    subdomain: row.subdomain as string,
                    uid: String(row.uuid),
                },
                {},
            );
        } catch {
            // Non-critical.
        }

        return shaped ?? null;
    }

    async upsert(args: Record<string, unknown>): Promise<unknown> {
        const existing = await this.#resolve(args);
        if (existing)
            return this.update({
                uid: existing.uuid,
                object: args.object as Record<string, unknown>,
            });
        return this.create(args);
    }

    async delete(args: Record<string, unknown>): Promise<unknown> {
        const actor = this.#requireActor();
        this.#requireUser(actor);
        this.#requireVerified(actor);

        const row = await this.#resolve(args);
        if (!row)
            throw new HttpError(404, 'Subdomain not found', {
                legacyCode: 'not_found',
            });

        if (row.protected) {
            throw new HttpError(403, 'Cannot delete a protected subdomain', {
                legacyCode: 'forbidden',
            });
        }

        await this.#checkWriteAccess(row, actor);
        await this.stores.subdomain.deleteByUuid(String(row.uuid), {
            userId: row.user_id as number,
        });

        try {
            this.clients.event.emit(
                'subdomain.delete',
                {
                    subdomain: row.subdomain as string,
                    uid: String(row.uuid),
                },
                {},
            );
        } catch {
            // Non-critical.
        }

        return { success: true, uid: row.uuid };
    }

    // -- Resolve -----------------------------------------------------

    async #resolve(
        args: Record<string, unknown>,
    ): Promise<Record<string, unknown> | null> {
        if (args.uid) return this.stores.subdomain.getByUuid(String(args.uid));
        const id = args.id as Record<string, unknown> | string | undefined;
        if (typeof id === 'string') return this.stores.subdomain.getByUuid(id);
        if (id && typeof id === 'object') {
            if (id.uid) return this.stores.subdomain.getByUuid(String(id.uid));
            if (id.subdomain)
                return this.stores.subdomain.getBySubdomain(
                    String(id.subdomain),
                );
        }
        return null;
    }

    // -- Validation --------------------------------------------------

    #validateSubdomain(raw: unknown): string {
        if (typeof raw !== 'string' || raw.trim().length === 0) {
            throw new HttpError(400, 'Missing or empty `subdomain`', {
                legacyCode: 'bad_request',
            });
        }
        if (raw.length > SUBDOMAIN_MAX_LEN) {
            throw new HttpError(
                400,
                `Subdomain exceeds max length (${SUBDOMAIN_MAX_LEN})`,
                { legacyCode: 'bad_request' },
            );
        }
        const s = raw.trim().toLowerCase();

        if (!SUBDOMAIN_REGEX.test(s)) {
            throw new HttpError(
                400,
                'Invalid subdomain format (lowercase alphanumeric + hyphens, must not start/end with hyphen)',
                { legacyCode: 'bad_request' },
            );
        }
        if (RESERVED_SUBDOMAINS.has(s)) {
            throw new HttpError(400, `Subdomain '${s}' is reserved`, {
                legacyCode: 'subdomain_reserved',
            });
        }
        return s;
    }

    // -- Permissions -------------------------------------------------

    #requireActor(): Actor & {
        user: { id: number; uuid: string; username: string };
    } {
        const actor = Context.get('actor') as Actor | undefined;
        if (!actor?.user?.id)
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });
        return actor as Actor & {
            user: { id: number; uuid: string; username: string };
        };
    }

    #requireUser(actor: Actor): void {
        if (!actor.user?.id)
            throw new HttpError(403, 'User actor required', {
                legacyCode: 'forbidden',
            });
    }

    /**
     * Mirror of the HTTP-layer `requireVerifiedGate` on /delete-site — only
     * active when `strict_email_verification_required` is truthy, so self-
     * hosted installs without SMTP aren't bricked. Applied at the driver level
     * so /drivers/call can't bypass the gate the HTTP route enforces.
     */
    #requireVerified(actor: Actor): void {
        assertVerifiedEmail(
            Boolean(this.config.strict_email_verification_required),
            actor.user,
            400,
        );
    }

    async #hasPermission(actor: Actor, permission: string): Promise<boolean> {
        try {
            return await this.services.permission.check(actor, permission);
        } catch {
            return false;
        }
    }

    /**
     * Both grants are nested under "the caller owns this row" on purpose.
     *
     * Held flat, an `app_owner` match reads as a grant in its own right — and
     * since the owner check above it has already returned for every row the
     * caller owns, it is only ever reached for a row owned by somebody else.
     * `app_owner` is a global app id shared by every user of that app, so that
     * hands one user's owner name, uuid and home path to any other user acting
     * under the same app. `#checkWriteAccess` requires the owner match in both
     * of its branches; this is the same rule, written as nesting.
     *
     * The inner check is the predicate `select` applies in SQL: an app sees
     * what it created, not everything its user owns. Read `effectiveApp`, not
     * `app` — an app-minted access token carries no `app` of its own and would
     * otherwise slip past as though no app were involved.
     */
    async #checkReadAccess(
        row: Record<string, unknown>,
        actor: Actor,
    ): Promise<void> {
        if (actor.user?.id === row.user_id) {
            const app = actor.effectiveApp;
            if (!app?.id) return;
            if (app.id === row.app_owner) return;
        }
        // Cross-user read permission
        if (await this.#hasPermission(actor, 'read-all-subdomains')) return;
        throw new HttpError(403, 'Access denied', { legacyCode: 'forbidden' });
    }

    async #checkWriteAccess(
        row: Record<string, unknown>,
        actor: Actor,
    ): Promise<void> {
        // App actor matching app_owner
        let hasAccess = false;
        if (!actor.app?.id) {
            hasAccess = actor.user?.id === row.user_id;
        } else if (actor.app.id === row.app_owner) {
            hasAccess = actor.user?.id === row.user_id;
        }
        // System-wide write
        if (!hasAccess) {
            hasAccess = await this.#hasPermission(
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

    // -- Config ------------------------------------------------------

    #configMaxSubdomains(): number {
        const n = Number(
            this.config.max_subdomains_per_user ?? DEFAULT_MAX_SUBDOMAINS,
        );
        return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_SUBDOMAINS;
    }

    // -- Serialization -----------------------------------------------
    //
    // v1's `puter-subdomains` shape (canonical, see SubdomainES + the
    // mapping at om/mappings/subdomain.js):
    //   {
    //     uid, subdomain, domain,
    //     root_dir: <full FSEntry "safe entry">,
    //     associated_app: <full app shape> | null,
    //     created_at: <ISO datetime>,
    //     owner: { username, uuid },
    //     app_owner: <full app shape> | null,
    //     protected: bool,
    //   }
    //
    // We never expose raw mysql ids (user_id / root_dir_id /
    // associated_app_id / app_owner-as-id) — clients see uuids and
    // nested objects instead.

    /**
     * Hydrate raw subdomain rows into the v1-shaped client response.
     *
     * Resolves the foreign keys (user_id → owner, root_dir_id → root_dir,
     * associated_app_id / app_owner → app shapes) with one batched lookup per
     * store, regardless of how many rows we're shaping. Used by both `select`
     * (many rows) and the single-row paths (`create`/`read`/`update`/`upsert`)
     * so the wire shape stays identical.
     */
    async #hydrateRows(
        rows: Array<Record<string, unknown>>,
    ): Promise<Array<Record<string, unknown>>> {
        if (rows.length === 0) return [];

        const collectIds = (
            key: 'user_id' | 'root_dir_id' | 'app_owner',
        ): number[] => {
            const out = new Set<number>();
            for (const r of rows) {
                const v = r[key];
                if (typeof v === 'number') out.add(v);
                else if (typeof v === 'string' && v.length > 0) {
                    const n = Number(v);
                    if (Number.isFinite(n)) out.add(n);
                }
            }
            return [...out];
        };

        const userIds = collectIds('user_id');
        const rootDirIds = collectIds('root_dir_id');
        const appOwnerIds = collectIds('app_owner');

        // `associated_app` is derived: match apps owned by `subdomain.user_id`
        // whose `index_url` resolves to one of the subdomain's host
        // variants. The row's stored `associated_app_id` is ignored
        // (was user-writable without an ownership check).
        const associatedAppIdByRowUuid =
            await this.#deriveAssociatedAppIdByRowUuid(rows);
        const associatedAppIds = [
            ...new Set(associatedAppIdByRowUuid.values()),
        ];
        const allAppIds = [...new Set([...associatedAppIds, ...appOwnerIds])];

        // Single round-trip per store, all in parallel — the filetype
        // lookup keys off the requested ids (not on getByIds' result),
        // so it doesn't need to wait for the app rows.
        const [usersById, entriesById, appsById, filetypesByAppId] =
            await Promise.all([
                this.stores.user.getByIds(userIds),
                this.stores.fsEntry.getEntriesByIds(rootDirIds),
                this.stores.app.getByIds(allAppIds),
                this.stores.app.getFiletypeAssociationsByIds(allAppIds),
            ]);

        return rows.map((row) =>
            this.#shapeRow(row, {
                usersById,
                entriesById,
                appsById,
                filetypesByAppId,
                associatedAppIdByRowUuid,
            }),
        );
    }

    /**
     * For each subdomain row, find the app owned by the same user whose
     * `index_url` matches one of the subdomain's host candidates (subdomain ×
     * hosting domains × protocols × paths). Returns a `rowUuid → appId` map.
     * Rows with no matching app are absent.
     *
     * Runs one batched DB query regardless of input size.
     */
    async #deriveAssociatedAppIdByRowUuid(
        rows: Array<Record<string, unknown>>,
    ): Promise<Map<string, number>> {
        const result = new Map<string, number>();
        if (rows.length === 0) return result;

        const userIdToRowMeta = new Map<
            number,
            Array<{ rowUuid: string; candidates: Set<string> }>
        >();
        const allCandidates = new Set<string>();

        for (const row of rows) {
            const subdomain =
                typeof row.subdomain === 'string'
                    ? row.subdomain.toLowerCase()
                    : '';
            const userId =
                typeof row.user_id === 'number'
                    ? row.user_id
                    : Number(row.user_id);
            const rowUuid =
                typeof row.uuid === 'string' && row.uuid.length > 0
                    ? row.uuid
                    : '';
            if (!subdomain || !Number.isFinite(userId) || !rowUuid) continue;

            const candidates = new Set<string>(
                buildHostedSubdomainIndexUrlCandidates(subdomain, this.config),
            );
            if (candidates.size === 0) continue;
            for (const c of candidates) allCandidates.add(c);

            if (!userIdToRowMeta.has(userId)) {
                userIdToRowMeta.set(userId, []);
            }
            userIdToRowMeta.get(userId)!.push({ rowUuid, candidates });
        }

        if (allCandidates.size === 0 || userIdToRowMeta.size === 0) {
            return result;
        }

        const userIds = [...userIdToRowMeta.keys()];
        const userPlaceholders = userIds.map(() => '?').join(', ');
        const candidateList = [...allCandidates];
        const urlPlaceholders = candidateList.map(() => '?').join(', ');
        const matches = (await this.clients.db.read(
            `SELECT \`id\`, \`owner_user_id\`, \`index_url\` FROM \`apps\`
             WHERE \`owner_user_id\` IN (${userPlaceholders})
               AND \`index_url\` IN (${urlPlaceholders})`,
            [...userIds, ...candidateList],
        )) as Array<Record<string, unknown>>;

        for (const m of matches) {
            const appId = typeof m.id === 'number' ? m.id : Number(m.id);
            const ownerId =
                typeof m.owner_user_id === 'number'
                    ? m.owner_user_id
                    : Number(m.owner_user_id);
            const indexUrl = typeof m.index_url === 'string' ? m.index_url : '';
            if (
                !Number.isFinite(appId) ||
                !Number.isFinite(ownerId) ||
                !indexUrl
            ) {
                continue;
            }
            const rowsForOwner = userIdToRowMeta.get(ownerId) ?? [];
            for (const { rowUuid, candidates } of rowsForOwner) {
                if (candidates.has(indexUrl) && !result.has(rowUuid)) {
                    result.set(rowUuid, appId);
                }
            }
        }

        return result;
    }

    #shapeRow(
        row: Record<string, unknown>,
        lookups: {
            usersById: Map<number, UserRow>;
            entriesById: Map<number, FSEntry>;
            appsById: Map<number, Record<string, unknown>>;
            filetypesByAppId: Map<number, string[]>;
            associatedAppIdByRowUuid: Map<string, number>;
        },
    ): Record<string, unknown> {
        const ts = row.ts;
        let createdAt: string | null = null;
        if (ts != null) {
            const d = ts instanceof Date ? ts : new Date(ts as string);
            createdAt = Number.isNaN(d.getTime()) ? null : d.toISOString();
        }

        const ownerId =
            typeof row.user_id === 'number' ? row.user_id : Number(row.user_id);
        const owner = lookups.usersById.get(ownerId) ?? null;

        const rootDirId =
            row.root_dir_id == null
                ? null
                : typeof row.root_dir_id === 'number'
                  ? row.root_dir_id
                  : Number(row.root_dir_id);
        const rootEntry =
            rootDirId != null
                ? (lookups.entriesById.get(rootDirId) ?? null)
                : null;

        const associatedAppRefId =
            typeof row.uuid === 'string'
                ? (lookups.associatedAppIdByRowUuid.get(row.uuid) ?? null)
                : null;
        const associatedApp =
            associatedAppRefId != null
                ? (lookups.appsById.get(associatedAppRefId) ?? null)
                : null;

        const appOwnerRefId =
            row.app_owner == null
                ? null
                : typeof row.app_owner === 'number'
                  ? row.app_owner
                  : Number(row.app_owner);
        const appOwnerApp =
            appOwnerRefId != null
                ? (lookups.appsById.get(appOwnerRefId) ?? null)
                : null;

        return {
            uid: row.uuid,
            subdomain: row.subdomain,
            // v1 sample emits `""` rather than null when no custom domain
            // is set; the mapping declares `domain` as a string column.
            domain: typeof row.domain === 'string' ? row.domain : '',
            root_dir: rootEntry ? mapEntryToSubdomainRootDir(rootEntry) : null,
            associated_app: associatedApp
                ? mapAppForEmbed(
                      associatedApp,
                      lookups.filetypesByAppId.get(associatedAppRefId!) ?? [],
                  )
                : null,
            created_at: createdAt,
            owner: owner
                ? { username: owner.username, uuid: owner.uuid }
                : null,
            app_owner: appOwnerApp
                ? mapAppForEmbed(
                      appOwnerApp,
                      lookups.filetypesByAppId.get(appOwnerRefId!) ?? [],
                  )
                : null,
            protected: Boolean(row.protected),
        };
    }
}

// -- Embed shape helpers (module-level, sync, no DB) -----------------
//
// `root_dir` mirrors v1's `safe_entry` from FSNodeContext, minus the
// fields v1 deletes before sending to clients (`user_id`, `bucket`,
// `bucket_region`). The legacy entry helper lives at
// controllers/fs/legacyFsHelpers.ts and is async (does an
// `is_empty` probe + owner fetch + thumbnail rewrite); subdomains
// don't need any of that, so we reshape inline.

function mapEntryToSubdomainRootDir(entry: FSEntry): Record<string, unknown> {
    const dirname = pathPosix.dirname(entry.path);
    return {
        id: entry.uuid,
        uid: entry.uuid,
        parent_id: entry.parentUid,
        parent_uid: entry.parentUid,
        public_token: entry.publicToken,
        file_request_token: entry.fileRequestToken,
        is_dir: Boolean(entry.isDir),
        is_public: entry.isPublic,
        is_shortcut: entry.isShortcut ? 1 : 0,
        is_symlink: entry.isSymlink ? 1 : 0,
        symlink_path: entry.symlinkPath,
        sort_by: entry.sortBy,
        sort_order: entry.sortOrder,
        immutable: entry.immutable ? 1 : 0,
        name: entry.name,
        metadata: entry.metadata,
        modified: entry.modified,
        created: entry.created,
        accessed: entry.accessed,
        size: entry.size,
        layout: entry.layout,
        path: entry.path,
        dirname,
        dirpath: dirname,
        // v1 attaches an ACL-resolved `writable` here; the subdomain
        // owner can always write to their own root_dir, and cross-user
        // reads via `read-all-subdomains` aren't expected to mutate, so
        // a constant `true` matches v1's behaviour for the typical case
        // without a per-row ACL probe.
        writable: true,
        subdomains: entry.subdomains ?? [],
        workers: entry.workers ?? [],
        has_website: entry.hasWebsite ?? (entry.subdomains?.length ?? 0) > 0,
    };
}

/**
 * Embed shape for nested app references (`associated_app`, `app_owner`).
 * Follows v1's AppES read shape minus the per-app async work
 * (`created_from_origin`, private-app gating) — those are top-level-read
 * concerns, not relevant for an app embed inside a subdomain row.
 */
function mapAppForEmbed(
    app: Record<string, unknown>,
    filetypes: string[],
): Record<string, unknown> {
    return {
        uid: app.uid,
        name: app.name,
        title: app.title,
        description: app.description,
        icon: app.icon,
        index_url: app.index_url,
        background: Boolean(app.background),
        maximize_on_start: Boolean(app.maximize_on_start),
        is_private: Boolean(app.is_private),
        protected: Boolean(app.protected),
        approved_for_listing: Boolean(app.approved_for_listing),
        approved_for_opening_items: Boolean(app.approved_for_opening_items),
        approved_for_incentive_program: Boolean(
            app.approved_for_incentive_program,
        ),
        metadata: app.metadata ?? null,
        filetype_associations: filetypes,
        created_at: app.created_at ?? app.timestamp ?? null,
    };
}
