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

describe('the usage limit dialog for an account that can add credits', () => {
    const shadow = () => document.querySelector('usage-limit-dialog').shadowRoot;

    it('leads with Add Credits, keeps Upgrade beside it, and says what to do', () => {
        showUsageLimitDialog('Your account does not have enough funding to complete this request.', {
            reason: 'funds', onTopUp: vi.fn(),
        });
        const labels = [...shadow().querySelectorAll('.buttons button')].map((button) => button.textContent.trim());
        expect(labels).toEqual(['Add Credits', 'Upgrade Plan', 'Close']);
        expect(shadow().querySelector('#top-up-btn').classList.contains('button-primary')).toBe(true);
        expect(shadow().querySelector('#upgrade-btn').classList.contains('button-primary')).toBe(false);
        expect(shadow().querySelector('.message').textContent).toContain('Add credits to continue.');
    });

    it('runs onTopUp once the dialog has closed, and opens no tab', () => {
        const onTopUp = vi.fn(() => {
            expect(document.querySelector('usage-limit-dialog')).toBeNull();
        });
        showUsageLimitDialog('Out of credit.', { reason: 'funds', onTopUp });
        shadow().querySelector('#top-up-btn').click();
        expect(onTopUp).toHaveBeenCalledTimes(1);
        expect(window.open).not.toHaveBeenCalled();
    });

    it('still upgrades from its Upgrade button', () => {
        showUsageLimitDialog('Out of credit.', { reason: 'funds', onTopUp: vi.fn() });
        upgradeButton().click();
        expect(window.open).toHaveBeenCalledWith('https://puter.com/dashboard/?upgrade=funds#home', '_blank');
    });

    it('offers only the upgrade to everyone else', () => {
        showUsageLimitDialog('Out of credit.', { reason: 'funds' });
        expect(shadow().querySelector('#top-up-btn')).toBeNull();
        expect(upgradeButton().textContent).toBe('Upgrade Now');
        expect(upgradeButton().classList.contains('button-primary')).toBe(true);
        expect(shadow().querySelector('.message').textContent).toContain('Please upgrade to continue.');
    });
});
