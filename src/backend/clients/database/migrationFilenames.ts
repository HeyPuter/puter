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

/**
 * Comparator for migration filenames named `<engine>_mig_<N>.sql`.
 *
 * Existing MySQL files use unpadded integers, so lexical sorting places
 * `*_mig_10.sql` before `*_mig_2.sql`. Pull the trailing integer out and sort
 * numerically. Anything that does not match the `_<digits>.sql` shape falls
 * back to lexical comparison and sorts after numbered files.
 */
export const compareMigrationFilenames = (a: string, b: string): number => {
    const numericIndex = (name: string): number => {
        const m = /_(\d+)\.sql$/.exec(name);
        return m ? Number.parseInt(m[1], 10) : Number.NaN;
    };
    const na = numericIndex(a);
    const nb = numericIndex(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
        if (na !== nb) return na - nb;
    } else if (Number.isFinite(na)) {
        return -1;
    } else if (Number.isFinite(nb)) {
        return 1;
    }
    return a.localeCompare(b);
};
