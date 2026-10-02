import { describe, it, expect } from 'vitest';
import { isToolbarParent, readSavedAccounts, shouldShowUpgrade, toolbarBounds } from './toolbarEmbed.js';
import { openRequestedUpgrade } from './upgradeLink.js';

describe('toolbar integration', () => {
    it('allows only the deployment origin and its subdomains on the configured scheme and port', () => {
        for ( const origin of ['https://puter.com', 'https://sheets.puter.com', 'https://a.b.puter.com'] ) {
            expect(isToolbarParent(origin, 'https://puter.com', 'puter.com')).toBe(true);
        }
        for ( const origin of ['null', 'https://evilputer.com', 'https://puter.com.evil.com', 'http://sheets.puter.com', 'https://sheets.puter.com:444'] ) {
            expect(isToolbarParent(origin, 'https://puter.com', 'puter.com')).toBe(false);
        }
        expect(isToolbarParent('http://sheets.puter.localhost:4100', 'http://puter.localhost:4100', 'puter.localhost')).toBe(true);
    });
    it('ignores malformed saved accounts', () => {
        const account = { uuid: 'one', username: 'one', auth_token: 'token' };
        expect(readSavedAccounts({ getItem: () => JSON.stringify([account, null, {}]) })).toEqual([account]);
        for ( const value of ['null', '{}', 'bad JSON'] ) expect(readSavedAccounts({ getItem: () => value })).toEqual([]);
    });
    it('hides Upgrade for paid users and organization seats', () => {
        expect(shouldShowUpgrade({})).toBe(true);
        expect(shouldShowUpgrade({ subscription: { active: false } })).toBe(true);
        expect(shouldShowUpgrade({ subscription: { active: true } })).toBe(false);
        expect(shouldShowUpgrade({ team: { uid: 'team' } })).toBe(false);
    });
    it('keeps menus within mobile and desktop viewports', () => {
        for ( const viewport of [{ width: 390, height: 700 }, { width: 1100, height: 720 }] ) {
            for ( const panel of ['apps', 'account'] ) {
                const box = toolbarBounds({ right: viewport.width, top: viewport.height - 48 }, viewport, panel);
                expect(box.left).toBeGreaterThanOrEqual(8);
                expect(box.top).toBeGreaterThanOrEqual(8);
                expect(box.left + box.width).toBeLessThanOrEqual(viewport.width - 8);
                expect(box.top + box.height).toBeLessThanOrEqual(viewport.height - 8);
            }
        }
    });
    it('keeps the toolbar buttons in place when the menu fits beside them', () => {
        for ( const [viewport, anchor] of [
            [{ width: 390, height: 700 }, { right: 374, top: 8 }],
            [{ width: 320, height: 560 }, { right: 304, top: 12 }],
            [{ width: 1100, height: 600 }, { right: 1084, top: 12 }],
        ] ) {
            for ( const panel of ['apps', 'account'] ) {
                const box = toolbarBounds(anchor, viewport, panel);
                expect(box.left + box.width).toBe(anchor.right);
                expect(box.top).toBe(anchor.top);
                expect(box.left).toBeGreaterThanOrEqual(8);
                expect(box.top + box.height).toBeLessThanOrEqual(viewport.height - 8);
            }
        }
    });
    it('opens an upgrade deep link once the billing UI is ready', () => {
        let opens = 0;
        const target = { location: { href: 'https://puter.com/dashboard?upgrade=1#usage' } };
        target.history = { replaceState: (_, __, href) => { target.location.href = href; } };
        openRequestedUpgrade(target);
        expect(target.location.href).toContain('upgrade=1');
        target.UIUpgradeAccount = class { open_as_window () { opens++; } };
        openRequestedUpgrade(target);
        openRequestedUpgrade(target);
        expect(opens).toBe(1);
        expect(target.location.href).toBe('https://puter.com/dashboard#usage');
    });
});
