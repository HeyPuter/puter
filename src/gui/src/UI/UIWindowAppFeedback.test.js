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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

const { default: UIWindowAppFeedback } = await import('./UIWindowAppFeedback.js');

const flush = () => new Promise((r) => setTimeout(r, 0));
const $ = (sel) => jQuery(sel);
const visiblePanes = () => $('.app-feedback-pane').filter((_, el) => el.style.display !== 'none');

/** Opens the dialog against an app that accepts feedback and waits for the form. */
const open = async (options) => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
        enabled: true,
        app: { title: 'Build with AI', name: 'builder' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    UIWindowAppFeedback({ origin: 'https://builder.puter.test', source: 'web', ...options });
    await flush();
    await flush();
};

beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.$ = jQuery;
    globalThis.i18n = (key) => key;
    globalThis.html_encode = (value) => jQuery('<div>').text(value).html();
    window.api_origin = 'https://api.puter.test';
    window.auth_token = 'token';
});

afterEach(() => {
    $(document).off('keydown');
});

describe('UIWindowAppFeedback', () => {
    it('floats over the page by default', async () => {
        await open();
        expect($('.app-feedback-overlay').hasClass('app-feedback-fullpage')).toBe(false);
        expect(visiblePanes().hasClass('app-feedback-form')).toBe(true);
    });

    it('fills the page when hosted in its own popup', async () => {
        await open({ fullpage: true });
        expect($('.app-feedback-overlay').hasClass('app-feedback-fullpage')).toBe(true);
        expect(visiblePanes()).toHaveLength(1);
        expect(visiblePanes().hasClass('app-feedback-form')).toBe(true);
        expect($('.app-feedback-target-title').text()).toBe('Build with AI');
    });
});
