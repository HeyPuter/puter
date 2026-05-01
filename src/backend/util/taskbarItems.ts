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

import { getAppIconUrl } from './appIcon.js';

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
    clients: {
        db: {
            write: (query: string, params?: unknown[]) => Promise<unknown>;
        };
    };
    stores: {
        app: {
            getByName: (
                name: string,
            ) => Promise<Record<string, unknown> | null>;
            getByUid: (uid: string) => Promise<Record<string, unknown> | null>;
            getById: (id: number) => Promise<Record<string, unknown> | null>;
        };
        user: {
            invalidateById: (id: number) => Promise<unknown>;
        };
    };
}

const DEFAULT_TASKBAR_ITEMS: TaskbarEntry[] = [
    { name: 'app-center', type: 'app' },
    { name: 'dev-center', type: 'app' },
    { name: 'editor', type: 'app' },
    { name: 'code', type: 'app' },
    { name: 'camera', type: 'app' },
    { name: 'recorder', type: 'app' },
];

export async function getTaskbarItems(
    user: Record<string, unknown>,
    deps: TaskbarDeps,
    options: TaskbarOptions = {},
): Promise<Array<Record<string, unknown>>> {
    let raw: TaskbarEntry[];

    if (!user.taskbar_items) {
        raw = DEFAULT_TASKBAR_ITEMS;
        await deps.clients.db.write(
            'UPDATE `user` SET `taskbar_items` = ? WHERE `id` = ?',
            [JSON.stringify(raw), user.id],
        );
        await deps.stores.user.invalidateById(user.id as number);
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

    const items: Array<Record<string, unknown>> = [];

    for (const entry of raw) {
        if (entry.type !== 'app') continue;
        if (entry.name === 'explorer') continue;

        let app: Record<string, unknown> | null = null;
        if (entry.name) app = await deps.stores.app.getByName(entry.name);
        else if (entry.uid) app = await deps.stores.app.getByUid(entry.uid);
        else if (entry.id) app = await deps.stores.app.getById(entry.id);
        if (!app) continue;

        const item: Record<string, unknown> = {
            uid: app.uid,
            uuid: app.uid,
            name: app.name,
            title: app.title,
            icon: app.icon ?? null,
            godmode: Boolean(app.godmode),
            maximize_on_start: Boolean(app.maximize_on_start),
            index_url: app.index_url,
            description: app.description,
        };

        if (options.noIcons) {
            delete item.icon;
        } else {
            item.icon =
                getAppIconUrl(app, deps, options.iconSize) ?? app.icon ?? null;
        }

        items.push(item);
    }

    return items;
}
