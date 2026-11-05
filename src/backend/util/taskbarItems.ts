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

import type { AppIconHostConfig } from './appIcon.js';
import { toAppSummary, type AppRow } from './appView.js';

interface TaskbarEntry {
    name?: string;
    id?: number;
    uid?: string;
    type?: string;
}

interface TaskbarOptions {
    iconSize?: number;
    noIcons?: boolean;
}

interface TaskbarDeps {
    apiBaseUrl?: string;
    config?: AppIconHostConfig;
    stores: {
        app: {
            getByNames: (names: string[]) => Promise<Map<string, AppRow>>;
            getByUids: (uids: string[]) => Promise<Map<string, AppRow>>;
            getByIds: (ids: number[]) => Promise<Map<number, AppRow>>;
        };
        user: {
            update: (
                id: number,
                patch: Record<string, unknown>,
            ) => Promise<unknown>;
        };
    };
}

const DEFAULT_TASKBAR_ITEMS: TaskbarEntry[] = [
    { name: 'app-center', type: 'app' },
    { name: 'builder', type: 'app' },
    { name: 'dev-center', type: 'app' },
    { name: 'editor', type: 'app' },
    { name: 'code', type: 'app' },
    { name: 'camera', type: 'app' },
    { name: 'recorder', type: 'app' },
    { name: 'browser', type: 'app' },
];

export async function getTaskbarItems(
    user: Record<string, unknown>,
    deps: TaskbarDeps,
    options: TaskbarOptions = {},
): Promise<Array<Record<string, unknown>>> {
    let raw: TaskbarEntry[];

    if (!user.taskbar_items) {
        raw = DEFAULT_TASKBAR_ITEMS;
        await deps.stores.user.update(user.id as number, {
            taskbar_items: JSON.stringify(raw),
        });
    } else {
        try {
            raw =
                typeof user.taskbar_items === 'string'
                    ? JSON.parse(user.taskbar_items as string)
                    : (user.taskbar_items as TaskbarEntry[]);
        } catch {
            raw = [];
        }
    }

    const entries = raw.filter(
        (entry) => entry.type === 'app' && entry.name !== 'explorer',
    );
    const [byName, byUid, byId] = await Promise.all([
        deps.stores.app.getByNames(
            entries.flatMap((entry) => (entry.name ? [entry.name] : [])),
        ),
        deps.stores.app.getByUids(
            entries.flatMap((entry) =>
                !entry.name && entry.uid ? [entry.uid] : [],
            ),
        ),
        deps.stores.app.getByIds(
            entries.flatMap((entry) =>
                !entry.name && !entry.uid && entry.id ? [entry.id] : [],
            ),
        ),
    ]);

    const items: Array<Record<string, unknown>> = [];
    for (const entry of entries) {
        const app = entry.name
            ? byName.get(entry.name)
            : entry.uid
              ? byUid.get(entry.uid)
              : entry.id
                ? byId.get(entry.id)
                : undefined;
        if (!app) continue;

        const item: Record<string, unknown> = {
            uid: app.uid,
            ...toAppSummary(app, {
                apiBaseUrl: deps.apiBaseUrl,
                config: deps.config,
                iconSize: options.iconSize,
            }),
            description: app.description,
        };
        if (options.noIcons) {
            delete item.icon;
            delete item.iconCdnUrl;
        }
        items.push(item);
    }

    return items;
}
