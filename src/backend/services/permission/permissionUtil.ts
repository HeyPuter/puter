/**
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

import type { Actor } from '../../core/actor';
import { MANAGE_PERM_PREFIX } from './consts';

/** Shape of a single node in a permission scan "reading". */
export interface ReadingNode {
    $: 'option' | 'path' | 'rewrite' | 'explode' | 'time';
    permission?: string;
    permissionOptions?: string[];
    via?: string;
    source?: string;
    by?: string;
    key?: string;
    has_terminal?: boolean;
    data?: unknown;
    holder_username?: string;
    issuer_username?: string;
    issuer_user_id?: string;
    group_id?: number;
    vgroup_id?: string;
    reading?: ReadingNode[];
    from?: string;
    to?: string | string[];
    value?: number;
    deleted?: boolean;
    [k: string]: unknown;
}

/** Result of `readingToOptions`. */
export interface ReadingOption extends ReadingNode {
    path: Array<{ key?: string; holder?: string; data?: unknown }>;
}

const unescape_permission_component = (component: string): string => {
    let out = '';
    const ESCAPES: Record<string, string> = { C: ':' };
    let escaping = false;
    for (let i = 0; i < component.length; i++) {
        const c = component[i];
        if (!escaping) {
            if (c === '\\') escaping = true;
            else out += c;
        } else {
            out += Object.prototype.hasOwnProperty.call(ESCAPES, c)
                ? ESCAPES[c]
                : c;
            escaping = false;
        }
    }
    return out;
};

const escape_permission_component = (component: string): string => {
    let out = '';
    for (let i = 0; i < component.length; i++) {
        const c = component[i];
        if (c === ':') {
            out += '\\C';
            continue;
        }
        out += c;
    }
    return out;
};

/**
 * Utility functions for handling permission strings: split/join/escape plus
 * the `reading_to_options` tree flattener used by `check()` and consumers.
 */
export const PermissionUtil = {
    unescape_permission_component,
    escape_permission_component,

    split(permission: string): string[] {
        return permission.split(':').map(unescape_permission_component);
    },

    join(...components: string[]): string {
        return components.map(escape_permission_component).join(':');
    },

    permission_scan_cache_prefix_for_app_under_user(
        user_uuid: string,
        app_uid: string,
    ): string {
        const actor_uid = `app-under-user:${user_uuid}:${app_uid}`;
        return PermissionUtil.join(
            'permission-scan',
            actor_uid,
            'options-list',
        );
    },

    readingToOptions(
        reading: ReadingNode[],
        _parameters: Record<string, unknown> = {},
        options: ReadingOption[] = [],
        extras: unknown[] = [],
        path: Array<{ key?: string; holder?: string; data?: unknown }> = [],
    ): ReadingOption[] {
        const toPathItem = (finding: ReadingNode) => ({
            key: finding.key,
            holder: finding.holder_username,
            data: finding.data,
        });
        for (const finding of reading) {
            if (finding.$ === 'option') {
                const nextPath = [toPathItem(finding), ...path];
                options.push({
                    ...finding,
                    data: [...(finding.data ? [finding.data] : []), ...extras],
                    path: nextPath,
                });
            }
            if (finding.$ === 'path') {
                if (finding.has_terminal === false) continue;
                const newExtras = finding.data ? [finding.data, ...extras] : [];
                const newPath = [toPathItem(finding), ...path];
                PermissionUtil.readingToOptions(
                    finding.reading ?? [],
                    _parameters,
                    options,
                    newExtras,
                    newPath,
                );
            }
        }
        return options;
    },

    isManage(permission: string): boolean {
        return permission.startsWith(`${MANAGE_PERM_PREFIX}:`);
    },
};

/**
 * Check whether a reading includes any terminal node (an `option`, or a
 * `path` that itself transitively terminates).
 */
export const readingHasTerminal = (reading: ReadingNode[]): boolean => {
    for (const node of reading) {
        if (node.has_terminal) return true;
        if (node.$ === 'option') return true;
    }
    return false;
};

// ── Rules ────────────────────────────────────────────────────────────
//
// Rewriters, Implicators, and Exploders are the extension points other
// services use to contribute domain semantics. These are plain objects —
// easy to construct from anywhere, easy to test.

export interface PermissionRewriter {
    id?: string;
    matches: (permission: string) => boolean;
    rewrite: (permission: string) => Promise<string> | string;
}

export interface ImplicatorCheckInput {
    actor: Actor;
    permission: string;
    recurse?: (actor: Actor, permission: string) => Promise<ReadingNode[]>;
}

export interface PermissionImplicator {
    id?: string;
    /** If true, the implicator's hit short-circuits the scan. */
    shortcut?: boolean;
    matches: (permission: string) => boolean;
    check: (input: ImplicatorCheckInput) => Promise<unknown> | unknown;
}

export interface PermissionExploder {
    id?: string;
    matches: (permission: string) => boolean;
    explode: (input: {
        actor?: Actor;
        permission: string;
    }) => Promise<string[]> | string[];
}
