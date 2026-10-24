// @vitest-environment jsdom
/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
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

describe('ContextMenuModal accessibility', () => {
    const items = [
        { label: 'Open', action: () => {} },
        '-',
        { label: 'Locked', disabled: true, action: () => {} },
        { label: 'New', items: [{ label: 'Folder', action: () => {} }] },
    ];
    const press = (el, key, init = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

    it('is a menu of menuitems and separators', () => {
        setTouchViewport(390);
        const menu = new ContextMenuModal();
        menu.show(items, { left: 0, top: 0, width: 10, height: 10 }, { title: 'a.txt' });
        const dialog = document.querySelector('.context-menu-modal-dialog');
        expect(dialog.getAttribute('role')).toBe('menu');
        expect(dialog.getAttribute('aria-label')).toBe('a.txt');
        expect([...dialog.querySelectorAll('.context-menu-item')].map(b => b.getAttribute('role')))
            .toEqual(['menuitem', 'menuitem', 'menuitem']);
        expect(dialog.querySelector('.context-menu-separator').getAttribute('role')).toBe('separator');
        expect(dialog.querySelectorAll('[aria-haspopup="menu"]')).toHaveLength(1);
    });

    it('takes focus on open and gives it back on close', () => {
        setTouchViewport(390);
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();
        const menu = new ContextMenuModal();
        menu.show(items, { left: 0, top: 0, width: 10, height: 10 });
        const dialog = document.querySelector('.context-menu-modal-dialog');
        expect(document.activeElement).toBe(dialog);
        menu.close();
        expect(document.activeElement).toBe(opener);
    });

    it('moves between enabled items with the arrow keys, skipping disabled ones', () => {
        setTouchViewport(390);
        const menu = new ContextMenuModal();
        menu.show(items, { left: 0, top: 0, width: 10, height: 10 });
        const dialog = document.querySelector('.context-menu-modal-dialog');
        const label = () => document.activeElement.querySelector('.context-menu-item-label')?.textContent;
        press(dialog, 'ArrowDown');
        expect(label()).toBe('Open');
        press(document.activeElement, 'ArrowDown');
        expect(label()).toBe('New');
        press(document.activeElement, 'ArrowDown');
        expect(label()).toBe('Open');
        press(document.activeElement, 'ArrowUp');
        expect(label()).toBe('New');
    });

    it('keeps Tab and Shift+Tab inside the menu', () => {
        setTouchViewport(390);
        const menu = new ContextMenuModal();
        menu.show(items, { left: 0, top: 0, width: 10, height: 10 });
        const dialog = document.querySelector('.context-menu-modal-dialog');
        const label = () => document.activeElement.querySelector('.context-menu-item-label')?.textContent;
        press(dialog, 'ArrowDown');
        press(document.activeElement, 'Tab');
        expect(label()).toBe('New');
        expect(press(document.activeElement, 'Tab')).toBe(false);
        expect(label()).toBe('Open');
        press(document.activeElement, 'Tab', { shiftKey: true });
        expect(label()).toBe('New');
    });
});
