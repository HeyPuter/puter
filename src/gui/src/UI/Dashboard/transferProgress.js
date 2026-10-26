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

// Rate is measured over the last few seconds only, so a transfer that speeds
// up or slows down is reflected without the start of it skewing the estimate.
const RATE_WINDOW_MS = 5000;
// An estimate from the first second or two swings wildly; show none until then.
const SETTLE_MS = 2000;
const SMOOTHING = 0.3;

/**
 * Clamps a caller's progress to a percentage. Callers pass numbers and
 * strings alike, some from `toPrecision()` (`"1.0e+2"` for 100).
 *
 * @param {number|string} percent
 * @returns {number} 0 to 100
 */
export function clampPercent (percent) {
    const pct = Number(percent);
    if ( ! Number.isFinite(pct) ) return 0;
    return Math.min(100, Math.max(0, pct));
}

/**
 * Estimates the time left in a transfer from the progress reported so far.
 *
 * @param {() => number} [now] Clock in milliseconds.
 * @returns {{ push: (percent: number) => number | null }} `push` records a
 *   progress sample and returns the smoothed seconds left, or null while
 *   there isn't enough to go on (just started, stalled, or finished).
 */
export function createRemainingEstimator (now = () => Date.now()) {
    /** @type {Array<{ t: number, percent: number }>} */
    const samples = [];
    let first_at = null;
    let smoothed = null;

    return {
        push (percent) {
            const t = now();
            first_at ??= t;
            samples.push({ t, percent });
            while ( samples.length > 2 && t - samples[0].t > RATE_WINDOW_MS ) samples.shift();

            if ( percent >= 100 || t - first_at < SETTLE_MS ) return null;
            const oldest = samples[0];
            const rate = (percent - oldest.percent) / (t - oldest.t);
            if ( ! (rate > 0) ) return null;

            const seconds = (100 - percent) / rate / 1000;
            smoothed = smoothed === null ? seconds : smoothed + SMOOTHING * (seconds - smoothed);
            return smoothed;
        },
    };
}

/**
 * Rounds seconds left to what a person would say: a few seconds, then
 * steps of 5 seconds, whole minutes, and whole hours, always rounding up
 * below an hour so the estimate runs out rather than overshoots.
 *
 * @param {number} seconds
 * @returns {{ value: number, unit: 'second'|'minute'|'hour' } | null} null for "a few seconds"
 */
export function roundSecondsLeft (seconds) {
    if ( seconds < 10 ) return null;
    if ( seconds < 60 ) return { value: Math.min(55, Math.ceil(seconds / 5) * 5), unit: 'second' };
    if ( seconds < 3600 ) return { value: Math.min(59, Math.ceil(seconds / 60)), unit: 'minute' };
    return { value: Math.max(1, Math.round(seconds / 3600)), unit: 'hour' };
}

/**
 * How many top-level items an upload carries, and the first one's name.
 * A drop's DataTransferItemList empties once its event returns, so call
 * this while the event is still dispatching.
 *
 * @param {FileList|File[]|DataTransferItemList} items
 * @returns {{ count: number, name: string }}
 */
export function summarizeUpload (items) {
    // A drop can carry text alongside files; only the files get uploaded.
    const files = Array.from(items ?? []).filter((item) => item && (item.kind === undefined || item.kind === 'file'));
    const first = files[0];
    const name = first?.name
        ?? first?.webkitGetAsEntry?.()?.name
        ?? first?.getAsFile?.()?.name
        ?? '';
    return { count: files.length, name };
}
