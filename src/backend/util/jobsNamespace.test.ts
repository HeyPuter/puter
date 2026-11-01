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

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../types.js';
import { resolveJobsNamespace } from './jobsNamespace.js';

const config = (partial: Partial<IConfig>): IConfig => partial as IConfig;

describe('resolveJobsNamespace', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('takes jobs.namespace first, then the domain, then "default"', () => {
        expect(
            resolveJobsNamespace(
                config({ jobs: { namespace: 'ns-1' }, domain: 'puter.test' }),
            ),
        ).toBe('ns-1');
        expect(resolveJobsNamespace(config({ domain: 'puter.test' }))).toBe(
            'puter.test',
        );
        expect(resolveJobsNamespace(config({}))).toBe('default');
    });

    it('falls back to "default" for a domain with a port, logging once', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const withPort = config({ domain: 'puter.localhost:4100' });
        expect(resolveJobsNamespace(withPort)).toBe('default');
        expect(resolveJobsNamespace(withPort)).toBe('default');
        expect(error).toHaveBeenCalledTimes(1);
        expect(String(error.mock.calls[0][0])).toContain(
            'puter.localhost:4100',
        );
    });

    it('falls back to "default" for an invalid jobs.namespace', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(
            resolveJobsNamespace(
                config({ jobs: { namespace: 'a:b' }, domain: 'puter.test' }),
            ),
        ).toBe('default');
        expect(resolveJobsNamespace(config({ jobs: { namespace: '' } }))).toBe(
            'default',
        );
        expect(
            resolveJobsNamespace(
                config({ jobs: { namespace: 'x'.repeat(129) } }),
            ),
        ).toBe('default');
        expect(error).toHaveBeenCalledTimes(3);
    });
});
