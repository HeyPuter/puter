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
import { HttpError, isHttpError } from '../../core/http/HttpError.js';
import { runWithConcurrencyLimitSettled } from '../../util/concurrency.js';
import { isUniqueViolation } from '../../util/dbError.js';
import {
    abuseKey,
    cleanEmail,
    isProviderCanonicalized,
} from '../../util/email.js';
import type { FSEntry } from '../../stores/fs/FSEntry';
import type { UserUserAuditFilter } from '../../stores/permission/PermissionStore';
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

/**
 * As above, from a listing that carries unclaimed invites: those have no
 * holder.
 */
interface OutboundShareRow extends Omit<ShareIndexRow, 'holder_user_id'> {
    holder_user_id: number | null;
    recipient_email?: string;
}

export interface ShareInput extends ShareTarget {
    recipient: ShareRecipient;
    mode: AclMode;
}

/** What still backs one (holder, entry) pair; see `#grantEvidence`. */
interface GrantEvidence {
    /** Issuers with a live, attributable grant. */
    issuers: Set<number>;
    /** A live grant that names no issuer — a legacy flat entry. */
    unattributed: boolean;
    /** The holder owns the entry outright, so no grant is needed. */
    owned: boolean;
}

/**
 * One entry in the grant audit trail. Written when a grant is made or
 * withdrawn, and kept afterwards — the row is what remains once the grant
 * itself is gone.
 */
export interface GrantAuditEntry {
    /** 'grant' or 'revoke'; null on a row that predates the column. */
    action: string | null;
    permission: string;
    /** Set when the grant names an fs node; other permissions carry neither. */
    entryUid: string | null;
    mode: string | null;
    issuer: { username: string | null };
    holder: { username: string | null };
    /** The app that was acting, when one was. */
    appUid: string | null;
    createdAt: unknown;
}

