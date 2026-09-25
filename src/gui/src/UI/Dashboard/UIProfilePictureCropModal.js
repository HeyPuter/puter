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

import { isTouchPrimaryDevice } from './ContextMenu/ContextMenu.js';
import {
    applyPinch,
    clampState,
    coverScale,
    initialState,
    panBy,
    rescaleState,
    scaleToSlider,
    sliderToScale,
    sourceRect,
    zoomTo,
} from './profilePictureCrop.js';

/** Side of the square PNG stored in the user's profile. */
const OUTPUT_SIZE = 150;
/** Photos are shrunk to this before previewing: plenty for a 150px avatar, cheap to transform. */
const MAX_SOURCE_SIDE = 2048;
const KEYBOARD_PAN_STEP = 10;
const SLIDER_STEPS = 100;
const BUTTON_ZOOM_STEP = 10;

const closeIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const zoomOutIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const zoomInIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

/**
 * Lets the user reposition and zoom a freshly picked photo inside the
 * circular avatar crop before it is saved. Same shell as the Dashboard's
 * share and item-properties modals: a centered card on desktop, a bottom
 * sheet on mobile. Pan by dragging (mouse, touch, or arrow keys); zoom with
 * the slider, a pinch, or the mouse wheel.
 *
 * @param {Object} opts
 * @param {Blob | Promise<Blob>} opts.picture - The chosen image file
 * @param {(dataUrl: string) => void} opts.onSave - Receives the cropped PNG as a data URL
 * @param {jQuery} [opts.$container] - Element to append the overlay to (defaults to <body>)
 * @param {HTMLElement} [opts.returnFocusTo] - Where focus goes on close; the picker that
 *   opened this modal has already closed by then, so the caller names its own trigger
 * @returns {{ close: () => void }}
 */
