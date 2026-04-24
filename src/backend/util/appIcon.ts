// Always routes through the backend `/app-icon/<uid>/<size>` endpoint rather
// than the `puter-app-icons` subdomain directly. Some apps (especially those
// imported with a URL icon column that predates the sharp pipeline) only have
// the original PNG on the subdomain and no sized variants — a direct subdomain
// URL like `<uid>-256.png` 404s in that case. The backend endpoint self-heals:
// it can fall back to the original, decode data URLs inline, or serve the
// default placeholder. Mirrors v1's `getAppIconPath`.

export const DEFAULT_APP_ICON_SIZE = 256;

interface AppIconDeps {
    apiBaseUrl?: string;
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

    const normalizedApiBaseUrl = String(deps.apiBaseUrl ?? '').replace(
        /\/+$/,
        '',
    );
    if (!normalizedApiBaseUrl) {
        // No API base URL configured — fall back to the raw `icon` column so
        // something still renders (even if it's the unsized original).
        const appIcon = app.icon;
        if (typeof appIcon === 'string' && /^https?:\/\//i.test(appIcon)) {
            return appIcon;
        }
        return null;
    }
    return `${normalizedApiBaseUrl}/app-icon/${normalizedUid}/${iconSize}`;
}
