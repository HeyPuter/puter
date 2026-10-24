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
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const { default: mountDashboardOverlay, bindBackdropDismiss } = await import('./dashboardOverlay.js');

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const card = '<div class="dashboard-dialog" tabindex="-1"><button class="dashboard-dialog-close">x</button><input class="inside"></div>';
const escape = () => $(document).trigger($.Event('keydown', { key: 'Escape' }));

afterEach(() => {
    document.body.innerHTML = '';
    delete window.visualViewport;
});

describe('mountDashboardOverlay', () => {
    it('reveals after a frame, but not once it has already closed', async () => {
        const a = mountDashboardOverlay({ html: card });
        await tick();
        expect(a.$overlay.hasClass('dashboard-dialog-show')).toBe(true);

        const b = mountDashboardOverlay({ html: card });
        b.close();
        await tick();
        expect(b.$overlay.hasClass('dashboard-dialog-show')).toBe(false);
        expect(b.isClosed()).toBe(true);
    });

    it('reports dismissal by Escape or the close button, but not close()', () => {
        const onDismiss = vi.fn();
        const a = mountDashboardOverlay({ html: card, onDismiss });
        a.close();
        expect(onDismiss).not.toHaveBeenCalled();

        mountDashboardOverlay({ html: card, onDismiss });
        escape();
        expect(onDismiss).toHaveBeenCalledOnce();

        mountDashboardOverlay({ html: card, onDismiss });
        $('.dashboard-dialog-close').last().trigger('click');
        expect(onDismiss).toHaveBeenCalledTimes(2);
    });

    it('stays up when canDismiss says no, and tells it which way was tried', () => {
        const canDismiss = vi.fn(() => false);
        const a = mountDashboardOverlay({ html: card, canDismiss });
        escape();
        $('.dashboard-dialog-close').trigger('click');
        a.$overlay.trigger($.Event('mousedown', { target: a.$overlay[0] }));
        a.$overlay.trigger($.Event('click', { target: a.$overlay[0] }));
        expect(canDismiss.mock.calls.map(([via]) => via)).toEqual(['escape', 'close', 'backdrop']);
        expect(a.isClosed()).toBe(false);
    });

    // A window opened from the overlay (the session manager, say) owns its own Escape.
    it('leaves Escape alone while focus is somewhere outside it', () => {
        document.body.innerHTML = '<input class="elsewhere">';
        const onDismiss = vi.fn();
        const { isClosed } = mountDashboardOverlay({ html: card, onDismiss });
        $('.elsewhere').get(0).focus();
        escape();
        expect(isClosed()).toBe(false);

        $('.inside').get(0).focus();
        escape();
        expect(isClosed()).toBe(true);
    });

    it('leaves Escape alone while something else is painted over it', () => {
        document.body.innerHTML = '<div class="on-top"></div>';
        const { isClosed } = mountDashboardOverlay({ html: card });
        document.elementFromPoint = () => $('.on-top').get(0);
        escape();
        expect(isClosed()).toBe(false);

        document.elementFromPoint = () => $('.inside').get(0);
        escape();
        expect(isClosed()).toBe(true);
        delete document.elementFromPoint;
    });

    it('closes on a backdrop click, but not on the second click of a double-click', () => {
        const press = (detail) => {
            const el = $('.dashboard-dialog-overlay').get(0);
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
        };
        const a = mountDashboardOverlay({ html: card });
        press(2);
        expect(a.isClosed()).toBe(false);
        press(1);
        expect(a.isClosed()).toBe(true);
    });

    it('hands focus back to the given element on close', () => {
        document.body.innerHTML = '<button class="trigger">open</button>';
        const trigger = $('.trigger').get(0);
        const { close } = mountDashboardOverlay({ html: card, returnFocusTo: trigger });
        $('.inside').get(0).focus();
        close();
        expect(document.activeElement).toBe(trigger);
    });

    it('fits itself above an on-screen keyboard and lets go when it hides', () => {
        const listeners = {};
        window.visualViewport = {
            height: window.innerHeight,
            offsetTop: 0,
            addEventListener: (type, fn) => {
                listeners[type] = fn;
            },
            removeEventListener: vi.fn(),
        };
        const { $overlay, close } = mountDashboardOverlay({ html: card });
        const el = $overlay.get(0);

        window.visualViewport.height = window.innerHeight - 300;
        listeners.resize();
        expect(el.style.height).toBe(`${window.innerHeight - 300}px`);
        expect(el.style.bottom).toBe('auto');
        expect($overlay.hasClass('dashboard-dialog-overlay-keyboard')).toBe(true);

        window.visualViewport.height = window.innerHeight;
        listeners.resize();
        expect(el.style.height).toBe('');
        expect($overlay.hasClass('dashboard-dialog-overlay-keyboard')).toBe(false);

        close();
        expect(window.visualViewport.removeEventListener).toHaveBeenCalledWith('resize', listeners.resize);
    });
});

describe('bindBackdropDismiss', () => {
    const mount = () => {
        document.body.innerHTML = '<div class="scrim"><div class="card"><textarea></textarea></div></div>';
        const $overlay = $('.scrim');
        const dismiss = vi.fn();
        bindBackdropDismiss($overlay, (el) => el === $overlay[0], dismiss);
        return { el_scrim: $overlay[0], el_card: $('.card')[0], dismiss };
    };
    const fire = (el, type, detail = 1) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, detail }));

    it('dismisses on a press and release on the backdrop', () => {
        const { el_scrim, dismiss } = mount();
        fire(el_scrim, 'mousedown');
        fire(el_scrim, 'click');
        expect(dismiss).toHaveBeenCalledTimes(1);
    });

    it('keeps the overlay when a drag from the card ends on the backdrop', () => {
        const { el_scrim, el_card, dismiss } = mount();
        fire(el_card, 'mousedown');
        // The browser fires the click on the nearest common ancestor.
        fire(el_scrim, 'click');
        expect(dismiss).not.toHaveBeenCalled();
    });

    it('ignores the second press of the double-click that opened it', () => {
        const { el_scrim, dismiss } = mount();
        fire(el_scrim, 'mousedown', 2);
        fire(el_scrim, 'click', 2);
        expect(dismiss).not.toHaveBeenCalled();
    });
});
