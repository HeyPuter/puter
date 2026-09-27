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

import { describe, expect, it } from 'vitest';
import { DeepSeekPricing } from './pricing.js';

describe.skipIf(!process.env.PUTER_TEST_AI_DEEPSEEK_PRICING)(
    'DeepSeek pricing page (integration)',
    () => {
        it('fetches and parses current official rates', async () => {
            const pricing = new DeepSeekPricing();
            await pricing.refresh();
            expect(pricing.costs('deepseek-flash').prompt).toBeGreaterThan(0);
            expect(pricing.costs('deepseek-v4-pro').cached).toBeGreaterThan(0);
        }, 15_000);
    },
);
