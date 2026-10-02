export const toolbarChannel = 'puter-toolbar';

export function isToolbarParent (origin, guiOrigin, domain) {
    try {
        const parent = new URL(origin);
        const gui = new URL(guiOrigin);
        return parent.protocol === gui.protocol && parent.port === gui.port &&
            (parent.origin === gui.origin || parent.hostname.endsWith(`.${domain}`));
    } catch { return false; }
}

export function readSavedAccounts (storage = localStorage) {
    try {
        const accounts = JSON.parse(storage.getItem('logged_in_users') || '[]');
        return Array.isArray(accounts) ? accounts.filter(account =>
            typeof account?.uuid === 'string' && typeof account?.username === 'string' &&
            typeof account?.auth_token === 'string') : [];
    } catch { return []; }
}

export function shouldShowUpgrade (user) {
    return !user.subscription?.active && !user.team?.uid;
}

export function toolbarBounds (anchor, viewport, panel, requestedHeight) {
    const width = Math.min(panel === 'apps' ? 440 : 360, viewport.width - 16);
    const height = Math.min(panel === 'apps' ? 620 : (Number.isFinite(requestedHeight) ? Math.max(180, Math.min(requestedHeight, 800)) : 560), viewport.height - 16);
    return {
        width: Math.max(0, width), height: Math.max(0, height),
        left: Math.max(8, Math.min(anchor.right - width, viewport.width - width - 8)),
        top: Math.max(8, Math.min(anchor.top, viewport.height - height - 8)),
    };
}
