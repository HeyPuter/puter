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

import { contentType as contentTypeFromMime } from 'mime-types';
import { posix as pathPosix } from 'node:path';
import { userRelatedActor, type Actor } from '../../core/actor';
import { HttpError } from '../../core/http/HttpError.js';
import { isUniqueViolation } from '../../util/dbError.js';
import {
    abuseKey,
    cleanEmail,
    isProviderCanonicalized,
} from '../../util/email.js';
import type { FSEntry } from '../../stores/fs/FSEntry';
import type { UserRow } from '../../stores/user/UserStore';
import type { AclMode } from '../acl/ACLService';
import {
    learnShareRoots,
    maskEntryPath,
    resolveSharePath,
} from '../fs/sharePathMask';
import { MANAGE_PERM_PREFIX } from '../permission/consts';
import { PuterService } from '../types';

// -- Types ------------------------------------------------------------

/** A recipient named by whichever identifier the caller had. */
export interface ShareRecipient {
    email?: string;
    username?: string;
}

export interface ShareTarget {
    path?: string;
    uid?: string;
}

/** A `share` row, as much of it as this service reads back. */
interface ShareIndexRow {
    uid: string;
    mode: string;
    holder_user_id: number;
    issuer_user_id: number;
    fsentry_id: number;
    created_at?: unknown;
    data?: unknown;
}

export interface ShareInput extends ShareTarget {
    recipient: ShareRecipient;
    mode: AclMode;
}

/** One live share, resolved for a response. */
export interface ResolvedShare {
    uid: string;
    mode: string;
    path: string;
    /**
     * The entry's own name, content type and thumbnail. A share has no fsentry
     * behind it for the client to stat for them, and the masked path hides
     * which folder it sits in. `type` and `thumbnail` come with a listing
     * only.
     */
    name?: string;
    type?: string | null;
    thumbnail?: string | null;
    entryUid: string;
    isDir: boolean;
    /** Whose entry it is. */
    owner?: { username: string | null };
    issuer: { username: string | null };
    holder: { username: string | null };
    createdAt: unknown;
    /** Set when the access comes from a shared ancestor, not this node. */
    inheritedFrom?: string | null;
    /** The app that asked for this share, when one did. */
    issuedByApp?: string | null;
    modified: number;
    size: number | null;
    /**
     * Set by `share()` only, and never sent to a client: who to notify, and
     * whether this call created reach that didn't exist before.
     */
    holderId?: number;
    isNew?: boolean;
    /**
     * An invite to an address with no confirmed account. No grant exists yet —
     * it is written when the recipient confirms the address.
     */
    pending?: boolean;
    /** Address the invite was aimed at. Set only when `pending`. */
    recipientEmail?: string;
}

const SHAREABLE_MODES: ReadonlySet<string> = new Set([
    'see',
    'list',
    'read',
    'write',
    'manage',
]);

/**
 * Every permission a share of one node can rest on. `manage` is spelled with
 * the prefix leading, so a prefix match on `fs:<uuid>` does not reach it.
 */
/** The app recorded on a share row, when one issued it. */
const issuedByApp = (row: { data?: unknown }): string | null => {
    const value = (row.data as { issuedByApp?: unknown } | null)?.issuedByApp;
    return typeof value === 'string' && value !== '' ? value : null;
};

export const entryPermissions = (uuid: string): string[] => [
    `fs:${uuid}:see`,
    `fs:${uuid}:list`,
    `fs:${uuid}:read`,
    `fs:${uuid}:write`,
    `manage:fs:${uuid}`,
];

/**
 * The permission a share of `mode` actually grants — which is what authority to
 * issue that share has to be measured against.
 */
export const entryPermissionForMode = (
    uuid: string,
    mode: AclMode | string,
): string =>
    mode === MANAGE_PERM_PREFIX
        ? `${MANAGE_PERM_PREFIX}:fs:${uuid}`
        : `fs:${uuid}:${mode}`;

/**
 * The entry a grant names, read back out of the permission text.
 *
 * `fs:<uuid>[:mode]` and `manage:fs:<uuid>` are the only two shapes this
 * service writes; anything else belongs to another domain and is not ours to
 * interpret.
 */
export const uuidFromEntryPermission = (permission: string): string | null => {
    const parts = permission.split(':');
    const fsAt = parts[0] === MANAGE_PERM_PREFIX ? 1 : 0;
    if (parts[fsAt] !== 'fs') return null;
    return parts[fsAt + 1] || null;
};

/**
 * How many entries' grants one retire query covers. Each entry contributes two
 * indexed range scans (`fs:<uuid>` and `manage:fs:<uuid>`), so this bounds the
 * work per statement while still collapsing a deleted subtree into a few round
 * trips instead of one per descendant.
 */
const RETIRE_CHUNK_SIZE = 100;

/** Shares one user may create per UTC day, absent a config override. */
export const DEFAULT_DAILY_SHARE_LIMIT = 200;

/**
 * The least an address must look like before an invite row is written for it.
 * Deliverability is the inbox's business, but `a@b` or a pasted sentence must
 * not become a permanent pending share that spent quota.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/**
 * Where "refuse shares from everyone" lives on the user row.
 *
 * A key in the existing `metadata` blob rather than a column of its own: the
 * share path already holds the recipient's row by the time it asks, so reading
 * it costs nothing either way, and a one-bit preference doesn't earn a
 * migration per dialect.
 */
const BLOCK_ALL_SHARES_KEY = 'blockAllShares';

/** Whether this account refuses shares from everyone. */
const blocksAllShares = (user: Pick<UserRow, 'metadata'> | null): boolean =>
    Boolean(user?.metadata?.[BLOCK_ALL_SHARES_KEY]);

/**
 * What a share recipient's browser is told about someone else's entry.
 *
 * Curated rather than the row: the row carries the owner's real path, their
 * numeric id, storage internals and the capability tokens — none of which are a
 * recipient's to see. The path is the entry masked against itself, which always
 * resolves; running outside a request, there is no per-request masker to
 * consult for a deeper root.
 */
const holderPayload = (entry: FSEntry): Record<string, unknown> => ({
    uid: entry.uuid,
    uuid: entry.uuid,
    name: entry.name,
    path: maskedSelfPath(entry, entry.path),
    is_dir: Boolean(entry.isDir),
    size: entry.size ?? null,
    modified: entry.modified,
    from_new_service: true,
});

/** `/<owner>/<uuid>/<name>` for a path in the owner's tree. */
const maskedSelfPath = (entry: FSEntry, realPath: string): string => {
    const owner = realPath.split('/')[1];
    const name = realPath.split('/').pop();
    return owner && name ? `/${owner}/${entry.uuid}/${name}` : realPath;
};

// -- ShareService -----------------------------------------------------

/**
 * Sharing a filesystem node with another user.
 *
 * A share is two writes that belong together: the permission grant, which is
 * what actually authorizes access, and a `share` row, which is what makes the
 * share listable and ties it to an fsentry so it dies with the file. This
 * service owns that pairing — nothing else should grant `fs:*` to a user.
 *
 * Authorization reuses `PermissionService.canManagePermission`: an owner
 * satisfies it through the `is-owner` implicator, a delegate through an
 * explicit `manage:fs:<uid>` grant.
 */
export class ShareService extends PuterService {
    /** Entries awaiting the next retire flush, deduped by uuid. */
    #pendingRetire = new Map<string, FSEntry>();
    /** The in-flight flush, shared by everything buffered for it. */
    #retireFlush: Promise<void> | null = null;

