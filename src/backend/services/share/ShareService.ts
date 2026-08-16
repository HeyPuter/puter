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
import type { FSEntry } from '../../stores/fs/FSEntry';
import type { LayerInstances } from '../../types';
import type { AclMode } from '../acl/ACLService';
import type { puterServices } from '../index';
import { PuterService } from '../types';
import {
    learnShareRoots,
    maskEntryPath,
    resolveSharePath,
} from '../fs/sharePathMask';

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
     * The entry's own name, content type and thumbnail. A share listing has no
     * fsentry behind it for the client to stat for them.
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

/** Shares one user may create per UTC day, absent a config override. */
export const DEFAULT_DAILY_SHARE_LIMIT = 200;

/**
 * How long a recipient stays quiet after one sharer reaches them. Re-sharing an
 * item the recipient already has is not new reach and costs no quota, so
 * without a window it is an unmetered way to keep interrupting someone.
 */
export const SHARE_NOTIFY_WINDOW_SECONDS = 15 * 60;

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
    declare protected services: LayerInstances<typeof puterServices>;

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
            return this.#onEntryRemoved(entry).catch((err) => {
                console.warn(
                    '[ShareService] failed to retire grants for a deleted entry:',
                    entry.uuid,
                    err,
                );
            });
        });

        this.clients.event.on('fs.move.node', (_key, data) => {
            const { node, fromPath } = (data ?? {}) as {
                node?: FSEntry;
                fromPath?: string;
            };
            if (!node?.uuid) return;
            return this.#fanOutToHolders(node, 'outer.gui.item.moved', {
                ...holderPayload(node),
                from_path: fromPath
                    ? maskedSelfPath(node, fromPath)
                    : undefined,
            }).catch(() => {
                // A stale window is better than a failed move.
            });
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
     * Retire the grants, then tell the recipients. The revoke reports exactly
     * who lost access, which the index can no longer answer — its rows cascade
     * away with the fsentry.
     */
    async #onEntryRemoved(entry: FSEntry): Promise<void> {
        const removed = await this.onEntryDeleted(entry.uuid);
        const holders = [
            ...new Set(removed.map((row) => Number(row.holder_user_id))),
        ].filter((id) => Number.isFinite(id) && id !== entry.userId);
        if (holders.length === 0) return;

        await this.#emitGui(
            'outer.gui.item.removed',
            holders,
            holderPayload(entry),
        );
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
     * Active shares on this node or on anything above it. Runs behind every
     * write event, so the ancestor paths come off the entry's own path and the
     * whole answer is one query.
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
        return this.stores.share.listReaching(entry.id, ancestorPaths);
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
        const holder = await this.#resolveRecipient(input.recipient);

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

    /**
     * Tell recipients they were given something: one notification per recipient
     * per request, and at most one per sharer per window.
     *
     * Only shares that created new reach count. A mode change is not something
     * to interrupt someone for, and re-sharing what they already have spends no
     * quota — so the window is what keeps that from becoming a way to spam.
     */
    async notifyRecipients(actor: Actor, shares: ResolvedShare[]) {
        const counts = new Map<number, number>();
        for (const share of shares) {
            if (!share.isNew || !share.holderId) continue;
            counts.set(share.holderId, (counts.get(share.holderId) ?? 0) + 1);
        }
        if (counts.size === 0) return;

        const issuerId = this.#requireUserId(actor);
        const username = actor.user.username;
        await Promise.all(
            [...counts].map(async ([holderId, count]) => {
                if (!(await this.#claimNotifySlot(issuerId, holderId))) return;
                await this.services.notification.notify([holderId], {
                    source: 'sharing',
                    title: `${username} shared ${count === 1 ? 'an item' : `${count} items`} with you`,
                    template: 'file-shared-with-you',
                    fields: { username, count },
                });
            }),
        );
    }

    /** False when this pair was already notified inside the window. */
    async #claimNotifySlot(
        issuerId: number,
        holderId: number,
    ): Promise<boolean> {
        try {
            const claimed = await this.clients.redis.set(
                `share:notify:${issuerId}:${holderId}`,
                '1',
                'EX',
                SHARE_NOTIFY_WINDOW_SECONDS,
                'NX',
            );
            return claimed === 'OK';
        } catch {
            // Notifying twice beats going silent when the cache is down.
            return true;
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

    /**
     * Withdraw a recipient's access. An owner may clear any issuer's share of
     * their node; anyone else may only clear the ones they issued.
     */
    async unshare(
        actor: Actor,
        input: ShareTarget & { recipient: ShareRecipient },
    ): Promise<{ revoked: number }> {
        const issuerId = this.#requireUserId(actor);
        const [entry, holder] = await Promise.all([
            this.#resolveEntry(input, actor),
            this.#resolveRecipient(input.recipient),
        ]);

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

        // Fall back to the issuer's own grant when no index row exists — the
        // grant may predate the index, and a revoke must still work.
        const issuers =
            rows.length > 0
                ? [
                      ...new Set(
                          rows.map(
                              (row: { issuer_user_id: number }) =>
                                  row.issuer_user_id,
                          ),
                      ),
                  ]
                : [issuerId];

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
    async onEntryDeleted(
        entryUid: string,
    ): Promise<Array<{ holder_user_id: number; issuer_user_id: number }>> {
        // Two prefixes, because `manage:fs:<uuid>` does not sit under
        // `fs:<uuid>` — leaving it behind would keep a live grant on a node
        // that no longer exists, and `manage` answers every mode.
        const removed =
            await this.stores.permission.deleteUserUserPermsByPermissionPrefixes(
                [`fs:${entryUid}`, `manage:fs:${entryUid}`],
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

        // A session sees everything shared with it. An app sees only the part
        // of that its user handed to the app — this listing is otherwise the
        // one share surface with no per-entry check behind it.
        const reachable = await this.#reachableBy(actor, [...entries.values()]);

        const items: ResolvedShare[] = [];
        for (const row of page.items) {
            const entry = entries.get(Number(row.fsentry_id));
            if (!entry || this.#isTrashed(entry)) continue;
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
        const inherited: Array<{ row: Record<string, unknown>; via: string }> =
            (await this.stores.share.listByFsentries([...viaById.keys()])).map(
                (row: { fsentry_id: number }) => ({
                    row,
                    via: viaById.get(Number(row.fsentry_id)) as string,
                }),
            );

        const rows = await this.stores.share.listByFsentry(entry.id);
        const userIds = [...rows, ...inherited.map((i) => i.row)].flatMap(
            (row: { issuer_user_id: number; holder_user_id: number }) => [
                Number(row.issuer_user_id),
                Number(row.holder_user_id),
            ],
        );
        const users = await this.stores.user.getByIds(userIds);
        const maskedPath = maskEntryPath(entry);

        const inheritedShares: ResolvedShare[] = inherited.map(
            ({ row, via }) => ({
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
            }),
        );

        const own: ResolvedShare[] = rows.map(
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
                        users.get(Number(row.issuer_user_id))?.username ?? null,
                },
                holder: {
                    username:
                        users.get(Number(row.holder_user_id))?.username ?? null,
                },
                createdAt: row.created_at,
                issuedByApp: issuedByApp(row),
                inheritedFrom: null,
                modified: entry.modified,
                size: entry.size,
            }),
        );
        return inheritedShares.concat(own);
    }

    // -- Internals ----------------------------------------------------

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

    async #resolveRecipient(recipient: ShareRecipient) {
        const email = recipient?.email?.trim();
        const username = recipient?.username?.trim();
        const user = email
            ? await this.stores.user.getByEmail(email)
            : username
              ? await this.stores.user.getByUsername(username)
              : null;
        // An unconfirmed email is a claim, not an identity: resolving it would
        // hand the share to whoever registered the address first.
        const unconfirmedEmailMatch = Boolean(email) && !user?.email_confirmed;
        if (!user?.username || unconfirmedEmailMatch) {
            throw new HttpError(404, 'Recipient does not exist', {
                legacyCode: 'user_does_not_exist',
            });
        }
        return user;
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
        const allowed = await this.services.permission.canManagePermission(
            userRelatedActor(actor),
            `fs:${entry.uuid}:read`,
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
