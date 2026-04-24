// Mirrors v1's `get_app_icon_url` helper. AppIconService already exposes
// `getIconUrl(uid, size)` for the subdomain-hosted PNG path; this wrapper
// adds the data-URL / missing-icon fallbacks v1 applied.

export const DEFAULT_APP_ICON_SIZE = 256;

interface AppIconDeps {
    apiBaseUrl?: string;
    services?: {
        appIcon?: {
            getIconUrl?: (appUid: string, size: number) => string | null;
        };
    };
}

function isInlineIcon(icon: unknown): boolean {
    if (typeof icon !== 'string') return false;
    if (icon.startsWith('data:')) return true;
    return !/^https?:\/\//i.test(icon);
}

export function getAppIconUrl(
    app: Record<string, unknown>,
    deps: AppIconDeps,
    size?: number,
): string | null {
    const appUid = (app.uid ?? app.uuid) as string | undefined;
    if (!appUid) return null;

    const normalizedUid = appUid.startsWith('app-') ? appUid : `app-${appUid}`;
    const iconSize = Number.isFinite(Number(size))
        ? Number(size)
        : DEFAULT_APP_ICON_SIZE;

    const appIcon = app.icon;
    if (!isInlineIcon(appIcon)) {
        const hosted = deps.services?.appIcon?.getIconUrl?.(
            normalizedUid,
            iconSize,
        );
        if (hosted) return hosted;
        if (typeof appIcon === 'string' && appIcon.length > 0) return appIcon;
    }

    const normalizedApiBaseUrl = String(deps.apiBaseUrl ?? '').replace(
        /\/+$/,
        '',
    );
    if (!normalizedApiBaseUrl) return null;
    return `${normalizedApiBaseUrl}/app-icon/${normalizedUid}/${iconSize}`;
}
