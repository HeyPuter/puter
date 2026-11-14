// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showEmailConfirmationDialog } from './EmailConfirmationDialog.js';

// jsdom has no top-layer dialogs.
HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
};
HTMLDialogElement.prototype.close = function () {
    this.open = false;
};

const shown = () => document.querySelector('email-confirmation-dialog');
const part = (selector) => shown().shadowRoot.querySelector(selector);

beforeEach(() => {
    document.body.innerHTML = '';
    window.open = vi.fn();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('showEmailConfirmationDialog', () => {
    it('opens a modal with the message as text', () => {
        showEmailConfirmationDialog('Confirm <b>now</b> to keep going.');

        expect(part('dialog').open).toBe(true);
        expect(part('.message').textContent).toBe('Confirm <b>now</b> to keep going.');
        expect(part('.message b')).toBeNull();
    });

    it('shows one dialog at a time', () => {
        showEmailConfirmationDialog('First');
        showEmailConfirmationDialog('Second');

        expect(document.querySelectorAll('email-confirmation-dialog')).toHaveLength(1);
        expect(part('.message').textContent).toBe('First');
    });

    it('opens puter.com in a new tab from its main button, and closes', () => {
        showEmailConfirmationDialog();
        const dialog = part('dialog');

        part('#confirm-email-btn').click();

        expect(window.open).toHaveBeenCalledWith('https://puter.com', '_blank');
        expect(dialog.open).toBe(false);
        expect(shown()).toBeNull();
    });

    it.each([
        ['the Close button', '#close-btn'],
        ['the X', '.close-btn'],
        ['a click on the backdrop', 'dialog'],
    ])('closes on %s without opening anything', (_control, selector) => {
        showEmailConfirmationDialog();
        const dialog = part('dialog');

        part(selector).click();

        expect(dialog.open).toBe(false);
        expect(shown()).toBeNull();
        expect(window.open).not.toHaveBeenCalled();
    });

    it('stays open on a click inside the dialog', () => {
        showEmailConfirmationDialog();

        part('.message').click();

        expect(shown()).not.toBeNull();
        expect(part('dialog').open).toBe(true);
    });

    it('can be shown again after it was closed', () => {
        showEmailConfirmationDialog('First');
        part('#close-btn').click();
        showEmailConfirmationDialog('Second');

        expect(part('.message').textContent).toBe('Second');
    });

    it('does nothing where there is no document', () => {
        const page = document;
        vi.stubGlobal('document', undefined);

        expect(() => showEmailConfirmationDialog('Confirm')).not.toThrow();
        expect(page.querySelector('email-confirmation-dialog')).toBeNull();
    });
});
