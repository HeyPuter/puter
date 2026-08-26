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
 * Cross-provider invariants for the hardcoded model catalogs.
 *
 * Providers resolve a requested model with `models().find((m) => [m.id,
 * ...m.aliases].includes(requested))` and build `list()` by flattening the same
 * ids and aliases. Both go wrong quietly when one identifier is claimed by two
 * entries: `.find()` returns whichever comes first, so the later entry is dead
 * config that no request can ever reach, and `list()` advertises the model
 * twice. Nothing throws, so the only symptom is wrong prices or wrong metadata
 * being served from the entry that happened to win.
 *
 * This is easy to introduce and hard to spot in review — two branches adding
 * the same model independently is enough, which is exactly how
 * `gemini-3.7-flash` ended up in GEMINI_MODELS twice with two different cache
 * prices. These tests are the cheap backstop for that class of mistake, so they
 * live here once rather than being copy-pasted into every provider suite.
 *
 * Two entries claiming one identifier is a genuine defect and the first test
 * below is the guard for it. The other two are hygiene: `modelLookupNames`
 * deduplicates, so a repeated or self-referential alias can no longer change
 * behaviour — it is just noise that reads as if it were load-bearing. Keeping
 * the catalogs free of it is what lets the next reader trust that an alias
 * exists because something needs it.
 *
 * Add new static catalogs to CATALOGS below — the last test in this file fails
 * if one is missing, since a catalog nobody registered is a catalog none of
 * this checks. (Its scan keys on filenames containing "model"; see the note
 * on that test.)
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { IChatModel } from '../types.js';
import { ALIBABA_MODELS } from './alibaba/models.js';
import { AZURE_MODELS } from './azure/models.js';
import { BYTEPLUS_MODELS } from './byteplus/models.js';
import { CLAUDE_MODELS } from './claude/models.js';
import { DEEPSEEK_MODELS } from './deepseek/models.js';
import { GEMINI_MODELS } from './gemini/models.js';
import { GROQ_MODELS } from './groq/models.js';
import { HOONIFY_MODELS } from './hoonify/models.js';
import { META_MODELS } from './meta/models.js';
import { MINIMAX_MODELS } from './minimax/models.js';
import { MISTRAL_MODELS } from './mistral/models.js';
import { MOONSHOT_MODELS } from './moonshot/models.js';
import { OPEN_AI_MODELS } from './openai/models.js';
import { OPEN_ROUTER_MODEL_OVERRIDES } from './openrouter/modelOverrides.js';
import { XAI_MODELS } from './xai/models.js';
import { ZAI_MODELS } from './zai/models.js';

// Providers whose catalog is fetched at runtime (OpenRouter, Ollama, Together,
// Infron, Neuralwatt) have nothing static to check and are absent by design;
// OpenRouter's hardcoded *overrides* list is still covered.
const CATALOGS: [name: string, models: readonly IChatModel[]][] = [
    ['ALIBABA_MODELS', ALIBABA_MODELS],
    ['AZURE_MODELS', AZURE_MODELS],
    ['BYTEPLUS_MODELS', BYTEPLUS_MODELS],
    ['CLAUDE_MODELS', CLAUDE_MODELS],
    ['DEEPSEEK_MODELS', DEEPSEEK_MODELS],
    ['GEMINI_MODELS', GEMINI_MODELS],
    ['GROQ_MODELS', GROQ_MODELS],
    ['HOONIFY_MODELS', HOONIFY_MODELS],
    ['META_MODELS', META_MODELS],
    ['MINIMAX_MODELS', MINIMAX_MODELS],
    ['MISTRAL_MODELS', MISTRAL_MODELS],
    ['MOONSHOT_MODELS', MOONSHOT_MODELS],
    ['OPEN_AI_MODELS', OPEN_AI_MODELS],
    ['OPEN_ROUTER_MODEL_OVERRIDES', OPEN_ROUTER_MODEL_OVERRIDES],
    ['XAI_MODELS', XAI_MODELS],
    ['ZAI_MODELS', ZAI_MODELS],
];

// A label for the entry an identifier came from, good enough to grep for in a
// failure message even when the duplicated field *is* the id.
const describeEntry = (m: IChatModel, index: number) =>
    `#${index} (${m.name ?? m.id ?? 'unnamed'})`;

