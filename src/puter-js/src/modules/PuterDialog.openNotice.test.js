import { describe, expect, it, vi } from 'vitest';

const { default: PuterDialog } = await import('./PuterDialog.js');

/** A dialog instance without running the DOM-dependent constructor. */
const makeDialog = (showModal) => {
    const dialog = Object.create(PuterDialog.prototype);
    dialog.shadowRoot = { querySelector: () => ({ showModal }) };
    return dialog;
};

describe('openNotice', () => {
    it('shows the dialog', () => {
        const showModal = vi.fn();
        makeDialog(showModal).openNotice();
        expect(showModal).toHaveBeenCalledTimes(1);
    });

    // Runs from the Puter constructor: a throw leaves no `puter` global.
    it('survives a browser that refuses the modal', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const showModal = vi.fn(() => { throw new Error('InvalidStateError'); });
        expect(() => makeDialog(showModal).openNotice()).not.toThrow();
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });
});
