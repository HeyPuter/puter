/**
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
import { preparePostgresSql } from './preparePostgresSql.js';

describe('preparePostgresSql', () => {
    it('converts placeholders and backtick identifiers outside SQL literals', () => {
        const prepared = preparePostgresSql(
            'SELECT `user`.`id` FROM `user` WHERE `email` = ? AND `username` = ?',
        );

        expect(prepared).toEqual({
            text: 'SELECT "user"."id" FROM "user" WHERE "email" = $1 AND "username" = $2',
            parameterCount: 2,
        });
    });

    it('leaves question marks inside strings and comments untouched', () => {
        const prepared = preparePostgresSql(`
            SELECT '?' AS literal, ?
            -- ? in a comment
            FROM \`apps\`
            WHERE \`description\` = 'is this ok?'
            /* and ? in a block comment */
              AND \`name\` = ?
        `);

        expect(prepared.text).toContain("SELECT '?' AS literal, $1");
        expect(prepared.text).toContain('-- ? in a comment');
        expect(prepared.text).toContain('"description" = \'is this ok?\'');
        expect(prepared.text).toContain('/* and ? in a block comment */');
        expect(prepared.text).toContain('"name" = $2');
        expect(prepared.parameterCount).toBe(2);
    });

    it('escapes double quotes inside converted identifiers', () => {
        const prepared = preparePostgresSql(
            'SELECT `odd"name` FROM `odd``table` WHERE `id` = ?',
        );

        expect(prepared).toEqual({
            text: 'SELECT "odd""name" FROM "odd`table" WHERE "id" = $1',
            parameterCount: 1,
        });
    });

    it('does not scan placeholders inside dollar-quoted strings', () => {
        const prepared = preparePostgresSql(
            "SELECT $$?$$, $tag$`not_ident` ?$tag$, `id` FROM `user` WHERE `id` = ?",
        );

        expect(prepared).toEqual({
            text: 'SELECT $$?$$, $tag$`not_ident` ?$tag$, "id" FROM "user" WHERE "id" = $1',
            parameterCount: 1,
        });
    });

    it('does not treat Postgres JSON operators as comments', () => {
        const prepared = preparePostgresSql(
            "SELECT * FROM `sessions` WHERE `user_id` = ? AND `meta` #>> ARRAY['worker_name'] = ? AND `expires_at` > ?",
        );

        expect(prepared).toEqual({
            text: 'SELECT * FROM "sessions" WHERE "user_id" = $1 AND "meta" #>> ARRAY[\'worker_name\'] = $2 AND "expires_at" > $3',
            parameterCount: 3,
        });
    });
});