    /**
     * FS mutations only notify the owner, leaving a recipient's open window
     * stale. Handled here rather than per controller so the audience logic
     * lives in one place, and over the event bus because fs is constructed
     * first and cannot depend on this service.
     */
    override onServerStart(): void {
        this.clients.event.on('fs.remove.node', (_key, data) => {
            const entry = (data as { node?: FSEntry })?.node;
            if (!entry?.uuid) return;
            // Returned so an `emitAndWait` caller can observe the cleanup; the
            // FS path uses plain `emit`, where it stays best-effort.
            return this.#scheduleRetire(entry).catch((err) => {
                console.warn(
                    '[ShareService] failed to retire grants for a deleted entry:',
                    entry.uuid,
                    err,
                );
            });
        });

        this.clients.event.on('fs.move.node', (_key, data) => {
            const { node, fromPath, fromUserId } = (data ?? {}) as {
                node?: FSEntry;
                fromPath?: string;
                fromUserId?: number;
            };
            if (!node?.uuid) return;
            const notify = this.#fanOutToHolders(node, 'outer.gui.item.moved', {
                ...holderPayload(node),
                from_path: fromPath
                    ? maskedSelfPath(node, fromPath)
                    : undefined,
            }).catch(() => {
                // A stale window is better than a failed move.
            });

            // Grants are keyed on uuid, so they would otherwise follow the
            // entry into its new owner's tree — leaving the new owner with
            // recipients they never agreed to. Awaited alongside the notify so
            // an `emitAndWait` caller sees both.
            if (typeof fromUserId !== 'number' || fromUserId === node.userId) {
                return notify;
            }
            return Promise.all([
                notify,
                this.onEntryOwnerChanged(node).catch((err: unknown): void => {
                    console.warn(
                        '[ShareService] failed to retire grants after an ownership change:',
                        node.uuid,
                        err,
                    );
                }),
            ]).then((): void => undefined);
        });

        // Owning a confirmed address is what turns it from a claim into an
        // identity, and so the only moment an invite may become a grant. That
        // happens on more paths than typing a code: an OIDC signup arrives with
        // the provider's word for the address, and the change-email flow
        // confirms the new one before it lands. Missing any of them strands the
        // invite forever — there is no later event to catch.
        const claimFor = (user_id?: number, email?: string) => {
            if (!user_id || !email) return;
            return this.claimPendingShares(user_id, email)
                .then((claimed) =>
                    this.services.shareNotification.notifyClaimed(
                        user_id,
                        claimed,
                    ),
                )
                .catch((err) => {
                    console.warn(
                        '[ShareService] failed to claim pending shares for',
                        user_id,
                        err,
                    );
                });
        };
        this.clients.event.on('user.email-confirmed', (_key, data) => {
            const { user_id, email } = (data ?? {}) as {
                user_id?: number;
                email?: string;
            };
            return claimFor(user_id, email);
        });
        this.clients.event.on('user.email-changed', (_key, data) => {
            const { user_id, new_email } = (data ?? {}) as {
                user_id?: number;
                new_email?: string;
            };
            return claimFor(user_id, new_email);
        });

        this.clients.event.on('fs.write.file', (_key, data) => {
            const entry = (data as { node?: FSEntry })?.node;
            if (!entry?.uuid) return;
            return this.#fanOutToHolders(
                entry,
                'outer.gui.item.updated',
                holderPayload(entry),
            ).catch(() => {
                // Same — never fail a write over its notification.
            });
        });
    }

    /**
     * Buffer a removed entry for the next retire flush, and hand back the
     * promise for the flush that will carry it.
     *
     * `remove()` emits one `fs.remove.node` per descendant in a synchronous
     * loop, so deleting a directory arrives here as a burst. Retiring each one
     * on its own would put one permission lookup per descendant on the delete
     * path; coalescing turns a whole subtree into a handful of queries. The
     * buffer is swapped out before the flush runs, so entries removed while it
     * is in flight land in the next one rather than being lost.
     */
    #scheduleRetire(entry: FSEntry): Promise<void> {
        this.#pendingRetire.set(entry.uuid, entry);
        this.#retireFlush ??= new Promise<void>((resolve, reject) => {
            setImmediate(() => {
                const batch = this.#pendingRetire;
                this.#pendingRetire = new Map();
                this.#retireFlush = null;
                this.#flushRetire([...batch.values()]).then(resolve, reject);
            });
        });
        return this.#retireFlush;
    }

    /**
     * Retire the grants, then tell the recipients. The revoke reports exactly
     * who lost access, which the index can no longer answer — its rows cascade
     * away with the fsentry — and it reports it per permission, so the holders
     * are attributed back to the entry each grant named.
     */
    async #flushRetire(entries: FSEntry[]): Promise<void> {
        const ownerOf = new Map(entries.map((e) => [e.uuid, e]));

        for (let i = 0; i < entries.length; i += RETIRE_CHUNK_SIZE) {
            const chunk = entries.slice(i, i + RETIRE_CHUNK_SIZE);
            const removed = await this.onEntryDeleted(
                chunk.map((entry) => entry.uuid),
            );

            const holdersByEntry = new Map<string, Set<number>>();
            for (const row of removed) {
                const uuid = uuidFromEntryPermission(row.permission);
                const entry = uuid ? ownerOf.get(uuid) : undefined;
                const holderId = Number(row.holder_user_id);
                if (!entry || !Number.isFinite(holderId)) continue;
                if (holderId === entry.userId) continue;
                const holders =
                    holdersByEntry.get(entry.uuid) ?? new Set<number>();
                holders.add(holderId);
                holdersByEntry.set(entry.uuid, holders);
            }

            for (const [uuid, holders] of holdersByEntry) {
                const entry = ownerOf.get(uuid) as FSEntry;
                await this.#emitGui(
                    'outer.gui.item.removed',
                    [...holders],
                    holderPayload(entry),
                );
            }
        }
    }

    async #fanOutToHolders(
        entry: FSEntry,
        event: 'outer.gui.item.moved' | 'outer.gui.item.updated',
        response: Record<string, unknown>,
    ): Promise<void> {
        // Ancestors too: someone given a folder sees what happens inside it,
        // and the changed file itself carries no share of its own.
        const rows = await this.#sharesReaching(entry);
        const holders = [
            ...new Set(
                rows.map((row: { holder_user_id: number }) =>
                    Number(row.holder_user_id),
                ),
            ),
        ].filter((id) => Number.isFinite(id) && id !== entry.userId);
        if (holders.length === 0) return;

        await this.#emitGui(event, holders, response);
    }

    /**
     * Active shares on this node or on anything above it.
     *
     * This runs behind every file write, so it stays on indexed access paths
     * only: the ancestors are resolved to row ids through the fsentry store
     * (cached, and by path, which is indexed), and the share lookup is then a
     * single `fsentry_id IN (...)` against `idx_share_fsentry`. Asking the
     * share table to join fsentries and match `path IN (...)` instead put an
     * un-indexable OR on the write path.
     */
    async #sharesReaching(
        entry: FSEntry,
    ): Promise<Array<{ holder_user_id: number }>> {
        const ancestorPaths: string[] = [];
        for (
            let cursor = pathPosix.dirname(entry.path);
            cursor !== '/' && cursor !== '.';
            cursor = pathPosix.dirname(cursor)
        ) {
            ancestorPaths.push(cursor);
        }
        const ancestors =
            ancestorPaths.length > 0
                ? await this.stores.fsEntry.getEntriesByPaths(ancestorPaths)
                : new Map<string, FSEntry>();
        const ids = [
            entry.id,
            ...[...ancestors.values()].map((node) => node.id),
        ].filter((id): id is number => typeof id === 'number');
        return this.stores.share.listReaching(ids);
    }

    async #emitGui(
        event:
            | 'outer.gui.item.removed'
            | 'outer.gui.item.moved'
            | 'outer.gui.item.updated',
        userIds: number[],
        response: Record<string, unknown>,
    ): Promise<void> {
        try {
            await this.clients.event.emit(
                event,
                { user_id_list: userIds, response },
                {},
            );
        } catch {
            // Non-critical.
        }
    }

    // -- Writes -------------------------------------------------------

    /**
     * Grant `mode` on a node to a recipient and index it.
     *
     * The permission is written first: if the index write then fails because
     * the entry died mid-flight, the grant is rolled back rather than left
     * standing invisibly.
     */
    async share(actor: Actor, input: ShareInput): Promise<ResolvedShare> {
        const issuerId = this.#requireUserId(actor);
        const mode = this.#requireMode(input.mode);

        // Authorization before recipient resolution: a caller who cannot
        // manage the entry must learn nothing from this endpoint — including
        // whether an email or username has an account. "Recipient does not
        // exist" may only be observed by someone entitled to share.
        const entry = await this.#resolveEntry(input, actor);
        await this.#assertCanManage(actor, entry, mode);
        const resolved = await this.#resolveRecipient(input.recipient);

        if (resolved.kind === 'pending') {
            return this.#invite(actor, issuerId, entry, resolved.email, mode);
        }
        const holder = resolved.user;

        if (holder.id === issuerId) {
            throw new HttpError(400, 'cannot share with yourself', {
                legacyCode: 'cannot_share_with_self',
            });
        }
        if (holder.id === entry.userId) {
            throw new HttpError(400, 'recipient already owns this item', {
                legacyCode: 'cannot_share_with_owner',
            });
        }
        await this.#assertNotBlocked(issuerId, holder);

        // Changing the mode on an existing share isn't new reach, so it
        // shouldn't spend budget — only a share to someone who doesn't already
        // have one on this node counts.
        const existing = await this.stores.share.listByFsentry(entry.id);
        const indexed = existing.some(
            (row: { holder_user_id: number; issuer_user_id: number }) =>
                row.holder_user_id === holder.id &&
                row.issuer_user_id === issuerId,
        );
        // A grant can predate the index, so the index alone can't say whether
        // this recipient already had reach here.
        const hadAccess =
            indexed || (await this.#hasGrantFrom(entry, holder.id, issuerId));
        const releaseQuota = hadAccess
            ? null
            : await this.#reserveDailyQuota(issuerId);

        try {
            // The grant is user-to-user and belongs to the user, so an app
            // issues it on their behalf rather than in its own name. Which app
            // asked is recorded on the index row below.
            await this.services.acl.setUserUser(
                userRelatedActor(actor),
                this.#actorFor(holder),
                this.#descriptorFor(entry),
                mode,
            );

            const row = await this.stores.share.upsertActive({
                issuerUserId: issuerId,
                holderUserId: holder.id,
                fsentryId: entry.id,
                mode,
                recipientEmail: holder.email ?? null,
                issuerAppUid: actor.app?.uid ?? null,
            });
            return {
                ...this.#resolve(row, entry, actor, holder),
                holderId: holder.id,
                isNew: !hadAccess,
            };
        } catch (err) {
            await releaseQuota?.();
            // Undo only reach this call created. Rolling back a mode change
            // would revoke access the caller already had and leave the index
            // row pointing at a grant that no longer exists.
            if (!hadAccess) {
                await this.#revokeQuietly(
                    userRelatedActor(actor),
                    entry,
                    holder.username,
                    issuerId,
                );
            }
            throw err;
        }
    }

    /** Whether `issuerId` already grants `holderId` anything on this node. */
    async #hasGrantFrom(
        entry: FSEntry,
        holderId: number,
        issuerId: number,
    ): Promise<boolean> {
        const rows = await this.stores.permission.readLinkedUserUserPerms(
            holderId,
            entryPermissions(entry.uuid),
        );
        return rows.some((row) => Number(row.issuer_user_id) === issuerId);
    }

    /** Everyone currently granting `holderId` something on this node. */
    async #issuersGranting(
        entry: FSEntry,
        holderId: number,
    ): Promise<number[]> {
        const rows = await this.stores.permission.readLinkedUserUserPerms(
            holderId,
            entryPermissions(entry.uuid),
        );
        return [
            ...new Set(rows.map((row) => Number(row.issuer_user_id))),
        ].filter((id) => Number.isFinite(id));
    }

    /**
     * Of `entries`, the uuids `holderId` still holds a live grant on.
     *
     * The index is not proof of access: a grant can be withdrawn or downgraded
     * by a path that never touches a share row (an ACL mode change, say), and
     * this listing publishes name, size and a signed thumbnail URL — so it has
     * to be checked against the grants themselves.
     *
     * Two batched reads for the whole page, both keyed on the holder: the
     * linked rows are indexed on `holder_user_id`, and the flat view is a
     * multi-get. An ACL walk per row would be the same answer at hundreds of
     * times the cost.
     */
    async #liveGrants(
        holderId: number,
        entries: FSEntry[],
    ): Promise<Set<string>> {
        if (entries.length === 0) return new Set();
        const wanted = entries.flatMap((entry) => entryPermissions(entry.uuid));
        const [linked, flat] = await Promise.all([
            this.stores.permission.readLinkedUserUserPerms(holderId, wanted),
            this.stores.permission.getFlatUserPerms(holderId, wanted),
        ]);

        const live = new Set<string>();
        for (const row of linked) {
            const uuid = uuidFromEntryPermission(row.permission);
            if (uuid) live.add(uuid);
        }
        // Not positional against `wanted`: misses are dropped, keys deduped.
        for (const value of flat) {
            if (!value?.permission || value.deleted) continue;
            const uuid = uuidFromEntryPermission(value.permission);
            if (uuid) live.add(uuid);
        }
        // An owner listing something shared *to* them can't happen, but a
        // recipient who has since become the owner (a move handed the tree
        // over) holds it outright and has no grant row.
        for (const entry of entries) {
            if (entry.userId === holderId) live.add(entry.uuid);
        }
        return live;
    }

    /** The `<holderId>:<fsentryId>` pairs whose grant is still standing. */
    async #reachingHolders(
        rows: ShareIndexRow[],
        nodeById: Map<number, FSEntry>,
    ): Promise<Set<string>> {
        const nodesByHolder = new Map<number, Map<number, FSEntry>>();
        for (const row of rows) {
            const holderId = Number(row.holder_user_id);
            const node = nodeById.get(Number(row.fsentry_id));
            if (!node || !Number.isFinite(holderId)) continue;
            const nodes = nodesByHolder.get(holderId) ?? new Map();
            nodes.set(node.id as number, node);
            nodesByHolder.set(holderId, nodes);
        }

        const live = new Set<string>();
        await Promise.all(
            [...nodesByHolder].map(async ([holderId, nodes]) => {
                const uuids = await this.#liveGrants(holderId, [
                    ...nodes.values(),
                ]);
                for (const node of nodes.values()) {
                    if (uuids.has(node.uuid)) {
                        live.add(`${holderId}:${node.id}`);
                    }
                }
            }),
        );
        return live;
    }

    /**
     * Withdraw a recipient's access. An owner may clear any issuer's share of
     * their node; anyone else may only clear the ones they issued.
     */
    async unshare(
        actor: Actor,
        input: ShareTarget & { recipient: ShareRecipient },
    ): Promise<{ revoked: number }> {
        const issuerId = this.#requireUserId(actor);
        const [entry, resolved] = await Promise.all([
            this.#resolveEntry(input, actor),
            this.#resolveRecipient(input.recipient),
        ]);

        // Nothing was granted, so there is only the invitation to take back.
        if (resolved.kind === 'pending') {
            await this.#assertCanManage(actor, entry);
            return this.#cancelInvite(entry, resolved.email, issuerId);
        }
        const holder = resolved.user;

        // Dropping your own access needs no authority over the node — only
        // enough visibility that the call can't be used to probe for one.
        const isLeaving = holder.id === issuerId;
        if (isLeaving) {
            await this.#assertCanSee(actor, entry);
        } else {
            await this.#assertCanManage(actor, entry);
        }

        if (holder.id === entry.userId) {
            throw new HttpError(400, 'cannot revoke the owner of an item', {
                legacyCode: 'cannot_revoke_owner',
            });
        }

        // An owner may clear any issuer's share of their node; anyone else may
        // clear the ones they issued, or their own access.
        const isOwner = entry.userId === issuerId;
        const rows = (await this.stores.share.listByFsentry(entry.id)).filter(
            (row: { holder_user_id: number; issuer_user_id: number }) =>
                row.holder_user_id === holder.id &&
                (isOwner || isLeaving || row.issuer_user_id === issuerId),
        );

        // Fall back to the live grants when no index row exists — a grant may
        // predate the index, and a revoke must still work. Reading them is what
        // makes "leave this share" work at all: the issuer there is whoever
        // shared with you, never yourself, so defaulting to the caller would
        // scope the delete to a row that cannot exist and report nothing
        // revoked. Indexed on holder_user_id, and only reached when the index
        // came up empty.
        let issuers: number[] =
            rows.length > 0
                ? [
                      ...new Set(
                          rows.map(
                              (row: { issuer_user_id: number }) =>
                                  row.issuer_user_id,
                          ),
                      ),
                  ]
                : await this.#issuersGranting(entry, holder.id);
        if (!isOwner && !isLeaving) {
            issuers = issuers.filter((issuer) => issuer === issuerId);
        }
        if (issuers.length === 0) issuers = [issuerId];

        // Whatever the holder re-shared goes with them, and this has to run
        // first: when the holder is the actor, clearing their own grants would
        // strip the very `manage` the cascade needs to do it.
        const writer = userRelatedActor(actor);
        let revoked = await this.#revokeDownstream(writer, entry, holder.id);

        for (const issuer of issuers) {
            const { revoked: didRevoke, authorized } = await this.#revokeFor(
                writer,
                entry,
                holder.username,
                issuer as number,
            );
            if (didRevoke) revoked++;
            if (authorized) {
                await this.stores.share.deleteActive({
                    holderUserId: holder.id,
                    fsentryId: entry.id,
                    issuerUserId: issuer as number,
                });
            }
        }
        return { revoked };
    }

    /**
     * Withdraw everything `issuerId` granted on this node, and everything those
     * recipients granted in turn.
     *
     * `seen` guards the walk: two delegates can each have granted the other,
     * and without it the recursion would not terminate.
     */
    async #revokeDownstream(
        actor: Actor,
        entry: FSEntry,
        issuerId: number,
        seen: Set<number> = new Set(),
    ): Promise<number> {
        if (seen.has(issuerId)) return 0;
        seen.add(issuerId);

        // The whole subtree, not just this node: `manage` inherits downwards,
        // so a grant on a descendant can rest on authority held here.
        const rows = (
            await this.stores.share.listByFsentrySubtree(entry.id)
        ).filter(
            (row: { issuer_user_id: number }) =>
                Number(row.issuer_user_id) === issuerId,
        );
        if (rows.length === 0) return 0;

        const [nodes, holders] = await Promise.all([
            this.stores.fsEntry.getEntriesByIds(
                rows.map((row: { fsentry_id: number }) =>
                    Number(row.fsentry_id),
                ),
            ),
            this.stores.user.getByIds(
                rows.map((row: { holder_user_id: number }) =>
                    Number(row.holder_user_id),
                ),
            ),
        ]);

        let revoked = 0;
        for (const row of rows) {
            const holderId = Number(row.holder_user_id);
            const node = nodes.get(Number(row.fsentry_id));
            const downstream = holders.get(holderId);
            if (!node || !downstream?.username) continue;

            const { revoked: didRevoke, authorized } = await this.#revokeFor(
                actor,
                node,
                downstream.username,
                issuerId,
            );
            if (didRevoke) revoked++;
            if (authorized) {
                await this.stores.share.deleteActive({
                    holderUserId: holderId,
                    fsentryId: node.id,
                    issuerUserId: issuerId,
                });
            }

            // Only carry on down if this actually cost them their authority.
            // A delegate granted `manage` by two people keeps it when one
            // withdraws, and what they granted is not theirs to lose.
            const stillHolds =
                await this.services.permission.canManagePermission(
                    this.#actorFor(downstream),
                    `fs:${node.uuid}:read`,
                );
            if (stillHolds) continue;

            revoked += await this.#revokeDownstream(
                actor,
                entry,
                holderId,
                seen,
            );
        }
        return revoked;
    }

    /**
     * Retire the grants pointing at a node that no longer exists. Returns the
     * rows removed, which is the only record of who had access — the index rows
     * cascade away with the fsentry.
     */
    async onEntryDeleted(entryUids: string | string[]): Promise<
        Array<{
            holder_user_id: number;
            issuer_user_id: number;
            permission: string;
        }>
    > {
        const uids = Array.isArray(entryUids) ? entryUids : [entryUids];
        if (uids.length === 0) return [];
        // Two prefixes per entry, because `manage:fs:<uuid>` does not sit under
        // `fs:<uuid>` — leaving it behind would keep a live grant on a node
        // that no longer exists, and `manage` answers every mode.
        const removed =
            await this.stores.permission.deleteUserUserPermsByPermissionPrefixes(
                uids.flatMap((uid) => [`fs:${uid}`, `manage:fs:${uid}`]),
            );

        // Retiring the rows is not enough: a holder's cached scan still answers
        // "allowed" until it ages out. The revoke path bumps for this reason,
        // and a delete has to as well or access outlives the file.
        const holderIds = [
            ...new Set(removed.map((row) => Number(row.holder_user_id))),
        ].filter((id) => Number.isFinite(id));
        const holders = await this.stores.user.getByIds(holderIds);
        await this.stores.permission.bumpCacheGenerations(
            [...holders.values()]
                .filter((user) => user.uuid)
                .map((user) => `user:${user.uuid}`),
        );

        return removed;
    }

    /**
     * Retire the shares on a node that has just changed owner.
     *
     * A grant names a uuid, so it would otherwise ride along into the new
     * owner's tree and leave them with recipients they never agreed to. The
     * fsentry survives the move, so nothing cascades — the rows have to go
     * explicitly.
     *
     * Scoped by the share index rather than by walking the subtree: the work is
     * bounded by how many shares exist under the node (usually none), not by
     * how many files it holds, and the recursive walk rides `parent_id`.
     */
    async onEntryOwnerChanged(entry: FSEntry): Promise<void> {
        const rows = entry.isDir
            ? await this.stores.share.listByFsentrySubtree(entry.id)
            : await this.stores.share.listByFsentry(entry.id);
        const fsentryIds = [
            ...new Set([
                entry.id,
                ...rows.map((row: { fsentry_id: number }) =>
                    Number(row.fsentry_id),
                ),
            ]),
        ].filter((id) => Number.isFinite(id));

        const nodes = await this.stores.fsEntry.getEntriesByIds(fsentryIds);
        const uuids = [...nodes.values()].map((node) => node.uuid);
        if (uuids.length > 0) await this.onEntryDeleted(uuids);
        await this.stores.share.deleteByFsentryIds(fsentryIds);
    }

    // -- Reads --------------------------------------------------------

    /**
     * What has been shared with `actor`, newest page first by id. Entries are
     * hydrated in one batch; rows whose entry is gone, or which resolve into
     * the owner's trash, are dropped — the share survives a trashing so a
     * restore is lossless, it just shouldn't be listed.
     */
    async listSharedWithMe(
        actor: Actor,
        opts: { limit?: number; cursor?: string; includeTotal?: boolean } = {},
    ): Promise<{
        items: ResolvedShare[];
        cursor?: string;
        total?: number;
    }> {
        const holderId = this.#requireUserId(actor);
        const page = await this.stores.share.listByHolder(holderId, {
            limit: opts.limit,
            cursor: opts.cursor,
        });

        const entries = await this.stores.fsEntry.getEntriesByIds(
            page.items.map((row: { fsentry_id: number }) => row.fsentry_id),
        );
        const issuers = await this.stores.user.getByIds([
            ...page.items.map((row: { issuer_user_id: number }) =>
                Number(row.issuer_user_id),
            ),
            ...[...entries.values()].map((entry) => entry.userId),
        ]);

        // Everything listed here is a shared root, so record them all: entries
        // reached by opening one keep the same masked root and stay navigable.
        await learnShareRoots([...entries.values()], actor);

        // Two independent bounds. The grant has to still be there — the index
        // row outlives it if access was withdrawn any other way. And an app
        // sees only the part of that its user handed to the app, where a
        // session sees all of it.
        const [live, reachable] = await Promise.all([
            this.#liveGrants(holderId, [...entries.values()]),
            this.#reachableBy(actor, [...entries.values()]),
        ]);

        const items: ResolvedShare[] = [];
        for (const row of page.items) {
            const entry = entries.get(Number(row.fsentry_id));
            if (!entry || this.#isTrashed(entry)) continue;
            if (!live.has(entry.uuid)) continue;
            if (!reachable.has(entry.uuid)) continue;
            const issuer = issuers.get(Number(row.issuer_user_id));
            const owner = issuers.get(Number(entry.userId));
            items.push({
                uid: row.uid,
                mode: row.mode,
                path: maskEntryPath(entry),
                name: entry.name,
                type: entry.isDir
                    ? 'folder'
                    : contentTypeFromMime(entry.name) || null,
                thumbnail: entry.thumbnail ?? null,
                entryUid: entry.uuid,
                isDir: Boolean(entry.isDir),
                owner: { username: owner?.username ?? null },
                issuer: { username: issuer?.username ?? null },
                holder: { username: actor.user.username ?? null },
                createdAt: row.created_at,
                modified: entry.modified,
                size: entry.size,
            });
        }

        return {
            items,
            ...(page.cursor ? { cursor: page.cursor } : {}),
            ...(opts.includeTotal
                ? { total: await this.stores.share.countByHolder(holderId) }
                : {}),
        };
    }

    /**
     * Who can reach one node. Includes shares a `manage` delegate issued, which
     * the permission tables alone can't show the owner.
     */
    async listSharesOf(
        actor: Actor,
        target: ShareTarget,
    ): Promise<ResolvedShare[]> {
        const entry = await this.#resolveEntry(target, actor);
        await this.#assertCanManage(actor, entry);

        // Access is inherited down the tree, so a node's own rows are only
        // half the answer — without the ancestors' the caller is told nobody
        // can reach a file that several people can.
        const ancestors = (
            await this.services.fs.getAncestorChain(entry.path)
        ).slice(1);
        const ancestorNodes = await this.stores.fsEntry.getEntriesByPaths(
            ancestors.map((ancestor) => ancestor.path),
        );
        // The ancestor a share was granted on is published masked too: to a
        // delegate, the folder above their share is still the owner's business.
        const viaById = new Map(
            [...ancestorNodes.values()].map((node) => [
                node.id,
                maskEntryPath(node),
            ]),
        );
        const nodeById = new Map(
            [entry, ...ancestorNodes.values()].map((node) => [node.id, node]),
        );
        const inherited: Array<{ row: ShareIndexRow; via: string }> = (
            await this.stores.share.listByFsentries([...viaById.keys()])
        ).map((row: ShareIndexRow) => ({
            row,
            via: viaById.get(Number(row.fsentry_id)) as string,
        }));

        const rows = await this.stores.share.listByFsentry(entry.id);
        const pendingRows = await this.stores.share.listPendingOnFsentry(
            entry.id,
        );
        const userIds = [
            ...[...rows, ...inherited.map((i) => i.row)].flatMap(
                (row: { issuer_user_id: number; holder_user_id: number }) => [
                    Number(row.issuer_user_id),
                    Number(row.holder_user_id),
                ],
            ),
            ...pendingRows.map((row: { issuer_user_id: number }) =>
                Number(row.issuer_user_id),
            ),
        ];
        const users = await this.stores.user.getByIds(userIds);
        const maskedPath = maskEntryPath(entry);

        // As in `#liveGrants`: an index row outlives the grant it records.
        const stillReaches = await this.#reachingHolders(
            [...rows, ...inherited.map((i) => i.row)],
            nodeById,
        );
        const isLive = (row: ShareIndexRow): boolean =>
            stillReaches.has(
                `${Number(row.holder_user_id)}:${Number(row.fsentry_id)}`,
            );

        const inheritedShares: ResolvedShare[] = inherited
            .filter(({ row }) => isLive(row))
            .map(({ row, via }) => ({
                uid: String(row.uid),
                mode: String(row.mode),
                path: maskedPath,
                entryUid: entry.uuid,
                isDir: Boolean(entry.isDir),
                issuer: {
                    username:
                        users.get(Number(row.issuer_user_id))?.username ?? null,
                },
                holder: {
                    username:
                        users.get(Number(row.holder_user_id))?.username ?? null,
                },
                createdAt: row.created_at,
                issuedByApp: issuedByApp(row),
                inheritedFrom: via,
                modified: entry.modified,
                size: entry.size,
            }));

        const own: ResolvedShare[] = rows
            .filter(isLive)
            .map(
                (row: {
                    uid: string;
                    mode: string;
                    issuer_user_id: number;
                    holder_user_id: number;
                    created_at: unknown;
                    data?: unknown;
                }): ResolvedShare => ({
                    uid: row.uid,
                    mode: row.mode,
                    path: maskedPath,
                    entryUid: entry.uuid,
                    isDir: Boolean(entry.isDir),
                    issuer: {
                        username:
                            users.get(Number(row.issuer_user_id))?.username ??
                            null,
                    },
                    holder: {
                        username:
                            users.get(Number(row.holder_user_id))?.username ??
                            null,
                    },
                    createdAt: row.created_at,
                    issuedByApp: issuedByApp(row),
                    inheritedFrom: null,
                    modified: entry.modified,
                    size: entry.size,
                }),
            );
        // Nobody holds an invite yet, but whoever manages the node needs to
        // see who was asked, and be able to take it back.
        const pending: ResolvedShare[] = pendingRows.map(
            (row: {
                uid: string;
                mode: string;
                issuer_user_id: number;
                recipient_email: string;
                created_at: unknown;
                data?: unknown;
            }): ResolvedShare => ({
                uid: row.uid,
                mode: row.mode,
                path: maskedPath,
                entryUid: entry.uuid,
                isDir: Boolean(entry.isDir),
                issuer: {
                    username:
                        users.get(Number(row.issuer_user_id))?.username ?? null,
                },
                holder: { username: null },
                pending: true,
                // What the sharer typed, when it differs from the canonical
                // form the row is keyed on — that is the address they will
                // recognize in the dialog.
                recipientEmail:
                    (row.data as { invitedAddress?: string } | null)
                        ?.invitedAddress ?? row.recipient_email,
                createdAt: row.created_at,
                issuedByApp: issuedByApp(row),
                inheritedFrom: null,
                modified: entry.modified,
                size: entry.size,
            }),
        );

        return inheritedShares.concat(own, pending);
    }

    // -- Blocking -----------------------------------------------------

    /**
     * Refuse shares from everyone, or accept them again. The blanket answer to
     * the same question `blockSender` answers about one person; the per-sender
     * list is kept either way, so turning this off restores it rather than
     * asking the user to rebuild it.
     *
     * `updateMetadata` merges rather than replaces, and refreshes the cached
     * row, so the switch bites on the very next share.
     */
    async setBlockAllSenders(
        actor: Actor,
        blocked: boolean,
    ): Promise<{ all: boolean }> {
        const blockerId = this.#requireUserId(actor);
        await this.stores.user.updateMetadata(blockerId, {
            [BLOCK_ALL_SHARES_KEY]: blocked,
        });
        return { all: blocked };
    }

    /**
     * Refuse further shares from `username`. Existing shares stand: access
     * someone already has is theirs until it is withdrawn, and a control
     * labelled "block" silently revoking it would be a surprise.
     */
    async blockSender(
        actor: Actor,
        username: string,
    ): Promise<{ username: string; created: boolean }> {
        const blockerId = this.#requireUserId(actor);
        const target = await this.#requireUserByUsername(username);
        if (target.id === blockerId) {
            throw new HttpError(400, 'cannot block yourself', {
                legacyCode: 'cannot_block_self',
            });
        }
        const created = await this.stores.userBlock.create(
            blockerId,
            target.id,
        );
        return { username: target.username as string, created };
    }

    /** Accept shares from `username` again. */
    async unblockSender(
        actor: Actor,
        username: string,
    ): Promise<{ username: string; unblocked: boolean }> {
        const blockerId = this.#requireUserId(actor);
        const target = await this.#requireUserByUsername(username);
        const unblocked = await this.stores.userBlock.deleteByPair(
            blockerId,
            target.id,
        );
        return { username: target.username as string, unblocked };
    }

    /**
     * Who the caller refuses shares from, and whether they refuse everyone.
     * Usernames only — ids aren't theirs.
     */
    async listBlockedSenders(actor: Actor): Promise<{
        all: boolean;
        items: Array<{ username: string; createdAt: number }>;
    }> {
        const blockerId = this.#requireUserId(actor);
        const [blocker, rows] = await Promise.all([
            this.stores.user.getById(blockerId),
            this.stores.userBlock.listByBlocker(blockerId),
        ]);
        const users = await this.stores.user.getByIds(
            rows.map((row) => Number(row.blocked_user_id)),
        );
        const items: Array<{ username: string; createdAt: number }> = [];
        for (const row of rows) {
            // A miss means the read raced an account deletion.
            const username = users.get(Number(row.blocked_user_id))?.username;
            if (!username) continue;
            items.push({ username, createdAt: Number(row.created_at) });
        }
        return { all: blocksAllShares(blocker), items };
    }

    /**
     * Stop here when the recipient is not accepting this share. Said plainly
     * rather than disguised as a missing recipient, so a sender whose share
     * will never arrive stops re-sending it; only a caller who already passed
     * the manage check can get this far, so it is no probe for who blocked
     * whom.
     *
     * Refusing everyone and refusing this sender report identically — which of
     * the two it is is the recipient's business, not the sender's.
     *
     * The recipient's row is already in hand from resolution, so the blanket
     * switch is free; only a caller who cleared it pays for the pair lookup.
     */
    async #assertNotBlocked(issuer: number, holder: UserRow): Promise<void> {
        const blocked =
            blocksAllShares(holder) ||
            (await this.stores.userBlock.isBlocked(holder.id, issuer));
        if (!blocked) return;
        throw new HttpError(403, 'recipient is not accepting shares', {
            legacyCode: 'recipient_not_accepting_shares',
        });
    }

    // -- Internals ----------------------------------------------------

    async #requireUserByUsername(username: string): Promise<UserRow> {
        const name = typeof username === 'string' ? username.trim() : '';
        const user = name ? await this.stores.user.getByUsername(name) : null;
        if (!user?.username) {
            throw new HttpError(404, 'Recipient does not exist', {
                legacyCode: 'user_does_not_exist',
            });
        }
        return user;
    }

    /**
     * Turn every invite aimed at `email` into a real grant, now that its owner
     * is known.
     *
     * Each is re-authorized as it is claimed: an invite can sit for weeks, and
     * the issuer may have lost the right to share it since. One that no longer
     * holds is dropped, and never blocks the rest.
     */
    async claimPendingShares(
        holderUserId: number,
        email: string,
    ): Promise<ResolvedShare[]> {
        // Canonical on both sides: rows are stored cleaned, and the confirmed
        // address may be any variant of what the sharer typed.
        const pending = await this.stores.share.listPendingByEmail(
            cleanEmail(email),
        );
        if (pending.length === 0) return [];

        const holder = await this.stores.user.getById(holderUserId);
        if (!holder?.username) return [];

        const claimed: ResolvedShare[] = [];
        for (const row of pending) {
            try {
                const entry = await this.stores.fsEntry.getEntryById(
                    Number(row.fsentry_id),
                );
                if (!entry) {
                    await this.stores.share.deleteByUid(row.uid);
                    continue;
                }
                // The address may have been theirs all along.
                if (
                    entry.userId === holderUserId ||
                    Number(row.issuer_user_id) === holderUserId
                ) {
                    await this.stores.share.deleteByUid(row.uid);
                    continue;
                }

                const issuer = await this.stores.user.getById(
                    Number(row.issuer_user_id),
                );
                if (!issuer) {
                    await this.stores.share.deleteByUid(row.uid);
                    continue;
                }
                // An invite can sit for weeks; its address's owner may have
                // stopped accepting shares — from this sender, or from anyone
                // — since it was sent.
                if (
                    blocksAllShares(holder) ||
                    (await this.stores.userBlock.isBlocked(
                        holderUserId,
                        Number(row.issuer_user_id),
                    ))
                ) {
                    await this.stores.share.deleteByUid(row.uid);
                    continue;
                }
                const issuerActor = this.#actorFor(issuer);
                // Re-authorized against the mode the invite actually grants:
                // an issuer can keep authority over `read` while having lost
                // `write`, and checking a fixed `read` here would wave a
                // write-mode invite through to a grant that then fails.
                const stillAllowed =
                    await this.services.permission.canManagePermission(
                        issuerActor,
                        entryPermissionForMode(entry.uuid, row.mode as string),
                    );
                if (!stillAllowed) {
                    await this.stores.share.deleteByUid(row.uid);
                    continue;
                }

                // The row is claimed before the grant is written. In this
                // order, losing the race to a concurrent cancel means no grant
                // exists yet — nothing to clean up. Granting first left a
                // durable permission behind whenever the cancel won, and no
                // listing showed it, because listings are driven by the rows.
                let applied;
                try {
                    applied = await this.stores.share.applyPending({
                        uid: row.uid,
                        holderUserId,
                    });
                } catch (err) {
                    // A duplicate of an invite already claimed (or of an
                    // active share) collides with the unique index the moment
                    // it gains a holder. It can never be applied, so it is
                    // noise to be cleared, not an invite to keep retrying.
                    if (!isUniqueViolation(err)) throw err;
                    await this.stores.share.deleteByUid(row.uid);
                    continue;
                }
                if (!applied) continue;

                try {
                    await this.services.acl.setUserUser(
                        issuerActor,
                        this.#actorFor(holder),
                        this.#descriptorFor(entry),
                        row.mode as AclMode,
                    );
                } catch (err) {
                    // The row now names a holder but no grant backs it; left
                    // standing it would re-fail identically on every future
                    // claim. An invite whose grant cannot be written no longer
                    // holds, and those are dropped.
                    await this.stores.share.deleteByUid(row.uid);
                    throw err;
                }

                claimed.push({
                    ...this.#resolve(applied, entry, issuerActor, holder),
                    holderId: holderUserId,
                    isNew: true,
                });
            } catch (err) {
                console.warn(
                    '[ShareService] could not claim pending share',
                    row.uid,
                    err,
                );
            }
        }
        return claimed;
    }

    /**
     * Withdraw an invite before it is claimed. An owner may clear any issuer's
     * invite on their node; anyone else only the ones they sent.
     */
    async #cancelInvite(
        entry: FSEntry,
        email: string,
        issuerId: number,
    ): Promise<{ revoked: number }> {
        const isOwner = entry.userId === issuerId;
        const rows = (
            await this.stores.share.listPendingByEmail(cleanEmail(email))
        ).filter(
            (row: { fsentry_id: number; issuer_user_id: number }) =>
                Number(row.fsentry_id) === entry.id &&
                (isOwner || Number(row.issuer_user_id) === issuerId),
        );
        let revoked = 0;
        for (const row of rows) {
            if (await this.stores.share.deleteByUid(row.uid)) revoked += 1;
        }
        return { revoked };
    }

    /**
     * Record a share for an address with no confirmed account. There is nobody
     * to grant to, so the row is the whole share until it is claimed.
     *
     * Spends daily quota: an invite is reach the issuer is handing out, and
     * exempting it would make the limit optional.
     */
    async #invite(
        actor: Actor,
        issuerId: number,
        entry: FSEntry,
        email: string,
        mode: AclMode,
    ): Promise<ResolvedShare> {
        // Checked before anything is written or spent: an address that can't
        // receive the invite must not become a permanent pending row. The
        // send-time check can't do this — by then the row exists whatever
        // happens to the email.
        if (
            !EMAIL_SHAPE.test(email) ||
            !(await this.clients.email.validate(email))
        ) {
            throw new HttpError(400, 'invalid recipient email address', {
                legacyCode: 'email_not_allowed',
            });
        }

        // An alias we won't grant on can still land in the blocker's inbox.
        const mayReach =
            (await this.stores.user.findEmailOwner(email)) ??
            (await this.stores.user.getByCleanEmail(abuseKey(email)));
        if (mayReach) await this.#assertNotBlocked(issuerId, mayReach);

        // Stored canonicalized, because claiming matches on it: the confirmed
        // address arrives in whatever form the signup normalized to, and an
        // exact match against what the sharer happened to type loses the
        // invite to a capital letter. The typed form still matters — it is
        // where the invite email goes, and what the sharer recognizes in the
        // dialog — so it rides along in the row's data.
        const canonical = cleanEmail(email);
        const existing = await this.stores.share.listPendingByEmail(canonical);
        const already = existing.some(
            (row: { fsentry_id: number; issuer_user_id: number }) =>
                Number(row.fsentry_id) === entry.id &&
                Number(row.issuer_user_id) === issuerId,
        );
        const releaseQuota = already
            ? null
            : await this.#reserveDailyQuota(issuerId);

        try {
            const { row, created } = await this.stores.share.upsertPending({
                issuerUserId: issuerId,
                recipientEmail: canonical,
                displayEmail: email,
                fsentryId: entry.id,
                mode,
                issuerAppUid: actor.app?.uid ?? null,
            });
            return {
                ...this.#resolve(row, entry, actor, { username: null }),
                pending: true,
                recipientEmail: email,
                isNew: created,
            };
        } catch (err) {
            await releaseQuota?.();
            throw err;
        }
    }

    #resolve(
        row: { uid: string; mode: string; created_at?: unknown },
        entry: FSEntry,
        issuer: Actor,
        holder: { username: string | null },
    ): ResolvedShare {
        return {
            uid: row.uid,
            mode: row.mode,
            path: maskEntryPath(entry),
            name: entry.name,
            entryUid: entry.uuid,
            isDir: Boolean(entry.isDir),
            issuer: { username: issuer.user.username ?? null },
            holder: { username: holder.username ?? null },
            createdAt: row.created_at,
            modified: entry.modified,
            size: entry.size,
        };
    }

    /** A plain user actor, for asking the permission layer about someone else. */
    #actorFor(user: { id: number; uuid?: string; username?: string }): Actor {
        return {
            user: {
                id: user.id,
                uuid: user.uuid,
                username: user.username,
            } as Actor['user'],
            effectiveApp: null,
        };
    }

    #requireUserId(actor: Actor): number {
        const id = actor?.user?.id;
        if (typeof id !== 'number') {
            throw new HttpError(403, 'actor must be a user', {
                legacyCode: 'forbidden',
            });
        }
        return id;
    }

    #requireMode(mode: string): AclMode {
        if (!SHAREABLE_MODES.has(mode)) {
            throw new HttpError(400, `unknown share mode: ${mode}`, {
                legacyCode: 'invalid_mode',
            });
        }
        return mode as AclMode;
    }

    async #resolveEntry(target: ShareTarget, actor?: Actor): Promise<FSEntry> {
        const entry = target.uid
            ? await this.stores.fsEntry.getEntryByUuid(target.uid)
            : target.path
              ? await this.stores.fsEntry.getEntryByPath(
                    await resolveSharePath(
                        this.stores.fsEntry,
                        actor,
                        target.path,
                    ),
                )
              : null;
        if (!entry) {
            throw new HttpError(404, 'Subject does not exist', {
                legacyCode: 'subject_does_not_exist',
            });
        }
        return entry;
    }

    /**
     * Who the share is for. An unconfirmed address resolves to an invite rather
     * than a failure; a username cannot be invited, there is nothing to reach.
     */
    async #resolveRecipient(
        recipient: ShareRecipient,
    ): Promise<
        { kind: 'user'; user: UserRow } | { kind: 'pending'; email: string }
    > {
        const email = recipient?.email?.trim();
        const username = recipient?.username?.trim();
        // Case and provider aliases resolve to the account; see #addressOwner.
        const user = email
            ? await this.#addressOwner(email)
            : username
              ? await this.stores.user.getByUsername(username)
              : null;
        // An unconfirmed email is a claim, not an identity: resolving it would
        // hand the share to whoever registered the address first.
        const unconfirmedEmailMatch = Boolean(email) && !user?.email_confirmed;
        if (email && (!user?.username || unconfirmedEmailMatch)) {
            return { kind: 'pending', email };
        }
        if (!user?.username) {
            throw new HttpError(404, 'Recipient does not exist', {
                legacyCode: 'user_does_not_exist',
            });
        }
        return { kind: 'user', user };
    }

    /** Who holds this address. A rewritten local part needs a known domain. */
    async #addressOwner(email: string): Promise<UserRow | null> {
        const owner = await this.stores.user.findEmailOwner(email);
        if (!owner?.email) return owner ?? null;
        const sameAddress =
            owner.email.trim().toLowerCase() === email.trim().toLowerCase();
        if (sameAddress || isProviderCanonicalized(email)) return owner;
        return null;
    }

    /**
     * Gate every share operation on the same question the permission layer
     * already answers. Reported as the ACL's own safe error so a caller who
     * can't even see the node learns nothing from the difference.
     */
    async #assertCanManage(
        actor: Actor,
        entry: FSEntry,
        mode: AclMode = 'see',
    ): Promise<void> {
        // Authority to share lives with the user: they own the node, or hold a
        // `manage` grant on it. An app inherits that authority but is not the
        // one who has it, so this asks the user behind the actor.
        //
        // Asked about the permission actually being handed out, not a fixed
        // `read`. Handing out `manage` needs authority over `manage`, which
        // only the owner has — `grantUserUserPermission` enforces that too, but
        // two layers down and with a rawer error, so a caller who cannot do it
        // should be turned away here.
        const allowed = await this.services.permission.canManagePermission(
            userRelatedActor(actor),
            entryPermissionForMode(entry.uuid, mode),
        );
        // Reach is the second, independent bound: a credential may only hand
        // out access it holds itself. For a session that is a no-op; for an app
        // it is what keeps sharing to its own AppData and the files it was
        // given, rather than everything its user owns.
        if (allowed && (await this.#hasOwnReach(actor, entry, mode))) return;

        const safe = await this.services.acl.getSafeAclError(
            actor,
            this.#descriptorFor(entry),
            'manage',
        );
        throw new HttpError(safe.status, safe.message, {
            legacyCode: safe.fields.code,
        });
    }

    /**
     * Of `entries`, the uuids the acting credential reaches in its own right. A
     * plain session reaches all of them; the checks only run for an app or a
     * token, where each one is a cached scan.
     */
    async #reachableBy(actor: Actor, entries: FSEntry[]): Promise<Set<string>> {
        if (!actor.app && !actor.accessToken) {
            return new Set(entries.map((entry) => entry.uuid));
        }
        const checks = await Promise.all(
            entries.map(async (entry) =>
                (await this.#hasOwnReach(actor, entry, 'see'))
                    ? entry.uuid
                    : null,
            ),
        );
        return new Set(checks.filter((uuid): uuid is string => uuid !== null));
    }

    /** Whether the acting credential itself reaches `entry` at `mode`. */
    async #hasOwnReach(
        actor: Actor,
        entry: FSEntry,
        mode: AclMode,
    ): Promise<boolean> {
        if (!actor.app && !actor.accessToken) return true;
        return this.services.acl.check(actor, this.#descriptorFor(entry), mode);
    }

    /**
     * Take a slot out of today's budget, returning the release for it.
     *
     * The increment is the check: it is atomic, so concurrent callers get
     * distinct numbers and only those at or under the limit proceed. Counting
     * first and writing after would let them all read the same count and pass.
     */
    async #reserveDailyQuota(userId: number): Promise<() => Promise<void>> {
        const limit =
            this.config.share_daily_limit ?? DEFAULT_DAILY_SHARE_LIMIT;
        const noop = async () => {};
        if (limit <= 0) return noop;

        const release = async (): Promise<void> => {
            try {
                await this.stores.share.incrementDailyShareCount(userId, -1);
            } catch {
                // A leaked slot costs the user one share until midnight;
                // failing the request over it would cost them more.
            }
        };

        const used = await this.stores.share.incrementDailyShareCount(userId);
        if (used > limit) {
            await release();
            throw new HttpError(
                429,
                `daily share limit reached (${limit}); try again tomorrow`,
                { legacyCode: 'share_daily_limit_reached' },
            );
        }
        return release;
    }

    async #assertCanSee(actor: Actor, entry: FSEntry): Promise<void> {
        const descriptor = this.#descriptorFor(entry);
        if (await this.services.acl.check(actor, descriptor, 'see')) return;
        const safe = await this.services.acl.getSafeAclError(
            actor,
            descriptor,
            'see',
        );
        throw new HttpError(safe.status, safe.message, {
            legacyCode: safe.fields.code,
        });
    }

    #descriptorFor(entry: FSEntry) {
        const fsService = this.services.fs;
        let cache: Promise<
            ReadonlyArray<{ uid: string; path: string }>
        > | null = null;
        return {
            path: entry.path,
            resolveAncestors: () => {
                if (!cache) cache = fsService.getAncestorChain(entry.path);
                return cache;
            },
        };
    }

    #isTrashed(entry: FSEntry): boolean {
        return /^\/[^/]+\/Trash(\/|$)/u.test(entry.path);
    }

    /**
     * Clear whichever modes the recipient holds on this node.
     *
     * Skips any the actor can't manage rather than aborting: stripping a
     * `manage` grant needs authority only the owner has, so a delegate
     * withdrawing a plain `read` would otherwise fail on reaching it.
     *
     * `authorized` is false when it could manage none of them — the caller must
     * then leave the index row alone, or it hides a grant that is still live.
     */
    async #revokeFor(
        actor: Actor,
        entry: FSEntry,
        username: string,
        issuerUserId: number,
    ): Promise<{ revoked: boolean; authorized: boolean }> {
        const permissions = entryPermissions(entry.uuid);
        const isSelf = username === actor.user.username;
        const manageable = isSelf
            ? permissions.map(() => true)
            : await Promise.all(
                  permissions.map((permission) =>
                      this.services.permission.canManagePermission(
                          actor,
                          permission,
                      ),
                  ),
              );

        let revoked = false;
        for (let i = 0; i < permissions.length; i++) {
            if (!manageable[i]) continue;
            const didRevoke =
                await this.services.permission.revokeUserUserPermission(
                    actor,
                    username,
                    permissions[i],
                    { reason: 'unshared' },
                    { issuerUserId },
                );
            if (didRevoke) revoked = true;
        }
        return { revoked, authorized: manageable.some(Boolean) };
    }

    async #revokeQuietly(
        actor: Actor,
        entry: FSEntry,
        username: string,
        issuerUserId: number,
    ): Promise<void> {
        try {
            await this.#revokeFor(actor, entry, username, issuerUserId);
        } catch {
            // Already failing the request; don't mask the original error.
        }
    }
}
