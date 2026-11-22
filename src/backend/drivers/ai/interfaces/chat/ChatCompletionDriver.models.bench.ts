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

import { bench, describe } from 'vitest';
import { setupTestServer } from '../../../../testUtil.js';
import { ChatCompletionDriver } from './ChatCompletionDriver.js';

// The model routes are public and do no I/O, so what they cost is CPU.
// Only providers whose catalogs ship in the source: nothing is fetched.
const key = { apiKey: 'bench' };
const server = await setupTestServer();
const driver = new ChatCompletionDriver(
    {
        providers: {
            claude: key,
            'openai-completion': key,
            gemini: key,
            groq: key,
            deepseek: key,
            mistral: key,
            moonshot: key,
            minimax: key,
            zai: key,
            ollama: { enabled: false },
        },
    } as never,
    server.clients,
    server.stores,
    server.services,
);
driver.onServerStart();
await driver.models();

// One call is below the timer's resolution, so each sample makes many.
const CALLS = 100;

describe('chat model listing', () => {
    bench(`${CALLS} calls to models()`, async () => {
        for (let i = 0; i < CALLS; i++) await driver.models();
    });

    bench(`${CALLS} calls to list()`, async () => {
        for (let i = 0; i < CALLS; i++) await driver.list();
    });

    // What a details response still pays per request after the listing.
    bench('serialize models()', async () => {
        JSON.stringify(await driver.models());
    });
});
