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

/**
 * Links that open a shared item: the dashboard's Files tab, on Shared, with the
 * item highlighted. Not derived from `ResolvedShare.path`: that is masked for
 * the requester, and the issuer owns the entry, so it comes back as the owner's
 * real path — which mailing would leak.
 */

/** The query parameter the GUI routes on. */
export const SHARE_DEEP_LINK_PARAM = 'shared';

export interface ShareTarget {
    /** The entry's own name, which the masked path's last segment must be. */
    name: string;
    /** The entry's uuid. */
    uid: string;
    /** Whose entry it is. */
    ownerUsername: string;
}

/** The owner out of either form of share path; both name it first. */
export const ownerFromSharePath = (path: string): string | null => {
    if (typeof path !== 'string') return null;
    const owner = path.split('/')[1];
    return owner ? owner : null;
};

/**
 * `/<owner>/<uuid>/<name>`, built without a request context so every reader
 * gets the same. See `sharePathMask.ts` for how it is read back.
 */
export const maskedSharePath = (target: ShareTarget): string | null => {
    const { name, uid, ownerUsername } = target;
    if (!name || !uid || !ownerUsername) return null;
    return `/${ownerUsername}/${uid}/${name}`;
};

/**
 * Items one link will highlight, at most. Past this the link still opens
 * Shared, just without picking the rest out.
 */
export const SHARE_DEEP_LINK_ITEMS_LIMIT = 20;

/**
 * How long a link may run, in characters. Somewhere past two thousand, older
 * mail clients cut a URL off or stop making it clickable — and this is the
 * button — so items are added only while the whole link stays within this. The
 * first item goes in regardless: a link that names nothing is no better than
 * the origin, and one long name (hundreds of characters, tripled by encoding
 * when non-ASCII) is still the item the mail is about.
 */
export const SHARE_DEEP_LINK_MAX_LENGTH = 2000;

/**
 * A link that opens the recipient's Shared view with `paths` highlighted, once
 * they are signed in. Only masked paths travel — each one's second segment is
 * the uuid, so a rename is recoverable and there is no second copy to disagree
 * with the first. With no paths the link still lands on Shared.
 */
export const sharedViewLink = (origin: string, paths: string[]): string => {
    const base = `${origin.replace(/\/+$/, '')}/?`;
    // The first items that fit, in order — never a later one over an
    // earlier, so what is highlighted reads as the top of the list.
    const params: string[] = [];
    let length = base.length;
    for (const path of new Set(paths)) {
        if (params.length === SHARE_DEEP_LINK_ITEMS_LIMIT) break;
        const param = `${SHARE_DEEP_LINK_PARAM}=${encodeURIComponent(path)}`;
        const added = param.length + (params.length === 0 ? 0 : '&'.length);
        const overLength = length + added > SHARE_DEEP_LINK_MAX_LENGTH;
        if (params.length > 0 && overLength) break;
        params.push(param);
        length += added;
    }
    return (
        base +
        (params.length === 0 ? `${SHARE_DEEP_LINK_PARAM}=` : params.join('&'))
    );
};

/** A link that opens `path`: the Shared view with that one item highlighted. */
export const shareDeepLink = (origin: string, path: string): string =>
    sharedViewLink(origin, [path]);

/** The link for a target, or `null` when it isn't addressable. */
export const shareTargetLink = (
    origin: string,
    target: ShareTarget,
): string | null => {
    const path = maskedSharePath(target);
    return path === null ? null : shareDeepLink(origin, path);
};
