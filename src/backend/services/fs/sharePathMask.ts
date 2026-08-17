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
import type { Actor } from '../../core/actor.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { FSEntryStore } from '../../stores/fs/FSEntryStore.js';

/**
 * Addressing for entries someone else owns.
 *
 * A recipient is given `/<owner>/<uuid>/<name>[/…]`, where `<uuid>` stands in
 * for everything above the shared item. It says where the item is without
 * saying where its owner keeps it — the folder it sits in, and what sits beside
 * it, are the owner's business. The form is self-describing, so the backend
 * resolves it back to the real path with one lookup and no server-side
 * session.
 *
 * Only foreign entries are masked. Your own paths are untouched.
 */

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Context key for the per-request masker. */
const MASKER_KEY = 'fs.sharePathMasker';

export interface MaskedSharePath {
    ownerUsername: string;
    rootUuid: string;
    /** Path below the masked root, `''` when the path is the root itself. */
    tail: string;
}

/** Read `/<owner>/<uuid>[/tail]` without touching the database. */
export function parseMaskedSharePath(path: string): MaskedSharePath | null {
    if (typeof path !== 'string' || !path.startsWith('/')) return null;
    const [ownerUsername, rootUuid, ...rest] = path.slice(1).split('/');
    if (!ownerUsername || !rootUuid || !UUID_PATTERN.test(rootUuid)) {
        return null;
    }
    return { ownerUsername, rootUuid, tail: rest.join('/') };
}

/**
 * Turn a masked path back into the real one, or return it unchanged when it
 * isn't masked.
 *
 * A path under your own username is never masked, so it is passed through
 * without a lookup. Anything else is only rewritten when the uuid resolves and
 * the segment after it is that entry's own name — otherwise the caller is
 * naming a real path that happens to look like a mask, and gets it verbatim.
 */
export async function resolveSharePath(
    fsEntryStore: FSEntryStore,
    actor: Actor | undefined,
    path: string,
): Promise<string> {
    const parsed = parseMaskedSharePath(path);
    if (!parsed) return path;
    if (parsed.ownerUsername === actor?.user?.username) return path;

    const root = await fsEntryStore.getEntryByUuid(parsed.rootUuid);
    if (!root) return path;
    // The mask names the owner, so the uuid must be theirs. Without this, a
    // folder deliberately named after some other entry's uuid would redirect
    // a caller who thinks they are inside it onto that entry instead.
    if (root.path.split('/')[1] !== parsed.ownerUsername) return path;

    const [head, ...rest] = parsed.tail.split('/').filter(Boolean);
    // The masked root stands in for the owner's parent directory, which the
    // recipient has no business addressing.
    if (head === undefined || head !== root.name) return path;

    const real = [root.path, ...rest].join('/');
    // `rest` is caller-authored: a `.`/`..` segment would walk out of the
    // shared subtree the uuid vouched for.
    if (pathPosix.normalize(real) !== real) return path;
    maskerFor(actor)?.learn(
        root.path,
        `/${parsed.ownerUsername}/${root.uuid}/${root.name}`,
    );
    return real;
}

/**
 * Rewrites outbound entry paths for one request.
 *
 * `learn` records the mapping an inbound masked path already proved, so every
 * entry reached through it keeps the same root and stays navigable. Anything
 * else falls back to masking the entry against itself, which always resolves
 * but flattens the tree — correct, just less useful for browsing.
 */
export class SharePathMasker {
    readonly #actorUserId: number | undefined;
    readonly #roots = new Map<string, string>();

    constructor(actorUserId: number | undefined) {
        this.#actorUserId = actorUserId;
    }

    /** The actor this masker was built for; `undefined` means "unknown". */
    get actorUserId(): number | undefined {
        return this.#actorUserId;
    }

    learn(realPrefix: string, maskedPrefix: string): void {
        this.#roots.set(realPrefix, maskedPrefix);
    }

