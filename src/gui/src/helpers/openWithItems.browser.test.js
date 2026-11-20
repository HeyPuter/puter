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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('./launchApp.js', () => ({ default: vi.fn() }));

globalThis.$ = globalThis.jQuery = jQuery;
globalThis.html_encode = (value) => jQuery('<div>').text(value).html();
globalThis.i18n = (key) => key;
const icon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>')}`;
window.icons = { 'app.svg': icon };

const { default: build_open_with_items } = await import('./openWithItems.js');

const cssDir = path.join(import.meta.dirname, '../css');
let browser;
let directory;

beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'puter-open-with-'));
    browser = await chromium.launch();
}, 60000);

afterAll(async () => {
    await browser?.close();
    if ( directory ) await rm(directory, { recursive: true, force: true });
});

// The row markup UIContextMenu builds for an item with an icon.
const menuRow = (item) => `<li class="context-menu-item">
    <span class="context-menu-item-icon">${item.icon}</span>
    <span class="context-menu-item-icon-active">${item.icon}</span>
    <span class="contextmenu-label">${item.html}</span>
    <span class="contextmenu-label-active">${item.html}</span>
</li>`;

describe('Open With menu layout', () => {
    it('centers each app icon on its label', async () => {
        const row = document.createElement('div');
        row.setAttribute('data-path', '/alice/plan.dwg');
        const items = build_open_with_items(row, [{ name: 'cad', title: 'CAD' }, { name: 'notepad', title: 'Notepad', icon }]);
        const stylesheets = ['normalize.css', 'style.css', 'dashboard.css']
            .map(name => `<link rel="stylesheet" href="file://${path.join(cssDir, name)}">`).join('');
        const file = path.join(directory, 'menu.html');
        await writeFile(file, `<!DOCTYPE html><html><head>${stylesheets}</head><body>
            <div class="context-menu" style="display:block"><ul>${items.filter(item => item.icon).map(menuRow).join('')}</ul></div>
        </body></html>`);

        const page = await browser.newPage();
        await page.goto(`file://${file}`);
        const rows = await page.$$eval('.context-menu-item', lis => lis.map(li => {
            const img = li.querySelector('.context-menu-item-icon img').getBoundingClientRect();
            const text = document.createRange();
            text.selectNodeContents(li.querySelector('.contextmenu-label'));
            const label = text.getBoundingClientRect();
            return { icon: img.top + img.height / 2, label: label.top + label.height / 2 };
        }));
        await page.close();

        expect(rows).toHaveLength(2);
        for ( const { icon, label } of rows ) {
            expect(Math.abs(icon - label)).toBeLessThanOrEqual(0.5);
        }
    });
});
