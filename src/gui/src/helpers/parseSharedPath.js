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

/** The query parameter a share link arrives on. */
export const SHARED_PATH_PARAM = 'shared';
/** The account a share email went to; see `shared_link_account_step`. */
export const SHARE_RECIPIENT_PARAM = 'user_uuid';

// The uuid segment of a shared item's path; see the backend's `sharePathMask`.
const UID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Put `params` in the address bar in place of the current query. */
function replace_query (params, hash) {
    const rest = params.toString();
    window.history.replaceState(
        null,
        document.title,
        `${window.location.pathname || '/'}${rest ? `?${rest}` : ''}${hash || ''}`,
    );
}

/**
 * Take `?shared=` off the address bar so a reload doesn't act on it again.
 *
 * @param {string} [hash] - What to leave after the `#`; the current hash if omitted
 */
export function clear_shared_param (hash = window.location.hash) {
    const params = new URLSearchParams(window.location.search);
    params.delete(SHARED_PATH_PARAM);
    params.delete(SHARE_RECIPIENT_PARAM);
    replace_query(params, hash);
}

/**
 * Take the account hint off the page but keep the share, so the hint acts
 * once: whichever account the next load lands on opens the link as itself.
 */
export function clear_share_recipient_param () {
    window.url_query_params?.delete(SHARE_RECIPIENT_PARAM);
    const params = new URLSearchParams(window.location.search);
    if ( ! params.has(SHARE_RECIPIENT_PARAM) ) return;
    params.delete(SHARE_RECIPIENT_PARAM);
    replace_query(params, window.location.hash);
}

/**
 * The account a share email was sent to, or null. Only read alongside a share
 * path the GUI would open, so a bare or hand-edited link names no one.
 *
 * @param {URLSearchParams} params
 * @returns {string | null} the uuid, lowercased
 */
export function shared_link_recipient_uuid (params) {
    const shared = params.getAll(SHARED_PATH_PARAM);
    if ( ! shared.some(value => parse_shared_path(value) !== null) ) return null;
    const uuid = params.get(SHARE_RECIPIENT_PARAM);
    return uuid && UID_PATTERN.test(uuid) ? uuid.toLowerCase() : null;
}

/**
 * What a share email's account hint calls for when the page opens: switch to
 * that account's saved session, ask whether to sign in to it, or nothing.
 *
 * Popups, embeds (`embedded`) and `action` flows act for whoever opened them,
 * so a link must not change their account. A temporary session is left to the
 * share link's own sign-in prompt.
 *
 * @returns {{ switch_to: object } | { ask: true } | null}
 */
export function shared_link_account_step ({
    params,
    action,
    embedded,
    current_user,
    logged_in_users,
}) {
    if ( action || embedded ) return null;
    const uuid = shared_link_recipient_uuid(params);
    if ( ! uuid || uuid === current_user?.uuid?.toLowerCase() ) return null;
    const saved = (logged_in_users ?? []).find(user =>
        user?.uuid?.toLowerCase() === uuid && Boolean(user.auth_token));
    if ( saved ) return { switch_to: saved };
    if ( ! current_user || current_user.is_temp ) return null;
    return { ask: true };
}

/**
 * Read `/<owner>/<uuid>/<name>`, the form a recipient is given. `null` for
 * anything else, so a hand-edited link is refused before it becomes a request.
 *
 * @param {string} shared_path
 * @returns {{ owner: string, uid: string, name: string } | null}
 */
export default function parse_shared_path (shared_path) {
    if ( typeof shared_path !== 'string' || ! shared_path.startsWith('/') ) {
        return null;
    }
    const [, owner, uid, ...rest] = shared_path.split('/');
    if ( ! owner || ! uid || ! UID_PATTERN.test(uid) ) return null;

    const name = rest.join('/');
    // The uuid stands in for the parent; the segment after it is the item.
    if ( ! name ) return null;

    return { owner, uid, name };
}
