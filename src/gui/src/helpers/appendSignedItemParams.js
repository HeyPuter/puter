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
 * Append a signed file's `puter.item.*` params onto the launch iframe URL.
 *
 * @param {URLSearchParams} searchParams the iframe URL's search params
 * @param {object} file_signature the /sign or /open_item signature object
 * @param {string} itemPath the (privacy-aware) path to advertise to the app
 */
export const append_signed_item_params = (searchParams, file_signature, itemPath) => {
    searchParams.append('puter.item.uid', file_signature.uid);
    searchParams.append('puter.item.path', itemPath);
    searchParams.append('puter.item.name', file_signature.fsentry_name);
    searchParams.append('puter.item.read_url', file_signature.read_url);
    // Read-only shares carry no write_url; appending undefined stringifies it to "undefined", a truthy invalid URL that stops the editor opening the file.
    if ( file_signature.write_url ) {
        searchParams.append('puter.item.write_url', file_signature.write_url);
    }
    searchParams.append('puter.item.metadata_url', file_signature.metadata_url);
    searchParams.append('puter.item.size', file_signature.fsentry_size);
    searchParams.append('puter.item.accessed', file_signature.fsentry_accessed);
    searchParams.append('puter.item.modified', file_signature.fsentry_modified);
    searchParams.append('puter.item.created', file_signature.fsentry_created);
};
