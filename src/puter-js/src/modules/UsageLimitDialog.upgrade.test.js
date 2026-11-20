// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showUsageLimitDialog } from './UsageLimitDialog.js';

// jsdom has no top-layer dialogs.
HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
};
HTMLDialogElement.prototype.close = function () {
    this.open = false;
};

const upgradeButton = () => document.querySelector('usage-limit-dialog').shadowRoot.querySelector('#upgrade-btn');

beforeEach(() => {
    document.body.innerHTML = '';
    window.open = vi.fn();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('the usage limit dialog Upgrade button', () => {
    it('opens the dashboard upgrade in a new tab', () => {
        showUsageLimitDialog('Not enough storage space available.', { reason: 'storage', method: 'puter.fs.upload' });
        upgradeButton().click();
        expect(window.open).toHaveBeenCalledWith(
            'https://puter.com/dashboard/?upgrade=storage&upgrade_method=puter.fs.upload#home',
            '_blank',
        );
        expect(document.querySelector('usage-limit-dialog')).toBeNull();
    });

    it('runs onUpgrade instead, once the dialog has closed', () => {
        const onUpgrade = vi.fn(() => {
            expect(document.querySelector('usage-limit-dialog')).toBeNull();
        });
        showUsageLimitDialog('Not enough storage space available.', { reason: 'storage', onUpgrade });
        upgradeButton().click();
        expect(onUpgrade).toHaveBeenCalledTimes(1);
        expect(window.open).not.toHaveBeenCalled();
    });

    it('opens the tab after all when onUpgrade can\'t show the upgrade', () => {
        showUsageLimitDialog('Not enough storage space available.', { reason: 'storage', onUpgrade: () => false });
        upgradeButton().click();
        expect(window.open).toHaveBeenCalledWith('https://puter.com/dashboard/?upgrade=storage#home', '_blank');
        expect(document.querySelector('usage-limit-dialog')).toBeNull();
    });
});
