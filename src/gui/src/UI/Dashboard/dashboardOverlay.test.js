// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const { default: mountDashboardOverlay } = await import('./dashboardOverlay.js');

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
