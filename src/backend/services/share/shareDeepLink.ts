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
 * Items one link will highlight. Past this the link still opens Shared, just
 * without picking the rest out — a query string of several kilobytes is where
 * mail clients start truncating or refusing to make it clickable.
 */
export const SHARE_DEEP_LINK_ITEMS_LIMIT = 20;

/**
 * A link that opens the recipient's Shared view with `paths` highlighted, once
 * they are signed in. Only masked paths travel — each one's second segment is
 * the uuid, so a rename is recoverable and there is no second copy to disagree
 * with the first. With no paths the link still lands on Shared.
 */
export const sharedViewLink = (origin: string, paths: string[]): string => {
    const base = origin.replace(/\/+$/, '');
    const unique = [...new Set(paths)].slice(0, SHARE_DEEP_LINK_ITEMS_LIMIT);
    const query =
        unique.length === 0
            ? `${SHARE_DEEP_LINK_PARAM}=`
            : unique
                  .map(
                      (path) =>
                          `${SHARE_DEEP_LINK_PARAM}=${encodeURIComponent(path)}`,
                  )
                  .join('&');
    return `${base}/?${query}`;
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
