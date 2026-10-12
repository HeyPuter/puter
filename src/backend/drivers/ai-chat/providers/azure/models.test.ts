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

/**
 * Azure deployments bill at the direct provider's list price, so an entry that
 * mirrors an OpenAI or xAI model must match it on every field but its
 * identity.
 */

import { describe, expect, it } from 'vitest';

import type { IChatModel } from '../../types.js';
import { OPEN_AI_MODELS } from '../openai/models.js';
import { XAI_MODELS } from '../xai/models.js';
import { AZURE_MODELS } from './models.js';

// Deployments of models the direct providers have retired: nothing to mirror.
const STANDALONE = [
    'azure:x-ai/grok-4-1-fast-non-reasoning',
    'azure:x-ai/grok-4-1-fast-reasoning',
    'azure:openai/gpt-5',
    'azure:openai/gpt-5-nano',
    'azure:openai/gpt-5-mini',
];

// Fields an Azure deployment genuinely differs from its source on, by puterId.
const OVERRIDES: Record<string, string[]> = {};

const IDENTITY = ['id', 'puterId', 'aliases'];

// `azure:openai/gpt-5.4` mirrors `openai:openai/gpt-5.4`.
const unprefixed = (puterId: string | undefined) =>
    puterId?.slice(puterId.indexOf(':') + 1);

const sourceOf = (azure: IChatModel): IChatModel | undefined =>
    [...OPEN_AI_MODELS, ...XAI_MODELS].find(
        (m) => unprefixed(m.puterId) === unprefixed(azure.puterId),
    );

const sharedFields = (model: IChatModel, skip: string[]) =>
    Object.fromEntries(
        Object.entries(model).filter(
            ([key]) => !IDENTITY.includes(key) && !skip.includes(key),
        ),
    );

const mirrored = AZURE_MODELS.filter(
    (m) => !STANDALONE.includes(m.puterId!),
).map((m) => [m.puterId!, m] as const);

describe('AZURE_MODELS mirroring', () => {
    it('has a direct-provider source for every entry not listed as standalone', () => {
        const orphans = mirrored
            .filter(([, m]) => !sourceOf(m))
            .map(([puterId]) => puterId);
        expect(orphans).toEqual([]);
        expect(mirrored.length).toBeGreaterThan(0);
    });

    it('lists no standalone entry that a direct provider still serves', () => {
        const stillServed = AZURE_MODELS.filter(
            (m) => STANDALONE.includes(m.puterId!) && sourceOf(m),
        ).map((m) => m.puterId);
        expect(stillServed).toEqual([]);
    });

    it.each(mirrored)(
        '%s prices and caps exactly like its source',
        (puterId, azure) => {
            const source = sourceOf(azure)!;
            const skip = OVERRIDES[puterId] ?? [];

            // The fields billing and the credit gate read, spelled out so a
            // failure names them.
            for (const field of [
                'costs',
                'long_context_pricing',
                'modalities',
                'context',
                'max_tokens',
            ]) {
                if (skip.includes(field)) continue;
                expect(azure[field], field).toEqual(source[field]);
            }
            expect(sharedFields(azure, skip)).toEqual(
                sharedFields(source, skip),
            );
        },
    );
});