describe.each(CATALOGS)('%s', (_name, models) => {
    it('is not empty', () => {
        // Guards the tests below from passing vacuously if an import breaks.
        expect(models.length).toBeGreaterThan(0);
    });

    it('never lets two entries claim the same id, puterId, or alias', () => {
        // Owner of each identifier seen so far, so a collision can name both
        // sides rather than just saying "duplicate found".
        const owners = new Map<string, string>();
        const collisions: string[] = [];

        models.forEach((m, index) => {
            const here = describeEntry(m, index);
            const claimed: [field: string, value: string | undefined][] = [
                ['id', m.id],
                ['puterId', m.puterId],
                ...(m.aliases ?? []).map(
                    (a) => ['alias', a] as [string, string],
                ),
            ];

            // Compare against *other* entries only. An entry repeating a
            // name against itself is caught by the two tests below, which
            // name the exact shape instead of saying "already claimed" —
            // except for an id equal to its own puterId, which no test covers
            // because it registers one key either way and so costs nothing.
            const seenHere = new Set<string>();
            for (const [field, value] of claimed) {
                if (value === undefined) continue;
                if (seenHere.has(value)) continue;
                seenHere.add(value);

                const owner = owners.get(value);
                if (owner !== undefined) {
                    collisions.push(
                        `'${value}' (${field}) is already claimed by entry ${owner}`,
                    );
                } else {
                    owners.set(value, here);
                }
            }
        });

        expect(collisions, collisions.join('\n')).toEqual([]);
    });

    it('never repeats an alias within a single entry', () => {
        // A string listed twice in one aliases array is always a slip: it
        // changes nothing about resolution and just doubles the model in
        // list().
        const repeats: string[] = [];

        models.forEach((m, index) => {
            const seen = new Set<string>();
            for (const alias of m.aliases ?? []) {
                if (seen.has(alias)) {
                    repeats.push(
                        `entry ${describeEntry(m, index)} lists '${alias}' more than once`,
                    );
                }
                seen.add(alias);
            }
        });

        expect(repeats, repeats.join('\n')).toEqual([]);
    });

    it('never re-declares its own id or puterId as an alias', () => {
        // Resolution matches m.id before it ever looks at the aliases, and
        // the driver appends puterId to an entry's lookup names on its own,
        // so either self-alias buys nothing. It reads as though the bare name
        // would stop working without it, which is the actual cost: every
        // later reader has to re-derive that it is inert.
        //
        // flatMap rather than filter().map(): the index has to be the entry's
        // position in the catalog, which a filtered array no longer knows.
        const selfDeclared = models.flatMap((m, index) => {
            const aliases = m.aliases ?? [];
            const fields = [
                ...(aliases.includes(m.id) ? ['id'] : []),
                ...(m.puterId && aliases.includes(m.puterId)
                    ? ['puterId']
                    : []),
            ];
            return fields.map(
                (field) =>
                    `${describeEntry(m, index)} aliases its own ${field}`,
            );
        });

        expect(selfDeclared, selfDeclared.join('\n')).toEqual([]);
    });
});

// -- Registration ----------------------------------------------------

describe('CATALOGS', () => {
    // Everything above is opt-in: a provider added tomorrow gets none of it
    // until someone remembers to list its catalog. That is the same kind of
    // silent gap these tests are about, so the list is checked against what
    // is actually on disk.
    //
    // The scan covers every non-test source file under providers/*/ with
    // "model" in its name — models.ts, but also siblings like openrouter's
    // modelOverrides.ts. Importing every provider file regardless of name
    // would drag in SDK modules for a filename sweep, so that naming
    // convention is the one assumption left unenforced here: a catalog in a
    // file named without "model" would escape this net.
    it('lists every static catalog under providers/', async () => {
        const here = dirname(fileURLToPath(import.meta.url));
        const registered = new Map(CATALOGS);
        const problems: string[] = [];

        for (const dir of readdirSync(here, { withFileTypes: true })) {
            if (!dir.isDirectory()) continue;

            for (const file of readdirSync(join(here, dir.name))) {
                if (!/model/i.test(file)) continue;
                if (!file.endsWith('.ts') || file.endsWith('.test.ts')) {
                    continue;
                }

                const module = await import(
                    pathToFileURL(join(here, dir.name, file)).href
                );
                for (const [name, value] of Object.entries(module)) {
                    // A catalog is a non-empty array of entries carrying an
                    // id; these files also export default-model ids and
                    // helpers.
                    const isCatalog =
                        Array.isArray(value) &&
                        value.length > 0 &&
                        typeof value[0]?.id === 'string';
                    if (!isCatalog) continue;

                    if (!registered.has(name)) {
                        problems.push(`${dir.name}/${file} exports ${name}`);
                    } else if (registered.get(name) !== value) {
                        // The row's label names this export but its value is
                        // a different array — the wrong catalog would be the
                        // one getting checked.
                        problems.push(
                            `the CATALOGS row named ${name} does not hold ` +
                                `the ${name} that ${dir.name}/${file} exports`,
                        );
                    }
                }
            }
        }

        expect(problems, problems.join('\n')).toEqual([]);
    });
});
