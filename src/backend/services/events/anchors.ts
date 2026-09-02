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

import { HttpError } from '../../core/http/HttpError.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { NodeRef } from '../fs/resolveNode.js';
import { expandTildePath, normalizeAbsolutePath } from '../fs/resolveNode.js';
import { relativeTo } from './matcher.js';
import { fsAnchorToken, type FsOp, type ParsedSubject } from './subjects.js';

/**
 * Turn an `fs:` subject into the pair a subscription stores: the anchor node it
 * keys on, and the glob its members are filtered by. Subscribing to something
 * that does not exist yet anchors on the nearest existing ancestor and files
 * the remainder as the filter — climbing terminates at the user's home, whose
 * uid never changes.
 */

export interface FsAnchorDeps {
    /** `resolveNode` bound to the entry store. */
    resolveNode: (ref: NodeRef) => Promise<FSEntry | null>;
    /** `FSService.getAncestorChain`: existing ancestors only, deepest first. */
    getAncestorChain: (
        path: string,
    ) => Promise<ReadonlyArray<{ uid: string; path: string }>>;
}

export interface ResolvedFsAnchor {
    /** Stored anchor token. */
    token: string;
    uid: string;
    path: string;
    /** Glob relative to the anchor, or `null` for a node-form subscription. */
    match: string | null;
    op: FsOp | null;
}

const anchorNotFound = (subjectPath: string): HttpError =>
    new HttpError(404, `No such entry: ${subjectPath}`, {
        legacyCode: 'subject_does_not_exist',
    });

const joinMatch = (
    remainder: string,
    rawMatch: string | null,
): string | null => {
    const parts = [remainder, rawMatch].filter(
        (part): part is string => !!part && part.length > 0,
    );
    return parts.length > 0 ? parts.join('/') : null;
};

export async function resolveFsAnchor(
    parsed: ParsedSubject,
    deps: FsAnchorDeps,
    actor: { username?: string },
): Promise<ResolvedFsAnchor> {
    const { anchorRef, op, rawMatch } = parsed;

    if (anchorRef.kind === 'fsUid') {
        const entry = await deps.resolveNode({ uid: anchorRef.uid });
        if (!entry) throw anchorNotFound(anchorRef.uid);
        return {
            token: fsAnchorToken(entry.uid),
            uid: entry.uid,
            path: entry.path,
            match: rawMatch,
            op,
        };
    }

    if (anchorRef.kind !== 'fsPath')
        throw new HttpError(400, 'Not a filesystem subject', {
            legacyCode: 'invalid_subject',
        });

    // Home-relative paths expand once, here, so nothing downstream ever stores
    // a `~`-form path.
    const expanded = normalizeAbsolutePath(
        expandTildePath(anchorRef.path, actor.username),
    );

    const exact =
        rawMatch === null ? await deps.resolveNode({ path: expanded }) : null;
    if (exact)
        return {
            token: fsAnchorToken(exact.uid),
            uid: exact.uid,
            path: exact.path,
            match: null,
            op,
        };

    const [nearest] = await deps.getAncestorChain(expanded);
    if (!nearest) throw anchorNotFound(expanded);

    const remainder = relativeTo(nearest.path, expanded);
    if (remainder === null) throw anchorNotFound(expanded);

    return {
        token: fsAnchorToken(nearest.uid),
        uid: nearest.uid,
        path: nearest.path,
        match: joinMatch(remainder, rawMatch),
        op,
    };
}
