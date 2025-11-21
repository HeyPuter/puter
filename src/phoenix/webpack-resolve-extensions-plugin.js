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
import fs from 'node:fs';
import path from 'node:path';

class ResolveExtensionsPlugin {
    apply (compiler) {
        compiler.hooks.normalModuleFactory.tap('ResolveExtensionsPlugin', (nmf) => {
            nmf.hooks.beforeResolve.tap('ResolveExtensionsPlugin', (data) => {
                if ( ! data ) return;

                // Skip if already has an extension
                if ( data.request.match(/\.(js|mjs|json|ts|tsx|css|html)$/) ) {
                    return;
                }

                const context = data.context || compiler.options.context || process.cwd();
                let requestPath;

                // Handle relative imports (starting with ./ or ../)
                if ( data.request.startsWith('.') ) {
                    requestPath = path.resolve(context, data.request);
                }
                // Handle package subpath imports (like @heyputer/putility/src/libs/promise)
                // Only add .js if there's a subpath (more than just the package name)
                else if ( data.request.includes('/') && !data.request.startsWith('/') && !data.request.startsWith('.') ) {
                    const parts = data.request.split('/');
                    // If there are more than 2 parts (e.g., @scope/pkg/path/to/file), it's a subpath
                    // Scoped packages like @heyputer/putility have 2 parts for the name
                    if ( data.request.startsWith('@') ) {
                        // Scoped package: @scope/pkg/path -> needs 3+ parts for subpath
                        if ( parts.length > 2 ) {
                            data.request = `${data.request }.js`;
                            return;
                        }
                    } else {
                        // Non-scoped package: pkg/path -> needs 2+ parts for subpath
                        if ( parts.length > 1 ) {
                            data.request = `${data.request }.js`;
                            return;
                        }
                    }
                    return; // Top-level package import, don't modify
                } else {
                    return; // Not a relative or package subpath import
                }

                // Check if .js file exists (for relative imports)
                const jsPath = `${requestPath }.js`;
                if ( fs.existsSync(jsPath) ) {
                    data.request = `${data.request }.js`;
                    return;
                }

                // Check if it's a directory with index.js
                if ( fs.existsSync(requestPath) && fs.statSync(requestPath).isDirectory() ) {
                    const indexPath = path.join(requestPath, 'index.js');
                    if ( fs.existsSync(indexPath) ) {
                        data.request = `${data.request }/index.js`;
                    }
                }
            });
        });
    }
}

export default ResolveExtensionsPlugin;
