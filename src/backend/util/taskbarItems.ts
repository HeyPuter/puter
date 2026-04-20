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
    services?: {
        appIcon?: {
            getIconUrl?: (appUid: string, size: number) => string | null;
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

// Data URLs (`data:…`) and bare base64 strings need to be served through the
// `/app-icon` endpoint because the subdomain path only hosts files the icon
// pipeline already wrote out as PNGs.
function isInlineIcon(icon: unknown): boolean {
    if (typeof icon !== 'string') return false;
    if (icon.startsWith('data:')) return true;
    // Bare base64 — no URL scheme. AppIconService rewrites these to absolute
    // URLs once processed, so anything that's still raw-looking goes through
    // the backend endpoint.
    return !/^https?:\/\//i.test(icon);
}

function getAppIconUrl(
    app: Record<string, unknown>,
    deps: TaskbarDeps,
    size?: number,
): string | null {
    const appUid = (app.uid ?? app.uuid) as string | undefined;
    if (!appUid) return null;

    const normalizedUid = appUid.startsWith('app-') ? appUid : `app-${appUid}`;
    const iconSize = Number.isFinite(Number(size)) ? Number(size) : 128;

    // Path A: icon already lives on `puter-app-icons.<static_hosting_domain>`
    // (AppIconService processed it and rewrote the DB column). Point the client
    // directly at the hosted PNG so no backend request is involved.
    const appIcon = app.icon;
    if (!isInlineIcon(appIcon)) {
        const hosted = deps.services?.appIcon?.getIconUrl?.(
            normalizedUid,
            iconSize,
        );
        if (hosted) return hosted;
        // No CDN configured but the DB has a usable URL — use it as-is.
        if (typeof appIcon === 'string' && appIcon.length > 0) return appIcon;
    }

    // Path B: data URL / bare base64 / missing — fall back to the `/app-icon`
    // endpoint. It decodes data URLs inline and serves a default placeholder
    // when the app has no icon at all.
    const normalizedApiBaseUrl = String(deps.apiBaseUrl ?? '').replace(
        /\/+$/,
        '',
    );
    if (!normalizedApiBaseUrl) return null;
    return `${normalizedApiBaseUrl}/app-icon/${normalizedUid}/${iconSize}`;
}

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