    /** The roots proved so far, so a rebuild doesn't have to reprove them. */
    learnedRoots(): ReadonlyArray<readonly [string, string]> {
        return [...this.#roots.entries()];
    }

    /** The path to publish for `entry`. */
    mask(entry: {
        path: string;
        uuid: string;
        name?: string;
        userId?: number;
    }): string {
        if (
            this.#actorUserId === undefined ||
            entry.userId === undefined ||
            entry.userId === this.#actorUserId
        ) {
            return entry.path;
        }

        const bestReal = this.#longestLearnedRoot(entry.path);
        if (bestReal !== null) {
            return (
                (this.#roots.get(bestReal) as string) +
                entry.path.slice(bestReal.length)
            );
        }

        const owner = entry.path.split('/')[1];
        const name = entry.name ?? pathPosix.basename(entry.path);
        if (!owner || !name) return entry.path;
        return `/${owner}/${entry.uuid}/${name}`;
    }

    /**
     * The path to publish for a location that has no row behind it yet — a
     * pending upload, or the progress meta for one.
     *
     * Only the roots this request already proved are applied. There is no
     * self-mask fallback because there is no uuid to build one from, and none
     * is needed: reaching a foreign path without going through a masked one
     * means the caller named the owner's real path themselves.
     */
    maskPath(path: string): string {
        const bestReal = this.#longestLearnedRoot(path);
        if (bestReal === null) return path;
        return (
            (this.#roots.get(bestReal) as string) + path.slice(bestReal.length)
        );
    }

    /** The deepest learned root `path` sits at or under. */
    #longestLearnedRoot(path: string): string | null {
        let bestReal: string | null = null;
        for (const real of this.#roots.keys()) {
            if (path !== real && !path.startsWith(`${real}/`)) continue;
            if (bestReal === null || real.length > bestReal.length) {
                bestReal = real;
            }
        }
        return bestReal;
    }
}

/**
 * The masker for the current request, created on first use.
 *
 * Request-scoped rather than an argument: it would otherwise thread through
 * every FS response shaper and each of their ~30 call sites, and the only thing
 * it depends on is the actor, which already lives here.
 */
export function maskerFor(actor: Actor | undefined): SharePathMasker | null {
    if (!Context.current()) return null;
    const existing = Context.get(MASKER_KEY);
    if (existing instanceof SharePathMasker) {
        const actorUserId = actor?.user?.id;
        // First caller wins on the actor, and getting that wrong fails open:
        // a masker built before the request context knew who was acting has no
        // actor id, and `mask()` then publishes every path unmasked. Adopt the
        // first actor that turns up, and rebuild outright if a different one
        // does — one request's learned roots are not another actor's to use.
        if (actorUserId === undefined || actorUserId === existing.actorUserId) {
            return existing;
        }
        if (existing.actorUserId === undefined) {
            const adopted = new SharePathMasker(actorUserId);
            for (const [real, masked] of existing.learnedRoots()) {
                adopted.learn(real, masked);
            }
            Context.set(MASKER_KEY, adopted);
            return adopted;
        }
        const replacement = new SharePathMasker(actorUserId);
        Context.set(MASKER_KEY, replacement);
        return replacement;
    }
    const masker = new SharePathMasker(actor?.user?.id);
    Context.set(MASKER_KEY, masker);
    return masker;
}

/**
 * Mask a bare path for the current request — for locations with no row behind
 * them, where {@link maskEntryPath} has no entry to work from.
 */
export function maskPathForRequest(path: string): string {
    const masker = maskerFor(Context.get('actor'));
    return masker ? masker.maskPath(path) : path;
}

/** Mask `entry`'s path for the current request. */
export function maskEntryPath(entry: {
    path: string;
    uuid: string;
    name?: string;
    userId?: number;
}): string {
    const masker = maskerFor(Context.get('actor'));
    return masker ? masker.mask(entry) : entry.path;
}

/**
 * Teach the masker the roots `entries` were shared at, so a listing that never
 * went through a masked path still shows them as one navigable tree.
 */
export async function learnShareRoots(
    roots: Array<Pick<FSEntry, 'path' | 'uuid' | 'name'>>,
    actor: Actor | undefined,
): Promise<void> {
    const masker = maskerFor(actor);
    if (!masker) return;
    for (const root of roots) {
        const owner = root.path.split('/')[1];
        if (!owner) continue;
        masker.learn(root.path, `/${owner}/${root.uuid}/${root.name}`);
    }
}
