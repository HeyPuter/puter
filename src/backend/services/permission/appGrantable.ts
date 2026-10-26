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

import { validate as validateUuid } from 'uuid';
import {
    APP_UID_SHAPE,
    KV_SHARE_ACCESS_LEVELS,
    type KvShareAccess,
    kvShareRoot,
} from '../kvShare/kvShares.js';
import {
    APP_DATA_CLASSES,
    APP_DATA_KV_OPS,
    APP_DATA_PERMISSION_PREFIX,
    type AppDataStore,
} from './appDataScopes.js';
import { MANAGE_PERM_PREFIX } from './consts.js';
import { PermissionUtil } from './permissionUtil.js';

const ACCESS_LEVELS = ['read', 'write'] as const;
type AccessLevel = (typeof ACCESS_LEVELS)[number];

const FS_MODES = ['see', 'list', 'read', 'write'] as const;
type FsMode = (typeof FS_MODES)[number];

/**
 * A permission a user may grant an app through the consent prompt, parsed. No
 * app-actor check reads `apps-of-user:<uuid>:read` or `subdomains-of-user`;
 * they stay grantable because apps already request them.
 */
export type AppGrantablePermission =
    | { family: 'fs'; target: string; mode: FsMode }
    | { family: 'email' }
    | { family: 'apps' | 'subdomains'; access: AccessLevel }
    | {
          family: 'appData';
          appUid: string;
          store?: AppDataStore;
          scope?: string;
      }
    | { family: 'appRootDir'; appUid: string; access: AccessLevel }
    | {
          family: 'kvShare';
          level: KvShareAccess;
          ownerUuid: string;
          appUid: string;
          segments: string[];
      }
    | { family: 'backgroundEvents' };

/** One component as it is written canonically: `\` as `\\`, `:` as `\C`. */
const escapeComponent = (component: string): string =>
    component.replace(/\\/g, '\\\\').replace(/:/g, '\\C');

const isOneOf = <T extends string>(
    values: readonly T[],
    value: string | undefined,
): value is T =>
    value !== undefined && (values as readonly string[]).includes(value);

const ACCESS_FAMILIES: Record<string, 'apps' | 'subdomains'> = {
    'apps-of-user': 'apps',
    'subdomains-of-user': 'subdomains',
};

/** Own keys only, so `constructor` or `toString` never names a family. */
const lookup = <T>(map: Record<string, T>, key: string | undefined) =>
    key !== undefined && Object.hasOwn(map, key) ? map[key] : undefined;

const parseAppData = (parts: string[]): AppGrantablePermission | null => {
    const [, appUid, store, scope, ...rest] = parts;
    if (!appUid || !APP_UID_SHAPE.test(appUid) || rest.length > 0) return null;
    if (store === undefined) return { family: 'appData', appUid };
    if (store === 'kv') {
        if (
            scope !== undefined &&
            !isOneOf(APP_DATA_CLASSES, scope) &&
            !isOneOf(APP_DATA_KV_OPS, scope)
        ) {
            return null;
        }
    } else if (store === 'fs') {
        if (scope !== undefined && !isOneOf(APP_DATA_CLASSES, scope)) {
            return null;
        }
    } else {
        return null;
    }
    return { family: 'appData', appUid, store, scope };
};

/**
 * `permission` as an app-grantable permission, or null when a user may not
 * grant it to an app. Families naming a user (email, apps, subdomains, share
 * delegation) must name `userUuid`, the user granting it.
 */
export const parseAppGrantablePermission = (
    permission: string,
    userUuid: string,
): AppGrantablePermission | null => {
    if (permission === 'events:background') {
        return { family: 'backgroundEvents' };
    }

    const parts = PermissionUtil.split(permission);
    // Checks that run on the raw string, after this one, match only the
    // canonical spelling, so `f\s:` must not reach them as `fs:`.
    if (parts.map(escapeComponent).join(':') !== permission) return null;
    const [head] = parts;

    if (head === 'fs') {
        const [, target, mode] = parts;
        if (parts.length !== 3 || !target || !isOneOf(FS_MODES, mode)) {
            return null;
        }
        if (!target.startsWith('/') && !validateUuid(target)) return null;
        return { family: 'fs', target, mode };
    }

    if (head === 'user') {
        const [, uuid, field, mode] = parts;
        if (
            parts.length !== 4 ||
            uuid !== userUuid ||
            field !== 'email' ||
            mode !== 'read'
        ) {
            return null;
        }
        return { family: 'email' };
    }

    const accessFamily = lookup(ACCESS_FAMILIES, head);
    if (accessFamily) {
        const [, uuid, access] = parts;
        if (
            parts.length !== 3 ||
            uuid !== userUuid ||
            !isOneOf(ACCESS_LEVELS, access)
        ) {
            return null;
        }
        return { family: accessFamily, access };
    }

    if (head === APP_DATA_PERMISSION_PREFIX) return parseAppData(parts);

    if (head === 'app-root-dir') {
        const [, appUid, access] = parts;
        if (
            parts.length !== 3 ||
            !appUid ||
            !APP_UID_SHAPE.test(appUid) ||
            !isOneOf(ACCESS_LEVELS, access)
        ) {
            return null;
        }
        return { family: 'appRootDir', appUid, access };
    }

    const level =
        head === MANAGE_PERM_PREFIX
            ? KV_SHARE_ACCESS_LEVELS.find(
                  (access) => kvShareRoot(access) === parts[1],
              )
            : undefined;
    if (level) {
        const [, , ownerUuid, appUid, ...segments] = parts;
        if (
            ownerUuid !== userUuid ||
            !appUid ||
            !APP_UID_SHAPE.test(appUid) ||
            segments.length === 0 ||
            segments.some((segment) => segment === '')
        ) {
            return null;
        }
        return { family: 'kvShare', level, ownerUuid, appUid, segments };
    }

    return null;
};
