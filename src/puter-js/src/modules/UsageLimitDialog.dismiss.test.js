// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showUsageLimitDialog } from './UsageLimitDialog.js';

// jsdom has no top-layer dialogs.
HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
};
HTMLDialogElement.prototype.close = function () {
    this.open = false;
};

const shown = () => document.querySelector('usage-limit-dialog');
const part = (selector) => shown().shadowRoot.querySelector(selector);

beforeEach(() => {
    document.body.innerHTML = '';
    window.open = vi.fn();
});

describe('the usage limit dialog', () => {
    it('opens a modal saying what was refused', () => {
        showUsageLimitDialog('Not enough <b>credit</b>.', { title: 'Out of credit', method: 'puter.ai.chat' });

        expect(part('dialog').open).toBe(true);
        expect(part('h2').textContent).toBe('Out of credit');
        expect(part('.message').textContent).toBe('Not enough <b>credit</b>.Please upgrade to continue.');
        expect(part('.message b')).toBeNull();
        expect(part('.method').textContent).toBe('puter.ai.chat');
    });

    it('shows one dialog at a time', () => {
        showUsageLimitDialog('First');
        showUsageLimitDialog('Second');

        expect(document.querySelectorAll('usage-limit-dialog')).toHaveLength(1);
        expect(part('.message').textContent).toContain('First');
    });

    it.each([
        ['the Close button', '#close-btn'],
        ['the X', '.close-btn'],
        ['a click on the backdrop', 'dialog'],
    ])('closes on %s without starting an upgrade', (_control, selector) => {
        const onUpgrade = vi.fn();
        showUsageLimitDialog('Not enough credit.', { onUpgrade });
        const dialog = part('dialog');

        part(selector).click();

        expect(dialog.open).toBe(false);
        expect(shown()).toBeNull();
        expect(onUpgrade).not.toHaveBeenCalled();
        expect(window.open).not.toHaveBeenCalled();
    });

    it('stays open on a click inside the dialog', () => {
        showUsageLimitDialog('Not enough credit.');

        part('.message').click();

        expect(shown()).not.toBeNull();
        expect(part('dialog').open).toBe(true);
    });
});
