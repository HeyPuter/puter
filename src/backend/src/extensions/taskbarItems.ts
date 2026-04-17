/**
 * Taskbar items helper — resolves a user's taskbar_items JSON column
 * into a list of app objects with icon URLs.
 *
 * Used by the whoami extension.
 */

import { extension } from '../extensions.js';

const stores  = extension.import('store');
const clients = extension.import('client');

const DEFAULT_TASKBAR_ITEMS = [
    { name: 'app-center', type: 'app' },
    { name: 'dev-center', type: 'app' },
    { name: 'editor', type: 'app' },
    { name: 'code', type: 'app' },
    { name: 'camera', type: 'app' },
    { name: 'recorder', type: 'app' },
];

function getAppIconUrl (app: Record<string, unknown>, size?: number): string | null {
    const appUid = (app.uid ?? app.uuid) as string | undefined;
    if ( ! appUid ) return null;

    const normalizedUid = appUid.startsWith('app-') ? appUid : `app-${appUid}`;
    const iconSize = Number.isFinite(Number(size)) ? Number(size) : 128;
    const apiBaseUrl = String((extension.config as Record<string, unknown>).api_base_url ?? '').replace(/\/+$/, '');
    if ( ! apiBaseUrl ) return null;

    return `${apiBaseUrl}/app-icon/${normalizedUid}/${iconSize}`;
}

export async function getTaskbarItems (
    user: Record<string, unknown>,
    options: { iconSize?: number; noIcons?: boolean } = {},
): Promise<Array<Record<string, unknown>>> {
    let raw: Array<{ name?: string; id?: number; uid?: string; type?: string }>;

    if ( ! user.taskbar_items ) {
        // First time — write defaults
        raw = DEFAULT_TASKBAR_ITEMS;
        await clients.db.write(
            'UPDATE `user` SET `taskbar_items` = ? WHERE `id` = ?',
            [JSON.stringify(raw), user.id],
        );
        await stores.user.invalidateById(user.id as number);
    } else {
        try {
            raw = typeof user.taskbar_items === 'string'
                ? JSON.parse(user.taskbar_items as string)
                : user.taskbar_items as typeof raw;
        } catch {
            raw = [];
        }
    }

    const items: Array<Record<string, unknown>> = [];

    for ( const entry of raw ) {
        if ( entry.type !== 'app' ) continue;
        if ( entry.name === 'explorer' ) continue;

        let app: Record<string, unknown> | null = null;
        if ( entry.name ) app = await stores.app.getByName(entry.name);
        else if ( entry.uid ) app = await stores.app.getByUid(entry.uid);
        else if ( entry.id ) app = await stores.app.getById(entry.id);
        if ( ! app ) continue;

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

        if ( options.noIcons ) {
            delete item.icon;
        } else {
            item.icon = getAppIconUrl(app, options.iconSize) ?? app.icon ?? null;
        }

        items.push(item);
    }

    return items;
}
