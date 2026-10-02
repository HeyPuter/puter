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

const MIN_PANEL_WIDTH = 280;
const MIN_PANEL_HEIGHT = 240;

/**
 * Places the expanded toolbar frame inside the viewport. It grows left and down
 * from the collapsed frame and shrinks rather than shifts when there is room, so
 * the toolbar buttons stay under the pointer.
 */
export function toolbarBounds (anchor, viewport, panel, requestedHeight) {
    let width = Math.max(0, Math.min(panel === 'apps' ? 440 : 360, viewport.width - 16));
    let height = Math.max(0, Math.min(panel === 'apps' ? 620 : (Number.isFinite(requestedHeight) ? Math.max(180, Math.min(requestedHeight, 800)) : 560), viewport.height - 16));
    let left;
    let top;
    const roomLeft = anchor.right - 8;
    if ( anchor.right <= viewport.width - 8 && roomLeft >= Math.min(width, MIN_PANEL_WIDTH) ) {
        width = Math.min(width, roomLeft);
        left = anchor.right - width;
    } else {
        left = Math.max(8, Math.min(anchor.right - width, viewport.width - width - 8));
    }
    const roomBelow = viewport.height - anchor.top - 8;
    if ( anchor.top >= 8 && roomBelow >= Math.min(height, MIN_PANEL_HEIGHT) ) {
        height = Math.min(height, roomBelow);
        top = anchor.top;
    } else {
        top = Math.max(8, Math.min(anchor.top, viewport.height - height - 8));
    }
    return { width, height, left, top };
}
