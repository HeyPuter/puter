import { afterAll, describe, expect, it, vi } from 'vitest';

// Just enough of an element for the constructor to render into.
vi.stubGlobal(
    'HTMLElement',
    class {
        attachShadow() {
            this.shadowRoot = { innerHTML: '' };
            return this.shadowRoot;
        }
    },
);
const { default: EmailConfirmationDialog } =
    await import('./EmailConfirmationDialog.js');

afterAll(() => {
    vi.unstubAllGlobals();
});

describe('EmailConfirmationDialog', () => {
    it('renders the message as text', () => {
        const dialog = new EmailConfirmationDialog(
            '<img src=x onerror="alert(1)"> & more',
        );
        const html = dialog.shadowRoot.innerHTML;
        expect(html).toContain(
            '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; more',
        );
        expect(html).not.toContain('<img');
    });

    it('falls back to the default message', () => {
        const dialog = new EmailConfirmationDialog();
        expect(dialog.shadowRoot.innerHTML).toContain(
            'Please confirm your email address to use this service.',
        );
    });
});