/** One app in the outbound listing's group-by-app view. */
export interface OutboundAppSummary {
    /** Null for the grants the user made themselves, outside any app. */
    appUid: string | null;
    /** Null once the app is gone; its grants outlive it. */
    name: string | null;
    title: string | null;
    count: number;
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
    /** Set by `share()` only: who to notify. Never sent to a client. */
    holderId?: number;
    /** Whether this call created reach that didn't exist before. */
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
/**
 * The app recorded on a share row, when one issued it. Two spellings in the
 * wild: pending rows were written with `issuerAppUid` before the keys were
 * unified on `issuedByApp`, and claiming carries `data` forward verbatim.
 */
const issuedByApp = (row: { data?: unknown }): string | null => {
    const data = row.data as {
        issuedByApp?: unknown;
        issuerAppUid?: unknown;
    } | null;
    const value = data?.issuedByApp ?? data?.issuerAppUid;
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

/** The share mode a grant stands for, for the two shapes above. */
export const modeFromEntryPermission = (permission: string): string | null => {
    if (!uuidFromEntryPermission(permission)) return null;
    const parts = permission.split(':');
    return parts[0] === MANAGE_PERM_PREFIX
        ? MANAGE_PERM_PREFIX
        : (parts[2] ?? null);
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
 * recipient's to see. The path is masked at `root`, the share they reach it
 * through, so it matches what their own reads returned.
 */
const holderPayload = (
    entry: FSEntry,
    /** Defaults to the entry itself, for the paths with no root to mask by. */
    root: FSEntry = entry,
    /** Where the entry was; differs from `entry.path` once it has moved. */
    realPath: string = entry.path,
): Record<string, unknown> => {
    const path =
        maskedPathVia(root, realPath) ?? maskedSelfPath(entry, realPath);
    return {
        uid: entry.uuid,
        uuid: entry.uuid,
        name: entry.name,
        path,
        // The desktop finds the container to render into by `dirpath`.
        dirpath: pathPosix.dirname(path),
        is_dir: Boolean(entry.isDir),
        type: entry.isDir ? 'folder' : contentTypeFromMime(entry.name) || null,
        immutable: Boolean(entry.immutable),
        size: entry.size ?? null,
        modified: entry.modified,
        from_new_service: true,
    };
};

/**
 * An `fs.*` event replayed onto this bus by replication rather than raised by a
 * write here. Broadcast only carries `outer.*` and `pubsub.*`, so today nothing
 * reaches these handlers that way — but the node that did the write has already
 * told the audience, and a second fan-out would only duplicate it.
 */
const fromAnotherNode = (meta?: { from_outside?: boolean }): boolean =>
    Boolean(meta?.from_outside);

/** The GUI events a share recipient is an audience for. */
type HolderGuiEvent =
    | 'outer.gui.item.added'
    | 'outer.gui.item.moved'
    | 'outer.gui.item.removed'
    | 'outer.gui.item.renamed'
    | 'outer.gui.item.updated';

/** `/<owner>/<uuid>/<name>` for a path in the owner's tree. */
/** Inside some owner's top-level Trash, which is where Delete puts things. */
const isTrashedPath = (path: string): boolean =>
    /^\/[^/]+\/Trash(\/|$)/u.test(path);

const maskedSelfPath = (entry: FSEntry, realPath: string): string => {
    const owner = realPath.split('/')[1];
    const name = realPath.split('/').pop();
    return owner && name ? `/${owner}/${entry.uuid}/${name}` : realPath;
};

/** Where `entry` was, as this holder knew it; `root` carries the new path. */
const maskedFormerPath = (
    root: FSEntry,
    entry: FSEntry,
    realPath: string,
): string | null =>
    maskedPathVia(root, realPath) ??
    (root.uuid === entry.uuid ? maskedSelfPath(entry, realPath) : null);

/** `realPath` as a holder of `root` addresses it; null when outside that share. */
const maskedPathVia = (root: FSEntry, realPath: string): string | null => {
    const owner = root.path.split('/')[1];
    if (!owner || !root.name) return null;
    const base = `/${owner}/${root.uuid}/${root.name}`;
    if (realPath === root.path) return base;
    if (!realPath.startsWith(`${root.path}/`)) return null;
    return base + realPath.slice(root.path.length);
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
    /** New entries awaiting the next fan-out, by parent path. */
    #pendingCreates = new Map<string, FSEntry[]>();
    #createFlush: Promise<void> | null = null;

    /**
     * FS mutations only notify the owner, leaving a recipient's open window
     * stale. Handled here rather than per controller so the audience logic
     * lives in one place, and over the event bus because fs is constructed
     * first and cannot depend on this service.
     */
    override onServerStart(): void {
        this.clients.event.on('fs.remove.node', (_key, data, meta) => {
            if (fromAnotherNode(meta)) return;
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

        this.clients.event.on('fs.move.node', (_key, data, meta) => {
            if (fromAnotherNode(meta)) return;
            const { node, fromPath, fromUserId } = (data ?? {}) as {
                node?: FSEntry;
                fromPath?: string;
                fromUserId?: number;
            };
            if (!node?.uuid) return;
            const notify = this.#fanOutMove(node, fromPath).catch(() => {
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

        this.clients.event.on('fs.write.file', (_key, data, meta) => {
            if (fromAnotherNode(meta)) return;
            const entry = (data as { node?: FSEntry })?.node;
            if (!entry?.uuid) return;
            return this.#fanOutToHolders(entry, 'outer.gui.item.updated').catch(
                () => {
                    // Same — never fail a write over its notification.
                },
            );
        });

        // A create is `fs.create.<flavor>`, not `fs.write.file`.
        this.clients.event.on('fs.create.*', (_key, data, meta) => {
            if (fromAnotherNode(meta)) return;
            const entry = (data as { node?: FSEntry })?.node;
            if (!entry?.uuid) return;
            return this.#scheduleCreateFanOut(entry).catch(() => {});
        });

        this.clients.event.on('fs.rename', (_key, data, meta) => {
            if (fromAnotherNode(meta)) return;
            const { node: entry, old_path: oldPath } = (data ?? {}) as {
                node?: FSEntry;
                old_path?: string;
            };
            if (!entry?.uuid) return;
            return this.#fanOutToHolders(
                entry,
                'outer.gui.item.renamed',
                (root) => {
                    // The GUI rewrites descendants and open windows by it.
                    const from = oldPath
                        ? maskedFormerPath(root, entry, oldPath)
                        : null;
                    return from ? { old_path: from } : {};
                },
            ).catch(() => {});
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

    /** Same buffering for creates, by parent: siblings share one lookup. */
    #scheduleCreateFanOut(entry: FSEntry): Promise<void> {
        const parent = pathPosix.dirname(entry.path);
        this.#pendingCreates.set(parent, [
            ...(this.#pendingCreates.get(parent) ?? []),
            entry,
        ]);
        this.#createFlush ??= new Promise<void>((resolve, reject) => {
            setImmediate(() => {
                const batch = this.#pendingCreates;
                this.#pendingCreates = new Map();
                this.#createFlush = null;
                this.#flushCreates(batch).then(resolve, reject);
            });
        });
        return this.#createFlush;
    }

    async #flushCreates(batch: Map<string, FSEntry[]>): Promise<void> {
        for (const entries of batch.values()) {
            const first = entries[0];
            if (!first) continue;
            // Safe from one sibling: nothing holds a share on an entry this new.
            const groups = await this.#reachingRoots(first);
            for (const { root, holders } of groups) {
                for (const entry of entries) {
                    await this.#emitGui(
                        'outer.gui.item.added',
                        holders,
                        holderPayload(entry, root),
                    );
                }
            }
        }
    }

    /**
     * Retire the grants, then tell the recipients. The revoke reports exactly
     * who lost access, which the index can no longer answer — its rows cascade
     * away with the fsentry — and it reports it per permission, so the holders
     * are attributed back to the entry each grant named.
     */
    async #flushRetire(entries: FSEntry[]): Promise<void> {
        const ownerOf = new Map(entries.map((e) => [e.uuid, e]));
        const notified = new Map<string, Set<number>>();

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
                notified.set(uuid, holders);
            }
        }

