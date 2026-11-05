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
    type ProviderCatalog,
    ProviderRegistry,
    readProviderKey,
} from './providerRegistry.js';

const CATALOG: ProviderCatalog = {
    label: 'Test',
    ids: ['alpha', 'beta', 'gamma'],
    defaultId: 'alpha',
    aliases: { alpha: 'alpha', a: 'alpha', beta: 'beta', gamma: 'gamma' },
};

const registry = (...ids: string[]) => {
    const r = new ProviderRegistry<string>(CATALOG);
    for (const id of ids) r.register(id, `${id}-instance`);
    return r;
};

describe('ProviderRegistry.resolve', () => {
    it('resolves an explicitly named provider through its aliases', () => {
        expect(registry('alpha').resolve(' A ')).toBe('alpha');
    });

    it('rejects an unknown name with a 400 listing the canonical ids', () => {
        expect(() => registry('alpha').resolve('nope')).toThrow(
            expect.objectContaining({
                statusCode: 400,
                legacyCode: 'bad_request',
                message:
                    'Test provider not found: nope. Available: alpha, beta, gamma',
            }),
        );
        expect(() => registry('alpha').resolve(5)).toThrow(
            expect.objectContaining({ statusCode: 400 }),
        );
    });

    it('falls back to the first hint that names a provider, then the default', () => {
        const r = registry('alpha', 'beta');
        expect(r.resolve(undefined, 'not-a-provider', 'beta')).toBe('beta');
        expect(r.resolve('', undefined)).toBe('alpha');
    });

    it('defaults to the documented id, else the first configured in catalog order', () => {
        expect(registry('gamma', 'alpha').defaultId()).toBe('alpha');
        expect(registry('gamma', 'beta').defaultId()).toBe('beta');
        expect(registry().defaultId()).toBe('alpha');
    });

    it('does not treat Object.prototype names as aliases', () => {
        expect(registry().normalize('constructor')).toBeUndefined();
    });
});

describe('ProviderRegistry.collect', () => {
    it('lists every provider at once and keeps registration order', async () => {
        const r = registry('beta', 'alpha');
        const started: string[] = [];
        const release: Array<() => void> = [];
        const pending = r.collect(
            (instance, id) =>
                new Promise<string[]>((resolve) => {
                    started.push(id);
                    release.push(() => resolve([instance]));
                }),
        );
        // Both lists are in flight before either answers.
        expect(started).toEqual(['beta', 'alpha']);
        release.reverse().forEach((fn) => fn());
        expect(await pending).toEqual(['beta-instance', 'alpha-instance']);
    });

    it("recognises 'all' in any case", () => {
        expect(ProviderRegistry.isAll(' ALL ')).toBe(true);
        expect(ProviderRegistry.isAll('alpha')).toBe(false);
        expect(ProviderRegistry.isAll(undefined)).toBe(false);
    });
});

describe('readProviderKey', () => {
    it('reads apiKey, secret_key, api_key and key, in that order', () => {
        expect(readProviderKey({ apiKey: 'a', secret_key: 'b' })).toBe('a');
        expect(readProviderKey({ secret_key: 'b', api_key: 'c' })).toBe('b');
        expect(readProviderKey({ api_key: 'c', key: 'd' })).toBe('c');
        expect(readProviderKey({ key: 'd' })).toBe('d');
    });

    it('takes the first block that has a key, skipping empty values', () => {
        expect(
            readProviderKey(undefined, { apiKey: '' }, { secret_key: 'b' }),
        ).toBe('b');
        expect(readProviderKey({ apiKey: 7 }, undefined)).toBeUndefined();
    });
});
