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
import {
    SDK_TIMEOUT_MS,
    sdkClientOptions,
    withSdkTimeout,
} from './sdkClient.js';

describe('sdkClientOptions', () => {
    it('turns SDK retries off and keeps the ten-minute timeout by default', () => {
        expect(sdkClientOptions()).toEqual({
            maxRetries: 0,
            timeout: SDK_TIMEOUT_MS,
        });
        expect(SDK_TIMEOUT_MS).toBe(10 * 60 * 1000);
    });

    it('takes a per-provider timeout', () => {
        expect(sdkClientOptions(60_000)).toEqual({
            maxRetries: 0,
            timeout: 60_000,
        });
    });
});

describe('withSdkTimeout', () => {
    it('aborts once the timeout passes', async () => {
        const signal = withSdkTimeout(undefined, 5);
        await new Promise((r) => setTimeout(r, 20));
        expect(signal.aborted).toBe(true);
    });

    it("follows the caller's own signal", () => {
        const controller = new AbortController();
        const signal = withSdkTimeout(controller.signal);
        expect(signal.aborted).toBe(false);
        controller.abort();
        expect(signal.aborted).toBe(true);
    });
});
