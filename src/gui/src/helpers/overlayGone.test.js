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

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { overlayGone } from './overlayGone.js';

const settled = async (promise) => {
    let done = false;
    promise.then(() => {
        done = true;
    });
    // Mutation observers report in a microtask.
    await new Promise((resolve) => setTimeout(resolve));
    return done;
};

afterEach(() => {
    document.body.innerHTML = '';
});

describe('overlayGone', () => {
    it('resolves at once when no overlay is on the page', async () => {
        expect(await settled(overlayGone(document, '.overlay'))).toBe(true);
    });

    it('waits until the overlay is removed', async () => {
        document.body.innerHTML = '<div class="overlay"></div><p></p>';
        const gone = overlayGone(document, '.overlay');
        expect(await settled(gone)).toBe(false);

        // Another element leaving isn't the overlay leaving.
        document.querySelector('p').remove();
        expect(await settled(gone)).toBe(false);

        document.querySelector('.overlay').remove();
        expect(await settled(gone)).toBe(true);
    });

    it('waits for every matching overlay', async () => {
        document.body.innerHTML = '<div class="overlay"></div><div class="overlay"></div>';
        const gone = overlayGone(document, '.overlay');
        document.querySelector('.overlay').remove();
        expect(await settled(gone)).toBe(false);
        document.querySelector('.overlay').remove();
        expect(await settled(gone)).toBe(true);
    });
});
