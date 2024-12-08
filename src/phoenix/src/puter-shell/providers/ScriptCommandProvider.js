/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
import { Pipeline } from "../../ansi-shell/pipeline/Pipeline.js";
import { resolveRelativePath } from '../../util/path.js';

export class ScriptCommandProvider {
    async lookup (id, { ctx }) {
        const { filesystem } = ctx.platform;

        const is_path = id.match(/^[./]/);
        if ( ! is_path ) return undefined;

        const absPath = resolveRelativePath(ctx.vars, id);
        try {
            await filesystem.stat(absPath);
            // TODO: More rigorous check that it's an executable text file
        } catch (e) {
            return undefined;
        }

        return {
            path: id,
            async execute (ctx) {
                const script_blob = await filesystem.read(absPath);
                const script_text = await script_blob.text();

                console.log('result though?', script_text);

                // note: it's still called `parseLineForProcessing` but
                // it has since been extended to parse the entire file
                const ast = ctx.externs.parser.parseScript(script_text);
                const statements = ast[0].statements;

                for (const stmt of statements) {
                    const pipeline = await Pipeline.createFromAST(ctx, stmt);
                    await pipeline.execute(ctx);
                }
            }
        };
    }

    // Only a single script can match a given path
    async lookupAll (...a) {
        const result = await this.lookup(...a);
        if ( result ) {
            return [ result ];
        }
        return undefined;
    }

    async complete (query, { ctx }) {
        // TODO: Implement this
        return [];
    }
}