export default function UIProfilePictureCropModal ({ picture, onSave, $container, returnFocusTo }) {
    const $root = $container && $container.length ? $container : $('body');
    const id = window.uuidv4();
    const hint = isTouchPrimaryDevice()
        ? i18n('profile_picture_adjust_hint_touch')
        : i18n('profile_picture_adjust_hint');

    const $overlay = $(`
        <div class="profile-crop-overlay">
            <div class="profile-crop-modal" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="profile-crop-title-${id}">
                <div class="profile-crop-header">
                    <span class="profile-crop-title" id="profile-crop-title-${id}">${i18n('adjust_profile_picture')}</span>
                    <button type="button" class="profile-crop-close" aria-label="${i18n('close')}" title="${i18n('close')}">${closeIcon}</button>
                </div>
                <div class="profile-crop-body">
                    <div class="profile-crop-frame" tabindex="0" aria-label="${i18n('drag_to_reposition')}" aria-describedby="profile-crop-hint-${id}">
                        <div class="profile-crop-mask" aria-hidden="true"></div>
                        <span class="profile-crop-spinner" aria-hidden="true"></span>
                    </div>
                    <p class="profile-crop-hint" id="profile-crop-hint-${id}">${hint}</p>
                    <div class="profile-crop-zoom-row">
                        <button type="button" class="profile-crop-zoom-btn profile-crop-zoom-out" aria-label="${i18n('zoom_out')}" title="${i18n('zoom_out')}" disabled>${zoomOutIcon}</button>
                        <input type="range" class="profile-crop-zoom" min="0" max="${SLIDER_STEPS}" step="1" value="0" aria-label="${i18n('zoom')}" disabled />
                        <button type="button" class="profile-crop-zoom-btn profile-crop-zoom-in" aria-label="${i18n('zoom_in')}" title="${i18n('zoom_in')}" disabled>${zoomInIcon}</button>
                    </div>
                    <div class="profile-crop-status" role="status" aria-live="polite"></div>
                </div>
                <div class="profile-crop-footer">
                    <button type="button" class="profile-crop-btn-quiet profile-crop-cancel">${i18n('cancel')}</button>
                    <button type="button" class="profile-crop-save" disabled>${i18n('save')}</button>
                </div>
            </div>
        </div>
    `);

    $root.append($overlay);

    // Reveal after paint so the CSS transition (fade + scale/slide) runs.
    requestAnimationFrame(() => $overlay.addClass('profile-crop-show'));

    const frame = $overlay.find('.profile-crop-frame').get(0);
    const $slider = $overlay.find('.profile-crop-zoom');
    const $status = $overlay.find('.profile-crop-status');
    const $save = $overlay.find('.profile-crop-save');
    const $controls = $overlay.find('.profile-crop-zoom, .profile-crop-zoom-btn');

    // Focus returns to the caller's trigger, or wherever it was, when the modal closes.
    const el_previous_focus = document.activeElement;
    $overlay.find('.profile-crop-modal').get(0)?.focus({ preventScroll: true });

    let closed = false;

    // -- Crop state (see profilePictureCrop.js for the model) --
    /** The downscaled photo; doubles as the on-screen preview element. */
    let source = null;
    let image = null;
    let frameSize = 0;
    let state = null;
    let objectUrl = null;
    let resizeObserver = null;

    const minScale = () => coverScale(image, frameSize);

    const render = ({ slider = true } = {}) => {
        source.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
        if ( slider ) {
            $slider.val(Math.round(scaleToSlider(state.scale, minScale()) * SLIDER_STEPS));
        }
        // A 0..100 slider value means nothing read aloud; announce the magnification.
        const zoomFactor = (state.scale / minScale()).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        $slider.attr('aria-valuetext', `${zoomFactor}×`);
    };

    const setSlider = (value) => {
        if ( ! state ) return;
        const t = Math.min(SLIDER_STEPS, Math.max(0, value)) / SLIDER_STEPS;
        state = zoomTo(state, sliderToScale(t, minScale()), image, frameSize);
        render();
    };

    const fail = () => {
        $overlay.find('.profile-crop-spinner').prop('hidden', true);
        $status.text(i18n('profile_picture_load_failed'));
    };

    // Shrinks the decoded photo once so the preview, gestures, and final crop
    // all work on a bounded bitmap; a phone photo can be tens of megapixels.
    const toWorkingCanvas = (img) => {
        const k = Math.min(1, MAX_SOURCE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas;
    };

    const ready = (img) => {
        if ( closed ) return;
        if ( ! img.naturalWidth || ! img.naturalHeight ) {
            fail();
            return;
        }
        // Layout width, not getBoundingClientRect: the photo can load while
        // the modal is still mid-transition at scale(0.96).
        frameSize = frame.clientWidth;
        if ( ! frameSize ) {
            fail();
            return;
        }
        source = toWorkingCanvas(img);
        source.className = 'profile-crop-image';
        source.setAttribute('aria-hidden', 'true');
        image = { width: source.width, height: source.height };
        state = initialState(image, frameSize);
        $(frame).prepend(source);
        $overlay.find('.profile-crop-spinner').prop('hidden', true);
        $controls.prop('disabled', false);
        $save.prop('disabled', false);
        render();

        // Rotating a phone can change the frame's size; keep the same crop.
        if ( typeof ResizeObserver !== 'undefined' ) {
            resizeObserver = new ResizeObserver(() => {
                const next = frame.clientWidth;
                if ( ! next || next === frameSize ) return;
                state = clampState(rescaleState(state, frameSize, next), image, next);
                frameSize = next;
                render();
            });
            resizeObserver.observe(frame);
        }
    };

    Promise.resolve(picture).then((blob) => {
        if ( closed ) return;
        objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => ready(img);
        img.onerror = fail;
        img.src = objectUrl;
    }).catch(fail);

    // -- Dismissal --
    const close = () => {
        if ( closed ) return;
        closed = true;
        $overlay.removeClass('profile-crop-show');
        $(document).off(`keydown.profile-crop-${id}`);
        resizeObserver?.disconnect();
        if ( objectUrl ) URL.revokeObjectURL(objectUrl);
        setTimeout(() => $overlay.remove(), 200);
        const el_focus_target = [returnFocusTo, el_previous_focus].find((el) => el && document.contains(el));
        if ( el_focus_target ) {
            try {
                el_focus_target.focus({ preventScroll: true });
            } catch { /* focus restoration is best-effort */ }
        }
    };

    $overlay.on('click', '.profile-crop-close, .profile-crop-cancel', close);
    // Backdrop close goes by where the press STARTED: a drag that begins in
    // the frame and releases over the backdrop must not discard the edit.
    let backdrop_pressed = false;
    $overlay.on('mousedown', function (e) {
        backdrop_pressed = e.target === $overlay[0];
    });
    $overlay.on('click', function (e) {
        if ( e.target === $overlay[0] && backdrop_pressed ) close();
    });
    $(document).on(`keydown.profile-crop-${id}`, function (e) {
        if ( e.key === 'Escape' ) close();
    });

    // Keep Tab cycling inside the dialog while it's up.
    $overlay.on('keydown', function (e) {
        if ( e.key !== 'Tab' ) return;
        const focusables = $overlay
            .find('button, input, [tabindex]:not([tabindex="-1"])')
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

    // -- Pan and pinch --
    // One pointer drags; two pinch. Pointer capture keeps a drag alive after
    // the finger leaves the frame, and touch-action: none (CSS) stops the page
    // from scrolling or zooming underneath.
    const pointers = new Map();

    frame.addEventListener('pointerdown', (e) => {
        if ( ! state || e.button !== 0 ) return;
        // Also suppresses the compatibility mouse events, so a drag never
        // registers as a backdrop press or a text selection -- nor moves
        // focus, so the frame takes it itself for the arrow keys. Focus that
        // arrives by pointer draws no ring (CSS); the first key press does.
        e.preventDefault();
        frame.classList.add('profile-crop-frame-pointer-focus');
        frame.focus({ preventScroll: true });
        frame.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        frame.classList.add('profile-crop-frame-dragging');
    });

    frame.addEventListener('pointermove', (e) => {
        const prev = pointers.get(e.pointerId);
        if ( ! prev || ! state ) return;
        const next = { x: e.clientX, y: e.clientY };
        if ( pointers.size === 1 ) {
            state = panBy(state, next.x - prev.x, next.y - prev.y, image, frameSize);
        } else {
            const otherId = [...pointers.keys()].find((pointerId) => pointerId !== e.pointerId);
            const other = pointers.get(otherId);
            state = applyPinch(state, prev, other, next, other, image, frameSize);
        }
        pointers.set(e.pointerId, next);
        render();
    });

    const releasePointer = (e) => {
        pointers.delete(e.pointerId);
        if ( frame.hasPointerCapture?.(e.pointerId) ) frame.releasePointerCapture(e.pointerId);
        if ( ! pointers.size ) frame.classList.remove('profile-crop-frame-dragging');
    };
    frame.addEventListener('pointerup', releasePointer);
    frame.addEventListener('pointercancel', releasePointer);
    frame.addEventListener('lostpointercapture', releasePointer);

    frame.addEventListener('wheel', (e) => {
        if ( ! state ) return;
        e.preventDefault();
        // Clamp so one mouse notch (deltaY ~100) is a firm step, not a leap,
        // while a trackpad's small deltas stay smooth.
        const delta = Math.max(-40, Math.min(40, e.deltaY));
        state = zoomTo(state, state.scale * Math.exp(-delta * 0.005), image, frameSize);
        render();
    }, { passive: false });

    frame.addEventListener('keydown', (e) => {
        frame.classList.remove('profile-crop-frame-pointer-focus');
        if ( ! state ) return;
        const pan = {
            ArrowLeft: [-KEYBOARD_PAN_STEP, 0],
            ArrowRight: [KEYBOARD_PAN_STEP, 0],
            ArrowUp: [0, -KEYBOARD_PAN_STEP],
            ArrowDown: [0, KEYBOARD_PAN_STEP],
        }[e.key];
        if ( pan ) {
            e.preventDefault();
            state = panBy(state, pan[0], pan[1], image, frameSize);
            render();
        } else if ( e.key === '+' || e.key === '=' ) {
            e.preventDefault();
            setSlider(Number($slider.val()) + BUTTON_ZOOM_STEP);
        } else if ( e.key === '-' || e.key === '_' ) {
            e.preventDefault();
            setSlider(Number($slider.val()) - BUTTON_ZOOM_STEP);
        }
    });
    frame.addEventListener('blur', () => frame.classList.remove('profile-crop-frame-pointer-focus'));

    // -- Zoom controls --
    $slider.on('input', function () {
        if ( ! state ) return;
        state = zoomTo(state, sliderToScale(Number(this.value) / SLIDER_STEPS, minScale()), image, frameSize);
        // The slider already shows this value; rewriting it mid-drag can jitter.
        render({ slider: false });
    });
    $overlay.on('click', '.profile-crop-zoom-in', () => setSlider(Number($slider.val()) + BUTTON_ZOOM_STEP));
    $overlay.on('click', '.profile-crop-zoom-out', () => setSlider(Number($slider.val()) - BUTTON_ZOOM_STEP));

    // -- Save --
    $save.on('click', function () {
        if ( ! state ) return;
        const canvas = document.createElement('canvas');
        canvas.width = OUTPUT_SIZE;
        canvas.height = OUTPUT_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        const { x, y, size } = sourceRect(state, frameSize);
        ctx.drawImage(source, x, y, size, size, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
        let dataUrl;
        try {
            dataUrl = canvas.toDataURL('image/png');
        } catch {
            fail();
            return;
        }
        onSave(dataUrl);
        close();
    });

    return { close };
}
