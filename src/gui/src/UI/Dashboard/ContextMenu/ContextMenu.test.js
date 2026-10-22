// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.i18n = (key) => key;

const { default: ContextMenuModal } = await import('./ContextMenu.js');

const setTouchViewport = (width, touch = true) => {
    window.innerWidth = width;
    window.innerHeight = 800;
    window.matchMedia = (query) => ({
        matches: touch && (query === '(pointer: coarse)' || query === '(hover: none)'),
    });
};

const openMenu = () => {
    const menu = new ContextMenuModal();
    menu.show([{ label: 'Open', action: () => {} }], { left: 100, top: 100, width: 200, height: 30 });
    return document.querySelector('.context-menu-modal-dialog');
};

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('ContextMenuModal width', () => {
    it('takes 90% of a phone screen', () => {
        setTouchViewport(390);
        expect(openMenu().style.width).toBe('351px');
    });

    it('stops at a card width on a tablet instead of spanning the screen', () => {
        setTouchViewport(1024);
        expect(openMenu().style.width).toBe('400px');
    });

    it('sizes to its content for a mouse', () => {
        setTouchViewport(1024, false);
        expect(openMenu().style.width).toBe('auto');
    });
});
