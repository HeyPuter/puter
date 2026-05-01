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

import type { FSEntryCreateInput } from './FSEntry.js';

export interface FSEntryRow {
    id: number;
    uuid: string;
    bucket: string | null;
    bucket_region: string | null;
    public_token: string | null;
    file_request_token: string | null;
    is_shortcut: number | boolean;
    shortcut_to: number | null;
    user_id: number;
    parent_id: number | null;
    parent_uid: string | null;
    associated_app_id: number | null;
    is_dir: number | boolean;
    layout: string | null;
    sort_by: 'name' | 'modified' | 'type' | 'size' | null;
    sort_order: 'asc' | 'desc' | null;
    is_public: number | boolean | null;
    thumbnail: string | null;
    immutable: number | boolean;
    name: string;
    metadata: string | null;
    modified: number;
    created: number | null;
    accessed: number | null;
    size: number | null;
    symlink_path: string | null;
    is_symlink: number | boolean;
    path: string;
    // Aggregated JSON produced by the subdomains subquery. SQLite returns a
    // JSON text string; MySQL/MariaDB drivers may parse it into an array.
    subdomains_agg?: string | unknown[] | null;
}

export interface NormalizedEntryWrite {
    index: number;
    input: FSEntryCreateInput;
    userId: number;
    targetPath: string;
    parentPath: string;
    fileName: string;
    metadataJson: string | null;
    bucket: string | null;
    bucketRegion: string | null;
    size: number;
    createPaths: boolean;
}

export interface ReadEntriesByPathsOptions {
    useTryHardRead?: boolean;
    skipCache?: boolean;
    /**
     * Opt-out of the user-namespace check applied by `getEntriesByPathsForUser`.
     * Default `false` — paths must live under `/<username>/...` for the supplied
     * userId, otherwise the entry is dropped from the result. Set `true` only
     * for FSService internals that legitimately resolve cross-namespace entries
     * (collision checks against paths in shared folders the writer has been
     * granted access to).
     */
    crossNamespace?: boolean;
}
