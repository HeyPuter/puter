import { describe, expect, it } from 'vitest';
import { upgradeUrl } from './UsageLimitDialog.js';

describe('upgradeUrl', () => {
    it('opens the dashboard with what was refused', () => {
        const url = new URL(upgradeUrl({
            reason: 'funds',
            appID: 'app-0b8a6d4e-6c1f-4a52-9d3e-2f7b1c9e8a10',
            method: 'puter-chat-completion::complete',
        }));
        expect(url.origin + url.pathname).toBe('https://puter.com/dashboard/');
        expect(url.hash).toBe('#home');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            upgrade: 'funds',
            upgrade_app: 'app-0b8a6d4e-6c1f-4a52-9d3e-2f7b1c9e8a10',
            upgrade_method: 'puter-chat-completion::complete',
        });
    });

    it('leaves out what it was not told', () => {
        expect(upgradeUrl({ reason: 'storage' })).toBe('https://puter.com/dashboard/?upgrade=storage#home');
        expect(upgradeUrl()).toBe('https://puter.com/dashboard/#home');
    });
});
