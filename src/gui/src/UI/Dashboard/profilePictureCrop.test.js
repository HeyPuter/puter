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

import { describe, it, expect } from 'vitest';
import {
    MAX_ZOOM,
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

const FRAME = 280;
const landscape = { width: 800, height: 400 };
const portrait = { width: 400, height: 800 };
const square = { width: 600, height: 600 };
const tiny = { width: 50, height: 40 };

// Every side of the frame must stay under the image.
const coversFrame = (state, image) => {
    expect(state.x).toBeLessThanOrEqual(0 + 1e-9);
    expect(state.y).toBeLessThanOrEqual(0 + 1e-9);
    expect(state.x + image.width * state.scale).toBeGreaterThanOrEqual(FRAME - 1e-9);
    expect(state.y + image.height * state.scale).toBeGreaterThanOrEqual(FRAME - 1e-9);
};

describe('coverScale', () => {
    it('fits the shorter side to the frame', () => {
        expect(coverScale(landscape, FRAME)).toBeCloseTo(FRAME / 400);
        expect(coverScale(portrait, FRAME)).toBeCloseTo(FRAME / 400);
        expect(coverScale(square, FRAME)).toBeCloseTo(FRAME / 600);
    });

    it('upscales an image smaller than the frame', () => {
        expect(coverScale(tiny, FRAME)).toBeCloseTo(FRAME / 40);
    });
});

describe('initialState', () => {
    it('centers a landscape image with the overhang split evenly', () => {
        const s = initialState(landscape, FRAME);
        expect(s.scale).toBeCloseTo(0.7);
        expect(s.y).toBeCloseTo(0);
        expect(s.x).toBeCloseTo((FRAME - 800 * 0.7) / 2);
        coversFrame(s, landscape);
    });

    it('centers a portrait image', () => {
        const s = initialState(portrait, FRAME);
        expect(s.x).toBeCloseTo(0);
        expect(s.y).toBeCloseTo((FRAME - 800 * 0.7) / 2);
        coversFrame(s, portrait);
    });

    it('fills the frame exactly with a square image', () => {
        const s = initialState(square, FRAME);
        expect(s.x).toBeCloseTo(0);
        expect(s.y).toBeCloseTo(0);
    });
});

describe('clampState / panBy', () => {
    it('lets the overhanging axis pan and pins the fitted one', () => {
        const start = initialState(landscape, FRAME);
        const moved = panBy(start, 30, 30, landscape, FRAME);
        expect(moved.x).toBeCloseTo(start.x + 30);
        expect(moved.y).toBeCloseTo(0);
        coversFrame(moved, landscape);
    });

    it('stops at the image edges', () => {
        const start = initialState(landscape, FRAME);
        const farRight = panBy(start, 10000, 0, landscape, FRAME);
        expect(farRight.x).toBeCloseTo(0);
        const farLeft = panBy(start, -10000, 0, landscape, FRAME);
        expect(farLeft.x).toBeCloseTo(FRAME - 800 * start.scale);
        coversFrame(farRight, landscape);
        coversFrame(farLeft, landscape);
    });

    it('repairs a state that no longer covers the frame', () => {
        const fixed = clampState({ scale: 0.7, x: 50, y: 20 }, landscape, FRAME);
        expect(fixed.x).toBe(0);
        expect(fixed.y).toBe(0);
    });
});

describe('zoomTo', () => {
    it('keeps the frame center on the same image point', () => {
        const start = initialState(landscape, FRAME);
        const before = sourceRect(start, FRAME);
        const beforeCenter = { x: before.x + before.size / 2, y: before.y + before.size / 2 };

        const zoomed = zoomTo(start, start.scale * 2, landscape, FRAME);
        const after = sourceRect(zoomed, FRAME);
        const afterCenter = { x: after.x + after.size / 2, y: after.y + after.size / 2 };

        expect(zoomed.scale).toBeCloseTo(start.scale * 2);
        expect(afterCenter.x).toBeCloseTo(beforeCenter.x);
        expect(afterCenter.y).toBeCloseTo(beforeCenter.y);
        coversFrame(zoomed, landscape);
    });

    it('never zooms out past cover-fit', () => {
        const start = initialState(square, FRAME);
        const out = zoomTo(start, start.scale / 10, square, FRAME);
        expect(out.scale).toBeCloseTo(coverScale(square, FRAME));
        coversFrame(out, square);
    });

    it('caps zoom-in at MAX_ZOOM times cover-fit', () => {
        const start = initialState(square, FRAME);
        const inn = zoomTo(start, start.scale * 100, square, FRAME);
        expect(inn.scale).toBeCloseTo(coverScale(square, FRAME) * MAX_ZOOM);
        coversFrame(inn, square);
    });

    it('re-clamps after zooming out from a panned corner', () => {
        const start = initialState(landscape, FRAME);
        const zoomedIn = zoomTo(start, start.scale * 3, landscape, FRAME);
        const cornered = panBy(zoomedIn, -10000, -10000, landscape, FRAME);
        const backOut = zoomTo(cornered, start.scale, landscape, FRAME);
        coversFrame(backOut, landscape);
        expect(backOut.y).toBeCloseTo(0);
    });
});

describe('slider mapping', () => {
    const min = 0.7;

    it('maps the ends of the slider to the zoom bounds', () => {
        expect(sliderToScale(0, min)).toBeCloseTo(min);
        expect(sliderToScale(1, min)).toBeCloseTo(min * MAX_ZOOM);
        expect(scaleToSlider(min, min)).toBeCloseTo(0);
        expect(scaleToSlider(min * MAX_ZOOM, min)).toBeCloseTo(1);
    });

    it('round-trips', () => {
        for ( const t of [0, 0.1, 0.25, 0.5, 0.8, 1] ) {
            expect(scaleToSlider(sliderToScale(t, min), min)).toBeCloseTo(t);
        }
    });

    it('clamps out-of-range input', () => {
        expect(sliderToScale(-1, min)).toBeCloseTo(min);
        expect(sliderToScale(2, min)).toBeCloseTo(min * MAX_ZOOM);
        expect(scaleToSlider(min / 2, min)).toBe(0);
        expect(scaleToSlider(min * 100, min)).toBe(1);
    });
});

describe('sourceRect', () => {
    it('describes the centered cover-fit crop of a landscape image', () => {
        const rect = sourceRect(initialState(landscape, FRAME), FRAME);
        expect(rect.size).toBeCloseTo(400);
        expect(rect.x).toBeCloseTo(200);
        expect(rect.y).toBeCloseTo(0);
    });

    it('shrinks the source square as the user zooms in', () => {
        const start = initialState(square, FRAME);
        const rect = sourceRect(zoomTo(start, start.scale * 2, square, FRAME), FRAME);
        expect(rect.size).toBeCloseTo(300);
        expect(rect.x).toBeCloseTo(150);
        expect(rect.y).toBeCloseTo(150);
    });

    it('stays inside the image for any covering state', () => {
        const start = initialState(landscape, FRAME);
        const state = panBy(zoomTo(start, start.scale * 1.5, landscape, FRAME), -60, 25, landscape, FRAME);
        const rect = sourceRect(state, FRAME);
        expect(rect.x).toBeGreaterThanOrEqual(-1e-9);
        expect(rect.y).toBeGreaterThanOrEqual(-1e-9);
        expect(rect.x + rect.size).toBeLessThanOrEqual(landscape.width + 1e-9);
        expect(rect.y + rect.size).toBeLessThanOrEqual(landscape.height + 1e-9);
    });
});

describe('rescaleState', () => {
    it('keeps the same crop when the frame changes size', () => {
        const start = initialState(landscape, FRAME);
        const state = panBy(zoomTo(start, start.scale * 2, landscape, FRAME), -40, 10, landscape, FRAME);
        const before = sourceRect(state, FRAME);
        const after = sourceRect(rescaleState(state, FRAME, 200), 200);
        expect(after.x).toBeCloseTo(before.x);
        expect(after.y).toBeCloseTo(before.y);
        expect(after.size).toBeCloseTo(before.size);
    });
});

describe('applyPinch', () => {
    it('spreading fingers zooms in', () => {
        const start = initialState(square, FRAME);
        const next = applyPinch(start, { x: 100, y: 140 }, { x: 180, y: 140 }, { x: 60, y: 140 }, { x: 220, y: 140 }, square, FRAME);
        expect(next.scale).toBeCloseTo(start.scale * 2);
        coversFrame(next, square);
    });

    it('moving both fingers together pans', () => {
        const start = zoomTo(initialState(square, FRAME), 1.5, square, FRAME);
        const next = applyPinch(start, { x: 100, y: 100 }, { x: 180, y: 100 }, { x: 120, y: 90 }, { x: 200, y: 90 }, square, FRAME);
        expect(next.scale).toBeCloseTo(start.scale);
        expect(next.x).toBeCloseTo(start.x + 20);
        expect(next.y).toBeCloseTo(start.y - 10);
    });

    it('ignores the zoom part when the fingers started on the same point', () => {
        const start = initialState(square, FRAME);
        const next = applyPinch(start, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 90, y: 100 }, { x: 130, y: 100 }, square, FRAME);
        expect(next.scale).toBeCloseTo(start.scale);
    });
});
