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

// Geometry for the profile-picture adjust modal. A square frame of
// `frameSize` CSS px shows the image drawn at `scale` with its top-left
// corner at (`x`, `y`) relative to the frame; the crop is whatever the
// frame shows. Everything here keeps the frame fully covered.

/** @typedef {{ width: number; height: number }} ImageSize */
/** @typedef {{ scale: number; x: number; y: number }} CropState */
/** @typedef {{ x: number; y: number }} Point */

/** How far past the cover-fit scale the user may zoom in. */
export const MAX_ZOOM = 4;

const clamp01 = (t) => Math.min(1, Math.max(0, t));

/** Smallest scale at which the image still covers the whole frame. */
export const coverScale = (image, frameSize) =>
    frameSize / Math.min(image.width, image.height);

/** The image may overhang the frame on any side but never fall short of it. */
export const clampOffset = (offset, imageSide, scale, frameSize) => {
    const min = frameSize - imageSide * scale;
    return Math.min(0, Math.max(min, offset));
};

/** @returns {CropState} */
export const clampState = (state, image, frameSize) => ({
    scale: state.scale,
    x: clampOffset(state.x, image.width, state.scale, frameSize),
    y: clampOffset(state.y, image.height, state.scale, frameSize),
});

/** Cover-fit, centered: the starting point before the user adjusts anything. */
export const initialState = (image, frameSize) => {
    const scale = coverScale(image, frameSize);
    return {
        scale,
        x: (frameSize - image.width * scale) / 2,
        y: (frameSize - image.height * scale) / 2,
    };
};

/** @returns {CropState} */
export const panBy = (state, dx, dy, image, frameSize) =>
    clampState({ scale: state.scale, x: state.x + dx, y: state.y + dy }, image, frameSize);

/**
 * Zoom around the frame's center so the subject stays put, bounded to
 * [cover-fit, cover-fit * MAX_ZOOM].
 * @returns {CropState}
 */
export const zoomTo = (state, targetScale, image, frameSize) => {
    const min = coverScale(image, frameSize);
    const scale = Math.min(min * MAX_ZOOM, Math.max(min, targetScale));
    const ratio = scale / state.scale;
    const center = frameSize / 2;
    return clampState({
        scale,
        x: center - (center - state.x) * ratio,
        y: center - (center - state.y) * ratio,
    }, image, frameSize);
};

/**
 * Slider position (0..1) <-> scale. Exponential, so a slider step feels the
 * same at either end instead of crawling near the minimum.
 */
export const sliderToScale = (t, minScale) => minScale * Math.pow(MAX_ZOOM, clamp01(t));
export const scaleToSlider = (scale, minScale) =>
    clamp01(Math.log(scale / minScale) / Math.log(MAX_ZOOM));

/** The square of the source image, in its own pixels, that the frame shows. */
export const sourceRect = (state, frameSize) => ({
    x: -state.x / state.scale,
    y: -state.y / state.scale,
    size: frameSize / state.scale,
});

/** The same crop expressed for a frame that changed size (e.g. rotation). */
export const rescaleState = (state, fromFrame, toFrame) => {
    const k = toFrame / fromFrame;
    return { scale: state.scale * k, x: state.x * k, y: state.y * k };
};

export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * One step of a two-finger gesture: follow the fingers' midpoint, then zoom
 * by how much they spread. Zooming is about the frame center (see zoomTo),
 * which keeps the gesture predictable inside a small circular crop.
 * @param {Point} prevA
 * @param {Point} prevB
 * @param {Point} nextA
 * @param {Point} nextB
 * @returns {CropState}
 */
export const applyPinch = (state, prevA, prevB, nextA, nextB, image, frameSize) => {
    const prevMid = midpoint(prevA, prevB);
    const nextMid = midpoint(nextA, nextB);
    const panned = panBy(state, nextMid.x - prevMid.x, nextMid.y - prevMid.y, image, frameSize);
    const prevDistance = distance(prevA, prevB);
    if ( prevDistance === 0 ) return panned;
    return zoomTo(panned, panned.scale * (distance(nextA, nextB) / prevDistance), image, frameSize);
};
