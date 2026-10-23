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

// The shell every `.dashboard-dialog` card shares: a backdrop that fades in,
// and the ways out of it. What goes inside the card is the caller's.

let overlay_seq = 0;

/**
 * Whether a keypress belongs to this overlay rather than to a window or
 * modal opened over it. Not all of those take focus, so what is painted
 * over the overlay's center counts too.
 *
 * @param {HTMLElement} el_overlay
 * @returns {boolean}
 */
export function isOverlayOnTop (el_overlay) {
    const el_active = document.activeElement;
    if ( el_active && el_active !== document.body && ! el_overlay.contains(el_active) ) return false;
    const el_top = document.elementFromPoint?.(window.innerWidth / 2, window.innerHeight / 2);
    return ! (el_top && ! el_overlay.contains(el_top));
}

/**
 * Mounts `.dashboard-dialog-overlay` around the given card and wires the
 * reveal transition, dismissal (Escape, `.dashboard-dialog-close`, a press
 * and release on the backdrop), a Tab focus trap, room for an on-screen
 * keyboard, and focus restoration on close.
 *
 * @param {object} opts
 * @param {string} opts.html The `.dashboard-dialog` card's markup.
 * @param {jQuery} [opts.$container] Where the overlay mounts; defaults to body.
 * @param {HTMLElement} [opts.returnFocusTo] Where focus goes on close; falls
 *   back to whatever had it when the overlay opened.
 * @param {() => void} [opts.onDismiss] Runs when the user dismisses the
 *   overlay, after it has closed. Not called for `close()`.
 * @returns {{ $overlay: jQuery, $dialog: jQuery, close: () => void, isClosed: () => boolean }}
 */
export default function mountDashboardOverlay ({ html, $container, returnFocusTo, onDismiss }) {
    const $root = $container && $container.length ? $container : $('body');
    const ns = `.dashboard-overlay-${++overlay_seq}`;
    const el_previous_focus = document.activeElement;

    const $overlay = $(`<div class="dashboard-dialog-overlay">${html}</div>`);
    const $dialog = $overlay.children('.dashboard-dialog');
    const el_overlay = $overlay.get(0);
    $root.append($overlay);

    // iOS lays its keyboard over the page rather than resizing it, which
    // would leave a bottom sheet's fields and buttons underneath. Pin the
    // overlay to the part of the screen that is still visible.
    const viewport = window.visualViewport;
    const fitToViewport = () => {
        const covered = window.innerHeight - viewport.height - viewport.offsetTop;
        const pinned = covered > 1 || viewport.offsetTop > 1;
        el_overlay.style.top = pinned ? `${viewport.offsetTop}px` : '';
        el_overlay.style.height = pinned ? `${viewport.height}px` : '';
        el_overlay.style.bottom = pinned ? 'auto' : '';
        $overlay.toggleClass('dashboard-dialog-overlay-keyboard', covered > 1);
    };
    viewport?.addEventListener('resize', fitToViewport);
    viewport?.addEventListener('scroll', fitToViewport);

    let closed = false;
    // Reveal after paint so the CSS transition runs, unless it was closed first.
    requestAnimationFrame(() => {
        if ( ! closed ) $overlay.addClass('dashboard-dialog-show');
    });

    const close = () => {
        if ( closed ) return;
        closed = true;
        $overlay.removeClass('dashboard-dialog-show');
        $(document).off(`keydown${ns}`);
        viewport?.removeEventListener('resize', fitToViewport);
        viewport?.removeEventListener('scroll', fitToViewport);
        setTimeout(() => $overlay.remove(), 200);
        const el_focus_target = [returnFocusTo, el_previous_focus].find((el) => el && document.contains(el));
        try {
            el_focus_target?.focus({ preventScroll: true });
        } catch { /* focus restoration is best-effort */ }
    };
    const dismiss = () => {
        if ( closed ) return;
        close();
        onDismiss?.();
    };

    $overlay.on('click', '.dashboard-dialog-close', dismiss);

    // Backdrop close goes by where the press started, so a drag that
    // starts in the card and ends outside does not dismiss it. The second
    // press of a double-click on the button that opened it doesn't count.
    let backdrop_pressed = false;
    $overlay.on('mousedown', function (e) {
        backdrop_pressed = e.target === el_overlay && (e.detail ?? 0) < 2;
        // A press inside the overlay must not let initgui's global mousedown
        // hand focus (and the z-index) back to the window underneath it.
        window.mouseover_window = undefined;
    });
    $overlay.on('click', function (e) {
        if ( e.target === el_overlay && backdrop_pressed ) dismiss();
    });

    $(document).on(`keydown${ns}`, function (e) {
        // Escape belongs to whatever is on top: a window or modal opened over
        // this overlay closes itself, not the overlay underneath it.
        if ( e.key !== 'Escape' || ! isOverlayOnTop(el_overlay) ) return;
        dismiss();
    });

    // Keep Tab cycling inside the card while it's up.
    $overlay.on('keydown', function (e) {
        if ( e.key !== 'Tab' ) return;
        const focusables = $dialog
            .find('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')
            .filter(':visible:not(:disabled)');
        if ( ! focusables.length ) return;
        const first = focusables.get(0);
        const last = focusables.get(focusables.length - 1);
        if ( focusables.index(document.activeElement) === -1 ) {
            e.preventDefault();
            (e.shiftKey ? last : first).focus();
        } else if ( e.shiftKey && document.activeElement === first ) {
            e.preventDefault();
            last.focus();
        } else if ( ! e.shiftKey && document.activeElement === last ) {
            e.preventDefault();
            first.focus();
        }
    });

    return { $overlay, $dialog, close, isClosed: () => closed };
}