        await this.#fanOutRetiredToAncestors(entries, notified);
    }

    /**
     * Tell whoever reached these through a folder above them — their grant is
     * on that folder, so the revoke reports no holder for them. Coalesced by
     * parent like creates, so a subtree stays a few queries.
     */
    async #fanOutRetiredToAncestors(
        entries: FSEntry[],
        notified: Map<string, Set<number>>,
    ): Promise<void> {
        const byParent = new Map<string, FSEntry[]>();
        for (const entry of entries) {
            const parent = pathPosix.dirname(entry.path);
            byParent.set(parent, [...(byParent.get(parent) ?? []), entry]);
        }

        for (const siblings of byParent.values()) {
            const first = siblings[0];
            if (!first) continue;
            // Ancestors only; a share on the entry is the revoke's to report.
            const groups = (await this.#reachingRoots(first)).filter(
                ({ root }) => root.uuid !== first.uuid,
            );
            for (const { root, holders } of groups) {
                for (const entry of siblings) {
                    const unheard = holders.filter(
                        (holder) => !notified.get(entry.uuid)?.has(holder),
                    );
                    if (!unheard.length) continue;
                    await this.#emitGui(
                        'outer.gui.item.removed',
                        unheard,
                        holderPayload(entry, root),
                    );
                }
            }
        }
    }

    /**
     * A move seen from both ends, since it can take an item out of a share as
     * easily as into it: both ends is a move, only the destination an arrival,
     * only the origin a removal.
     */
    async #fanOutMove(entry: FSEntry, fromPath?: string): Promise<void> {
        const destination = await this.#reachingRoots(entry);
        const origin =
            fromPath && fromPath !== entry.path
                ? await this.#reachingRoots(entry, fromPath)
                : destination;

        const rootsBySide = (
            groups: Array<{ root: FSEntry; holders: number[] }>,
        ) =>
            new Map<number, FSEntry>(
                groups.flatMap(({ root, holders }) =>
                    holders.map((holder) => [holder, root] as const),
                ),
            );
        const originRootOf = rootsBySide(origin);
        const destinationRootOf = rootsBySide(destination);

        // Keyed on both: a holder can see each end through a different share.
        const batches = new Map<
            string,
            {
                event: HolderGuiEvent;
                from?: FSEntry;
                to?: FSEntry;
                holders: number[];
            }
        >();
        const place = (
            holder: number,
            event: HolderGuiEvent,
            from?: FSEntry,
            to?: FSEntry,
        ) => {
            const key = `${event}|${from?.id ?? ''}|${to?.id ?? ''}`;
            const batch = batches.get(key) ?? { event, from, to, holders: [] };
            batch.holders.push(holder);
            batches.set(key, batch);
        };

        // A grant follows its entry into Trash, so Delete would read as a move
        // and rename their item to the GUID Trash gave it. Listings omit it.
        const nowTrashed = isTrashedPath(entry.path);
        const wasTrashed = fromPath ? isTrashedPath(fromPath) : false;

        for (const [holder, to] of destinationRootOf) {
            if (nowTrashed) continue;
            const from = originRootOf.get(holder);
            place(
                holder,
                from && !wasTrashed
                    ? 'outer.gui.item.moved'
                    : 'outer.gui.item.added',
                from,
                to,
            );
        }
        for (const [holder, from] of originRootOf) {
            if (nowTrashed) {
                // Already gone from their view if it was trashed before.
                if (!wasTrashed) place(holder, 'outer.gui.item.removed', from);
                continue;
            }
            if (destinationRootOf.has(holder)) continue;
            place(holder, 'outer.gui.item.removed', from);
        }

        for (const { event, from, to, holders } of batches.values()) {
            if (event === 'outer.gui.item.removed') {
                // Named by where they last saw it, which is all they have.
                await this.#emitGui(
                    event,
                    holders,
                    holderPayload(entry, from as FSEntry, fromPath),
                );
                continue;
            }
            const payload = holderPayload(entry, to as FSEntry);
            const formerPath =
                from && fromPath
                    ? maskedFormerPath(from, entry, fromPath)
                    : null;
            // A share masks its own root, so this move is invisible to them.
            if (formerPath && formerPath === payload.path) continue;
            await this.#emitGui(event, holders, {
                ...payload,
                // The GUI rewrites the item it already has by this.
                ...(formerPath ? { from_path: formerPath } : {}),
            });
        }
    }

    async #fanOutToHolders(
        entry: FSEntry,
        event: HolderGuiEvent,
        extrasFor: (root: FSEntry) => Record<string, unknown> = () => ({}),
    ): Promise<void> {
        // Ancestors too: someone given a folder sees what happens inside it,
        // and the changed file itself carries no share of its own.
        const groups = await this.#reachingRoots(entry);
        // One event per root: the path depends on the share they came through.
        for (const { root, holders } of groups) {
            await this.#emitGui(event, holders, {
                ...holderPayload(entry, root),
                ...extrasFor(root),
            });
        }
    }

    /** Holders who can reach `entry`, grouped by the share they came through. */
    async #reachingRoots(
        entry: FSEntry,
        /** Where to look from; the former path once the entry has moved. */
        realPath: string = entry.path,
    ): Promise<Array<{ root: FSEntry; holders: number[] }>> {
        const { rows, nodesById } = await this.#sharesReaching(entry, realPath);
        // An index row outlives the grant it records, so a recipient revoked
        // through the ACL alone would keep receiving pushes. Free when nothing
        // is shared, which is the path every write takes.
        const live = await this.#reachingHolders(rows, nodesById);

        // Deepest root wins, so a holder with nested shares is told once.
        const rootByHolder = new Map<number, FSEntry>();
        for (const row of rows) {
            const holderId = Number(row.holder_user_id);
            const root = nodesById.get(Number(row.fsentry_id));
            if (!root || !Number.isFinite(holderId)) continue;
            if (holderId === entry.userId) continue;
            if (!live.has(`${holderId}:${root.id}`)) continue;
            const current = rootByHolder.get(holderId);
            if (!current || root.path.length > current.path.length) {
                rootByHolder.set(holderId, root);
            }
        }

        const holdersByRoot = new Map<
            number,
            { root: FSEntry; holders: number[] }
        >();
        for (const [holderId, root] of rootByHolder) {
            const group = holdersByRoot.get(root.id) ?? { root, holders: [] };
            group.holders.push(holderId);
            holdersByRoot.set(root.id, group);
        }
        return [...holdersByRoot.values()];
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
        realPath: string = entry.path,
    ): Promise<{
        rows: ShareIndexRow[];
        nodesById: Map<number, FSEntry>;
    }> {
        const ancestorPaths: string[] = [];
        for (
            let cursor = pathPosix.dirname(realPath);
            cursor !== '/' && cursor !== '.';
            cursor = pathPosix.dirname(cursor)
        ) {
            ancestorPaths.push(cursor);
        }
        const ancestors =
            ancestorPaths.length > 0
                ? await this.stores.fsEntry.getEntriesByPaths(ancestorPaths)
                : new Map<string, FSEntry>();
        const nodesById = new Map<number, FSEntry>(
            [entry, ...ancestors.values()]
                .filter((node) => typeof node.id === 'number')
                .map((node) => [node.id, node]),
        );
        return {
            rows: await this.stores.share.listReaching([...nodesById.keys()]),
            nodesById,
        };
    }

    async #emitGui(
        event: HolderGuiEvent,
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
                issuerAppUid: this.#actingAppUid(actor),
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
     * What still backs each (holder, entry) pair: the issuers with a live
     * grant, whether a live grant exists that names no issuer (legacy flat
     * entries), and whether the holder now owns the entry outright (a move
     * handed the tree over — no grant row, held all the same).
     *
     * The index is not proof of access: a grant can be withdrawn or downgraded
     * by a path that never touches a share row (an ACL mode change, say), and
     * the listings publish name, size and a signed thumbnail URL — so rows are
     * checked against the grants themselves.
     *
     * Two batched reads for all pairs together, however many holders: the
     * linked rows by `holder IN … AND permission IN …`, the flat view as one
     * multi-get. Reading per holder here turned a full outbound page into
     * hundreds of queries on a cold cache.
     */
    async #grantEvidence(
        pairs: Array<{ holderId: number; entry: FSEntry }>,
    ): Promise<Map<string, GrantEvidence>> {
        const evidence = new Map<string, GrantEvidence>();
        const unique = new Map<string, { holderId: number; entry: FSEntry }>();
        for (const pair of pairs) {
            unique.set(`${pair.holderId}:${pair.entry.id}`, pair);
        }
        if (unique.size === 0) return evidence;

        const refs = [...unique.values()].flatMap(({ holderId, entry }) =>
            entryPermissions(entry.uuid).map((permission) => ({
                holderUserId: holderId,
                permission,
            })),
        );
        const [linked, flat] = await Promise.all([
            this.stores.permission.readLinkedUserUserPermsForHolders(
                refs.map((ref) => ref.holderUserId),
                refs.map((ref) => ref.permission),
            ),
            this.stores.permission.getFlatUserPermsForRefs(refs),
        ]);

        // Both reads folded onto (holder, permission); the linked read spans
        // every holder's permissions, so it can return pairs never asked for —
        // they simply go unread below.
        const byHolderPerm = new Map<
            string,
            { issuers: Set<number>; unattributed: boolean }
        >();
        const record = (
            holderId: number,
            permission: string,
            issuer: unknown,
        ) => {
            const key = `${holderId}:${permission}`;
            const found = byHolderPerm.get(key) ?? {
                issuers: new Set<number>(),
                unattributed: false,
            };
            const issuerId = Number(issuer);
            if (Number.isFinite(issuerId)) found.issuers.add(issuerId);
            else found.unattributed = true;
            byHolderPerm.set(key, found);
        };
        for (const row of linked) {
            record(
                Number(row.holder_user_id),
                row.permission,
                row.issuer_user_id,
            );
        }
        for (const { ref, value } of flat) {
            if (value.deleted) continue;
            record(ref.holderUserId, ref.permission, value.issuer_user_id);
        }

        for (const [key, { holderId, entry }] of unique) {
            const merged: GrantEvidence = {
                issuers: new Set(),
                unattributed: false,
                owned: entry.userId === holderId,
            };
            for (const permission of entryPermissions(entry.uuid)) {
                const found = byHolderPerm.get(`${holderId}:${permission}`);
                if (!found) continue;
                for (const issuer of found.issuers) merged.issuers.add(issuer);
                merged.unattributed ||= found.unattributed;
            }
            evidence.set(key, merged);
        }
        return evidence;
    }

    /** Of `entries`, the uuids `holderId` still holds a live grant on. */
    async #liveGrants(
        holderId: number,
        entries: FSEntry[],
    ): Promise<Set<string>> {
        const evidence = await this.#grantEvidence(
            entries.map((entry) => ({ holderId, entry })),
        );
        const live = new Set<string>();
        for (const entry of entries) {
            const found = evidence.get(`${holderId}:${entry.id}`);
            if (!found) continue;
            if (found.owned || found.unattributed || found.issuers.size > 0) {
                live.add(entry.uuid);
            }
        }
        return live;
    }

    /** The (holder, node) pairs `rows` name that both sides resolve for. */
    #rowPairs(
        rows: Array<{ holder_user_id: number | null; fsentry_id: number }>,
        nodeById: Map<number, FSEntry>,
    ): Array<{ holderId: number; entry: FSEntry }> {
        const pairs: Array<{ holderId: number; entry: FSEntry }> = [];
        for (const row of rows) {
            // `Number(null)` is 0, so a pending row must not slip through as
            // holder 0.
            if (!row.holder_user_id) continue;
            const holderId = Number(row.holder_user_id);
            const node = nodeById.get(Number(row.fsentry_id));
            if (!node || !Number.isFinite(holderId)) continue;
            pairs.push({ holderId, entry: node });
        }
        return pairs;
    }

    /**
     * The `<holderId>:<fsentryId>` pairs some grant still backs, whoever issued
     * it. The right bound for fan-out: a holder is reachable through anyone's
     * grant.
     */
    async #reachingHolders(
        rows: ShareIndexRow[],
        nodeById: Map<number, FSEntry>,
    ): Promise<Set<string>> {
        const evidence = await this.#grantEvidence(
            this.#rowPairs(rows, nodeById),
        );
        const live = new Set<string>();
        for (const [key, found] of evidence) {
            if (found.owned || found.unattributed || found.issuers.size > 0) {
                live.add(key);
            }
        }
        return live;
    }

    /**
     * The `<holderId>:<fsentryId>:<issuerId>` triples whose own grant still
     * stands. Sharper than `#reachingHolders`, and what the listings need: on
     * the pair alone, an issuer whose grant was withdrawn outside `unshare` is
     * shown a dead share for as long as anyone else still grants the same
     * holder the same node. A grant that names no issuer backs every issuer's
     * row for its pair, but only while no attributable grant exists — once any
     * does, the attributed set is the answer.
     */
    async #reachingGrants(
        rows: Array<{
            holder_user_id: number | null;
            issuer_user_id: number;
            fsentry_id: number;
        }>,
        nodeById: Map<number, FSEntry>,
    ): Promise<Set<string>> {
        const evidence = await this.#grantEvidence(
            this.#rowPairs(rows, nodeById),
        );
        const live = new Set<string>();
        for (const row of rows) {
            const holderId = Number(row.holder_user_id);
            const node = nodeById.get(Number(row.fsentry_id));
            if (!node || !Number.isFinite(holderId)) continue;
            const found = evidence.get(`${holderId}:${node.id}`);
            if (!found) continue;
            const issuerId = Number(row.issuer_user_id);
            const backed =
                found.owned ||
                found.issuers.has(issuerId) ||
                (found.unattributed && found.issuers.size === 0);
            if (backed) live.add(`${holderId}:${node.id}:${issuerId}`);
        }
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

        return this.#withdrawGrants(actor, entry, holder, issuers);
    }

    /**
     * Clear `issuers`' grants to `holder` on this node, and everything the
     * holder re-shared in turn. The caller has already decided which issuers
     * are in scope — everyone's for an owner, one row's for the uid-addressed
     * revoke — and passed the gates for it.
     */
    async #withdrawGrants(
        actor: Actor,
        entry: FSEntry,
        holder: { id: number; username: string },
        issuers: number[],
    ): Promise<{ revoked: number }> {
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
                issuer,
            );
            if (didRevoke) revoked++;
            if (authorized) {
                await this.stores.share.deleteActive({
                    holderUserId: holder.id,
                    fsentryId: entry.id,
                    issuerUserId: issuer,
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

        // Their unclaimed invites go the same way as their re-shares: an
        // invite rests on the same authority, and nothing else retires it —
        // claiming re-checks, but only when the recipient shows up, and until
        // then the row keeps the entry in the revoked issuer's listing.
        await this.stores.share.deletePendingByIssuerSubtree(
            issuerId,
            entry.id,
        );

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
     * Drop the index row behind a grant that was withdrawn through the
     * permission API rather than `unshare`. The row would otherwise outlive the
     * access it records, and a listing reads the index, not the grant.
     */
    async onGrantRevoked(
        issuer: Actor,
        holderUsername: string,
        permission: string,
    ): Promise<void> {
        const uuid = uuidFromEntryPermission(permission);
        if (!uuid) return;

        const issuerId = issuer?.user?.id;
        const [entry, holder] = await Promise.all([
            this.stores.fsEntry.getEntryByUuid(uuid),
            this.stores.user.getByUsername(holderUsername),
        ]);
        if (!entry || !holder || typeof issuerId !== 'number') return;

        await this.stores.share.deleteActive({
            holderUserId: holder.id,
            fsentryId: entry.id,
            issuerUserId: issuerId,
        });
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
            items.push(
                this.#resolvedShareRow(row, entry, issuers, {
                    entryMeta: true,
                    // Which app the sharer went through is their business, not
                    // the recipient's.
                    provenance: false,
                    holderUsername: actor.user.username ?? null,
                }),
            );
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
     * What the caller has shared out, across every item: the shares they
     * issued, plus the ones a `manage` delegate issued on a node they own.
     * `listSharesOf` answers the same question for a node the caller can
     * already name; this is what answers it when they can't.
     *
     * Trashed items are kept, unlike the inbound listing: the grant on one is
     * still standing, and this is where someone comes to find that out.
     *
     * An app credential sees only what its own app issued, whatever `appUid`
     * asks for; a session may filter by app, and `null` asks for the grants no
     * app issued.
     */
    async listSharedByMe(
        actor: Actor,
        opts: {
            limit?: number;
            cursor?: string;
            includeTotal?: boolean;
            appUid?: string | null;
        } = {},
    ): Promise<{
        items: ResolvedShare[];
        cursor?: string;
        total?: number;
    }> {
        const userId = this.#requireUserId(actor);
        const scope = this.#outboundAppScope(actor, opts.appUid);
        if (scope.empty) {
            return {
                items: [],
                ...(opts.includeTotal ? { total: 0 } : {}),
            };
        }
        const page = await this.stores.share.listOutbound(userId, {
            limit: opts.limit,
            cursor: opts.cursor,
            appUid: scope.appUid,
        });
        const rows: OutboundShareRow[] = page.items;

        const entries = await this.stores.fsEntry.getEntriesByIds(
            rows.map((row) => Number(row.fsentry_id)),
        );
        const users = await this.stores.user.getByIds([
            ...rows.flatMap((row) => [
                Number(row.issuer_user_id),
                ...(row.holder_user_id ? [Number(row.holder_user_id)] : []),
            ]),
            ...[...entries.values()].map((entry) => entry.userId),
        ]);

        const nodeById = new Map<number, FSEntry>(
            [...entries.values()].map((entry) => [entry.id, entry]),
        );
        // Three bounds. A claimed row needs the grant *this issuer* made to
        // still be there — on the pair alone, a grant withdrawn outside
        // `unshare` stays listed while anyone else grants the same holder the
        // same node. An invite needs its issuer to still hold the authority it
        // would grant, or a revoked delegate keeps reading the entry's name
        // and size out of invites that can never be claimed. And an app sees
        // only the part of any of it the credential reaches in its own right.
        const [stillReaches, pendingAllowed, reachable] = await Promise.all([
            this.#reachingGrants(rows, nodeById),
            this.#pendingStillAuthorized(
                rows.filter((row) => !row.holder_user_id),
                nodeById,
                users,
            ),
            this.#reachableBy(actor, [...entries.values()]),
        ]);

        const items: ResolvedShare[] = [];
        for (const row of rows) {
            const entry = entries.get(Number(row.fsentry_id));
            if (!entry) continue;
            if (!reachable.has(entry.uuid)) continue;
            const pending = !row.holder_user_id;
            if (pending && !pendingAllowed.has(row.uid)) continue;
            if (
                !pending &&
                !stillReaches.has(
                    `${Number(row.holder_user_id)}:${entry.id}:${Number(row.issuer_user_id)}`,
                )
            ) {
                continue;
            }
            items.push(
                this.#resolvedShareRow(row, entry, users, { entryMeta: true }),
            );
        }

        return {
            items,
            ...(page.cursor ? { cursor: page.cursor } : {}),
            ...(opts.includeTotal
                ? {
                      total: await this.stores.share.countOutbound(userId, {
                          appUid: scope.appUid,
                      }),
                  }
                : {}),
        };
    }

    /**
     * Which apps hold shares the caller made — the way into the per-app listing
     * for someone who doesn't know which apps to ask about. The group with no
     * `appUid` is what the caller shared themselves.
     *
     * Counts come from the index, so they are what `includeTotal` reports on
     * the listing rather than what survives its per-grant re-checks.
     */
    async listSharedByMeApps(
        actor: Actor,
        opts: { limit?: number; cursor?: string; includeTotal?: boolean } = {},
    ): Promise<{
        items: OutboundAppSummary[];
        cursor?: string;
        total?: number;
    }> {
        const userId = this.#requireUserId(actor);
        if (this.#actingAppUid(actor)) {
            throw new HttpError(
                403,
                'This view is only available to user sessions',
                { legacyCode: 'forbidden' },
            );
        }

        const page = await this.stores.share.listOutboundApps(userId, {
            limit: opts.limit,
            cursor: opts.cursor,
        });
        const apps = await this.stores.app.getByUids(
            page.items
                .map((row: { appUid: string | null }) => row.appUid)
                .filter((uid: string | null): uid is string => Boolean(uid)),
        );

        return {
            items: page.items.map(
                (row: { appUid: string | null; count: number }) => {
                    // An app that has since been removed leaves its grants behind,
                    // so the group stands with nothing to name it.
                    const app = row.appUid ? apps.get(row.appUid) : null;
                    return {
                        appUid: row.appUid,
                        name: app?.name ?? null,
                        title: app?.title ?? null,
                        count: row.count,
                    };
                },
            ),
            ...(page.cursor ? { cursor: page.cursor } : {}),
            ...(opts.includeTotal
                ? { total: await this.stores.share.countOutboundApps(userId) }
                : {}),
        };
    }

    /**
     * Withdraw one share the caller listed, named by its own uid.
     *
     * An uid the caller may not see answers 404 alike — one that names nothing,
     * another user's row, an app's view of another app's row — so the endpoint
     * can't be used to find out which. Past that gate the revoke's own rules
     * answer: a caller whose authority over the node has lapsed gets the ACL's
     * error, and a grant already withdrawn elsewhere reports `revoked: 0`.
     *
     * Scoped to the named row: only its issuer's grant is withdrawn, and only
     * this one invite is cancelled — an owner (or an app) addressing one row
     * must not take another issuer's grant on the same pair with it. The
     * item-addressed `unshare` is the broad form.
     */
    async revokeSharedByMe(
        actor: Actor,
        shareUid: string,
    ): Promise<{ revoked: number }> {
        const userId = this.#requireUserId(actor);
        const notFound = () =>
            new HttpError(404, 'Subject does not exist', {
                legacyCode: 'subject_does_not_exist',
            });

        const row = await this.stores.share.getByUid(shareUid);
        if (!row?.fsentry_id) throw notFound();

        const actingApp = this.#actingAppUid(actor);
        if (actingApp && issuedByApp(row) !== actingApp) throw notFound();

        const entry = await this.stores.fsEntry.getEntryById(
            Number(row.fsentry_id),
        );
        if (!entry) throw notFound();
        // The row must be one the caller's own listing would show them.
        if (
            Number(row.issuer_user_id) !== userId &&
            Number(entry.userId) !== userId
        ) {
            throw notFound();
        }
        if (!(await this.#hasOwnReach(actor, entry, 'see'))) throw notFound();

        // An invite is just its row — including one whose address has since
        // been registered but never claimed: no holder, no grant, so
        // recipient-addressed revocation would never find it.
        if (!row.holder_user_id) {
            const removed = await this.stores.share.deleteByUid(row.uid);
            return { revoked: removed ? 1 : 0 };
        }

        const holder = await this.stores.user.getById(
            Number(row.holder_user_id),
        );
        if (!holder?.username) throw notFound();

        await this.#assertCanManage(actor, entry);
        if (holder.id === entry.userId) {
            throw new HttpError(400, 'cannot revoke the owner of an item', {
                legacyCode: 'cannot_revoke_owner',
            });
        }

        return this.#withdrawGrants(actor, entry, holder, [
            Number(row.issuer_user_id),
        ]);
    }

    /**
     * When a grant was made, by which actor, and under which app.
     *
     * Named with an item, this is everything granted on it, whoever granted it
     * — which is what an owner is left with after a revoke, the grant itself
     * being gone by then. Named with nothing, it is what the caller granted,
     * wherever it landed. Between them they cover the caller's own trail and
     * their items', and nothing else: authority over the item is the gate on
     * the first, and being the issuer is the whole of the second.
     */
    async listGrantAudit(
        actor: Actor,
        target: ShareTarget = {},
        opts: { limit?: number; cursor?: string; includeTotal?: boolean } = {},
    ): Promise<{
        items: GrantAuditEntry[];
        cursor?: string;
        total?: number;
    }> {
        const userId = this.#requireUserId(actor);

        let filter: UserUserAuditFilter;
        if (target.uid || target.path) {
            const entry = await this.#resolveEntry(target, actor);
            await this.#assertCanManage(actor, entry);
            filter = { permissions: entryPermissions(entry.uuid) };
        } else {
            filter = { issuerUserId: userId };
        }

        const page = await this.stores.permission.listUserUserAudit(filter, {
            limit: opts.limit,
            cursor: opts.cursor,
        });
        const users = await this.stores.user.getByIds(
            page.items.flatMap((row) =>
                [row.issuer_user_id, row.holder_user_id].filter(
                    (id): id is number => typeof id === 'number',
                ),
            ),
        );
        const username = (id: number | null) =>
            id === null ? null : (users.get(id)?.username ?? null);

        return {
            items: page.items.map((row) => ({
                action: row.action,
                permission: row.permission,
                entryUid: uuidFromEntryPermission(row.permission),
                mode: modeFromEntryPermission(row.permission),
                issuer: { username: username(row.issuer_user_id) },
                holder: { username: username(row.holder_user_id) },
                appUid:
                    typeof row.extra?.appUid === 'string'
                        ? row.extra.appUid
                        : null,
                createdAt: row.created_at,
            })),
            ...(page.cursor ? { cursor: page.cursor } : {}),
            ...(opts.includeTotal
                ? {
                      total: await this.stores.permission.countUserUserAudit(
                          filter,
                      ),
                  }
                : {}),
        };
    }

    /**
     * Which app's grants this actor may see. An app credential is bound to its
     * own app whatever it asks for; a session may filter freely.
     */
    #outboundAppScope(
        actor: Actor,
        requested: string | null | undefined,
    ): { appUid?: string | null; empty?: boolean } {
        const acting = this.#actingAppUid(actor);
        if (!acting) return { appUid: requested };
        if (requested !== undefined && requested !== acting) {
            return { empty: true };
        }
        return { appUid: acting };
    }

    /**
     * The app this credential acts as, or null for a plain user session.
     * `effectiveApp` is the one derived field for this question — see
     * `makeActor`; re-deriving from `app` here would be a second gate to
     * drift.
     */
    #actingAppUid(actor: Actor): string | null {
        return actor.effectiveApp?.uid ?? null;
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

        // As in `#liveGrants`: an index row outlives the grant it records —
        // and it names an issuer, so it is that issuer's grant that has to
        // still be there.
        const stillReaches = await this.#reachingGrants(
            [...rows, ...inherited.map((i) => i.row)],
            nodeById,
        );
        const isLive = (row: ShareIndexRow): boolean =>
            stillReaches.has(
                `${Number(row.holder_user_id)}:${Number(row.fsentry_id)}:${Number(row.issuer_user_id)}`,
            );

        // Every item reports the queried node — a grant on an ancestor is
        // still published against the path the caller asked about.
        const inheritedShares: ResolvedShare[] = inherited
            .filter(({ row }) => isLive(row))
            .map(({ row, via }) =>
                this.#resolvedShareRow(row, entry, users, {
                    path: maskedPath,
                    via,
                }),
            );

        const own: ResolvedShare[] = rows
            .filter(isLive)
            .map((row: OutboundShareRow) =>
                this.#resolvedShareRow(row, entry, users, {
                    path: maskedPath,
                }),
            );
        // Nobody holds an invite yet, but whoever manages the node needs to
        // see who was asked, and be able to take it back.
        const pending: ResolvedShare[] = pendingRows.map(
            (row: OutboundShareRow) =>
                this.#resolvedShareRow(row, entry, users, {
                    path: maskedPath,
                }),
        );

        return inheritedShares.concat(own, pending);
    }

    /** Whether each of the caller's own `entries` is shared, keyed by uuid. */
    async shareFlags(
        actor: Actor,
        entries: FSEntry[],
    ): Promise<Map<string, boolean>> {
        // No user behind the actor means no flag, not a failed listing.
        const userId = actor?.user?.id;
        if (typeof userId !== 'number') return new Map();

        const own = entries.filter(
            (entry) => entry.userId === userId && Number.isFinite(entry.id),
        );
        if (own.length === 0) return new Map();

        const sharedIds = await this.stores.share.getSharedFsentryIds(
            own.map((entry) => entry.id),
        );
        return new Map(
            own.map((entry) => [entry.uuid, sharedIds.has(entry.id)]),
        );
    }

    /** `listSharesOf`, but null instead of throwing when manage is missing. */
    async tryListSharesOf(
        actor: Actor,
        target: ShareTarget,
    ): Promise<ResolvedShare[] | null> {
        try {
            return await this.listSharesOf(actor, target);
        } catch (error) {
            if (
                isHttpError(error) &&
                (error.statusCode === 403 || error.statusCode === 404)
            ) {
                return null;
            }
            throw error;
        }
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
                issuerAppUid: this.#actingAppUid(actor),
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

    /**
     * One index row resolved for a listing. The listings' differences are
     * arguments rather than a hand-built literal per call site: `entry` is the
     * node the item reports (the row's own node in the flat listings, the
     * queried node in `listSharesOf`), `entryMeta` adds what the caller can't
     * stat for themselves, `provenance` withholds who-issued-how from a listing
     * whose caller it isn't for, and `via` marks access inherited from an
     * ancestor. A row with no holder is an unclaimed invite and reports the
     * address it was aimed at — the typed form when that differs from the
     * canonical one the row is keyed on, since that is what the sharer will
     * recognize in a dialog.
     */
    #resolvedShareRow(
        row: OutboundShareRow,
        entry: FSEntry,
        users: Map<number, UserRow>,
        opts: {
            entryMeta?: boolean;
            provenance?: boolean;
            holderUsername?: string | null;
            via?: string | null;
            path?: string;
        } = {},
    ): ResolvedShare {
        const pending = !row.holder_user_id;
        return {
            uid: String(row.uid),
            mode: String(row.mode),
            path: opts.path ?? maskEntryPath(entry),
            ...(opts.entryMeta
                ? {
                      name: entry.name,
                      type: entry.isDir
                          ? 'folder'
                          : contentTypeFromMime(entry.name) || null,
                      thumbnail: entry.thumbnail ?? null,
                      owner: {
                          username:
                              users.get(Number(entry.userId))?.username ?? null,
                      },
                  }
                : {}),
            entryUid: entry.uuid,
            isDir: Boolean(entry.isDir),
            issuer: {
                username:
                    users.get(Number(row.issuer_user_id))?.username ?? null,
            },
            holder: {
                username:
                    opts.holderUsername !== undefined
                        ? opts.holderUsername
                        : pending
                          ? null
                          : (users.get(Number(row.holder_user_id))?.username ??
                            null),
            },
            ...(pending
                ? {
                      pending: true,
                      recipientEmail:
                          (row.data as { invitedAddress?: string } | null)
                              ?.invitedAddress ?? row.recipient_email,
                  }
                : {}),
            createdAt: row.created_at,
            ...(opts.provenance === false
                ? {}
                : {
                      issuedByApp: issuedByApp(row),
                      inheritedFrom: opts.via ?? null,
                  }),
            modified: entry.modified,
            size: entry.size,
        };
    }

    /**
     * Of `rows` (unclaimed invites), the uids whose issuer still holds the
     * authority the invite would grant. A dead invite can never become access —
     * claiming re-authorizes — but listed it would keep publishing the entry's
     * name and size to an issuer whose own access was revoked.
     *
     * The owner's invites are theirs by definition; only a delegate's cost a
     * check, and those are rare on any page.
     */
    async #pendingStillAuthorized(
        rows: OutboundShareRow[],
        nodeById: Map<number, FSEntry>,
        users: Map<number, UserRow>,
    ): Promise<Set<string>> {
        const allowed = new Set<string>();
        const toCheck: OutboundShareRow[] = [];
        for (const row of rows) {
            const entry = nodeById.get(Number(row.fsentry_id));
            const issuer = users.get(Number(row.issuer_user_id));
            if (!entry || !issuer?.username) continue;
            if (entry.userId === issuer.id) allowed.add(row.uid);
            else toCheck.push(row);
        }
        await runWithConcurrencyLimitSettled(toCheck, 8, async (row) => {
            const entry = nodeById.get(Number(row.fsentry_id)) as FSEntry;
            const issuer = users.get(Number(row.issuer_user_id)) as UserRow;
            const ok = await this.services.permission.canManagePermission(
                this.#actorFor(issuer),
                entryPermissionForMode(entry.uuid, String(row.mode)),
            );
            if (ok) allowed.add(row.uid);
        });
        return allowed;
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

        // Only for someone who can already share here, so it leaks nothing.
        if (mode === MANAGE_PERM_PREFIX) {
            const canDelegateAccess =
                await this.services.permission.canManagePermission(
                    userRelatedActor(actor),
                    entryPermissionForMode(entry.uuid, 'write'),
                );
            if (canDelegateAccess) {
                throw new HttpError(
                    403,
                    'Only the owner can grant edit & share access',
                    { legacyCode: 'cannot_delegate_manage' },
                );
            }
        }

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
        return isTrashedPath(entry.path);
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
