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
import { KV_GLOBAL_APP_KEY } from '../../stores/systemKv/SystemKVStore.js';
import type { NodeRef } from '../fs/resolveNode.js';
import { expandTildePath, normalizeAbsolutePath } from '../fs/resolveNode.js';
import { relativeTo } from './matcher.js';
import {
    fsAnchorToken,
    kvAnchorFor,
    kvAnchorToken,
    notifAnchorToken,
    notifMatchOn,
    type FsOp,
    type ParsedSubject,
} from './subjects.js';
import type { NotificationAudience } from '../notification/notificationTypes.js';

/**
 * Turn a subject into the pair a subscription stores: the anchor it keys on,
 * and the glob its members are filtered by.
 *
 * An `fs:` subject naming something that does not exist yet anchors on the
 * nearest existing ancestor and files the remainder as the filter — climbing
 * terminates at the user's home, whose uid never changes. A `kv:` subject
 * anchors on a key prefix, which needs no lookup: the namespace is derived from
 * the actor, so nothing has to exist for the subscription to be valid.
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

/** Who a `kv:` subject is resolved on behalf of. */
export interface KvAnchorActor {
    userUuid: string;
    /** The actor's `effectiveApp`, or `null` when it acts as the user. */
    appUid: string | null;
}

export interface ResolvedKvAnchor {
    token: string;
    /** App whose namespace the subscription watches. */
    appUid: string;
    /** Key prefix the token anchors at. */
    prefix: string;
    /** Glob over the whole key, or `null` when the prefix is exact enough. */
    match: string | null;
    /** Fully-qualified wire form, after any app-relative expansion. */
    subject: string;
    /** True when the subject names a namespace other than the actor's own. */
    crossApp: boolean;
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
    rawSubject: string,
): Promise<ResolvedFsAnchor> {
    const { anchorRef, op, rawMatch } = parsed;

    if (anchorRef.kind === 'fsUid') {
        const entry = await deps.resolveNode({ uid: anchorRef.uid });
        // The raw subject, not the bare uid: `assertSubscribeAuthorized`'s
        // safe-404 for the same anchor reads the same way, and a mismatch
        // here is an existence oracle in itself — whether a uid exists would
        // leak through which message format comes back.
        if (!entry) throw anchorNotFound(rawSubject);
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
    if (!nearest) throw anchorNotFound(rawSubject);

    const remainder = relativeTo(nearest.path, expanded);
    if (remainder === null) throw anchorNotFound(rawSubject);

    return {
        token: fsAnchorToken(nearest.uid),
        uid: nearest.uid,
        path: nearest.path,
        match: joinMatch(remainder, rawMatch),
        op,
    };
}

/**
 * Resolve a `kv:` subject against the actor's own namespace.
 *
 * The two-segment form is expanded here rather than in the SDK, so a raw
 * `/drivers` call cannot dodge it; an actor with no app falls back to the same
 * global key the KV store itself namespaces under, which keeps the expansion
 * agreeing with where the data actually lands.
 */
export function resolveKvAnchor(
    parsed: ParsedSubject,
    actor: KvAnchorActor,
): ResolvedKvAnchor {
    const { anchorRef, rawMatch } = parsed;
    if (anchorRef.kind !== 'kvPrefix')
        throw new HttpError(400, 'Not a key-value subject', {
            legacyCode: 'invalid_subject',
        });

    const appUid = anchorRef.appUid ?? actor.appUid ?? KV_GLOBAL_APP_KEY;

    return {
        token: kvAnchorToken(actor.userUuid, appUid, anchorRef.prefix),
        appUid,
        prefix: anchorRef.prefix,
        match: rawMatch,
        subject: `kv:${appUid}:${anchorRef.key}`,
        // An actor with no app is its user, and a user naming a namespace of
        // their own has never been gated — the same branch a cross-app KV read
        // takes before it reaches a permission lookup.
        crossApp: actor.appUid !== null && appUid !== actor.appUid,
    };
}

/** The shared region a handle resolves to, as the resolver needs it. */
export interface KvShareRegion {
    ownerUserUuid: string;
    appUid: string;
    /** The granted root, ending on the key delimiter. */
    keyPrefix: string;
}

/**
 * Resolve a `kv:<handle>:<relativeKey>` subject against the region the handle
 * was granted on.
 *
 * The key is composed onto the granted prefix and then anchored by exactly the
 * path an owner's own subject takes, which is what makes the two produce the
 * same token: the handle is an address for a region, not a second kind of
 * subscription. Nothing here can reach above the region — the composition is a
 * concatenation onto the prefix, so being at-or-below the grant is structural
 * rather than checked.
 */
export function resolveKvHandleAnchor(
    parsed: ParsedSubject,
    region: KvShareRegion,
): ResolvedKvAnchor {
    const { anchorRef } = parsed;
    if (anchorRef.kind !== 'kvHandle')
        throw new HttpError(400, 'Not a key-value handle subject', {
            legacyCode: 'invalid_subject',
        });

    const { prefix, rawMatch } = kvAnchorFor(
        `${region.keyPrefix}${anchorRef.key}`,
    );

    return {
        token: kvAnchorToken(region.ownerUserUuid, region.appUid, prefix),
        appUid: region.appUid,
        prefix,
        match: rawMatch,
        // The wire form stays the one the grantee wrote: it names the handle,
        // and the handle is all they are ever told about where the data lives.
        subject: `kv:${anchorRef.handle}:${anchorRef.key}`,
        // The gate is the share grant, not the cross-app one.
        crossApp: false,
    };
}

/** Who a `notif:` subject is resolved on behalf of. */
export interface NotifAnchorActor {
    /** The recipient — you only ever read your own mailbox. */
    userUuid: string;
    /** The actor's `effectiveApp`, or `null` when it acts as the user. */
    appUid: string | null;
}

export interface ResolvedNotifAnchor {
    token: string;
    /** App the rows are about, or the recipient when they name none. */
    ref: string;
    audience: NotificationAudience;
    /** The slice of the mailbox, as the filter tests it. */
    match: string;
    /** Fully-qualified wire form, after any app-relative expansion. */
    subject: string;
    /** True when the ref names an app rather than the recipient. */
    appScoped: boolean;
    /**
     * True for a session's own generic slice: no app named, no app context
     * either. The audience predicate already grants every row of `audience`
     * addressed to this recipient regardless of which app it names (a
     * `developer` row once its owner is rechecked, an `app-user` row
     * unconditionally), so `ref` cannot pin the filter to one app the caller
     * never named — an `account` row never names an app, so it never widens.
     */
    anyApp: boolean;
}

/**
 * Resolve a `notif:` subject. The anchor is the recipient's mailbox and the
 * slice is the filter, so nothing is looked up: which rows the actor may
 * actually see is the audience predicate's answer, not the anchor's.
 *
 * The two-segment form expands from the actor the same way a `kv:` one does —
 * an app names its own rows by not naming an app at all.
 */
export function resolveNotifAnchor(
    parsed: ParsedSubject,
    actor: NotifAnchorActor,
): ResolvedNotifAnchor {
    const { anchorRef } = parsed;
    if (anchorRef.kind !== 'notifScope')
        throw new HttpError(400, 'Not a notification subject', {
            legacyCode: 'invalid_subject',
        });

    const ref = anchorRef.ref ?? actor.appUid ?? actor.userUuid;
    const appScoped = ref !== actor.userUuid;
    const anyApp = !appScoped && anchorRef.audience !== 'account';

    return {
        token: notifAnchorToken(actor.userUuid),
        ref,
        audience: anchorRef.audience,
        match: notifMatchOn(anyApp ? '*' : ref, anchorRef.audience),
        subject: `notif:${ref}:${anchorRef.audience}`,
        appScoped,
        anyApp,
    };
}
