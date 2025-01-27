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
export class CompositeCommandProvider {
    constructor (providers) {
        this.providers = providers;
    }

    async lookup (...a) {
        for (const provider of this.providers) {
            const command = await provider.lookup(...a);
            if (command) {
                return command;
            }
        }
    }

    async lookupAll (...a) {
        const results = [];
        for (const provider of this.providers) {
            const commands = await provider.lookupAll(...a);
            if ( commands ) {
                results.push(...commands);
            }
        }

        if ( results.length === 0 ) return undefined;
        return results;
    }

    async complete (...a) {
        const query = a[0];
        if (query === '') return [];

        const results = [];
        for (const provider of this.providers) {
            results.push(...await provider.complete(...a));
        }
        return results;
    }
}
