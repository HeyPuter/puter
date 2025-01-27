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

// METADATA // {"ai-commented":{"service":"xai"}}
const insert = async (tbl, subject) => {
    const keys = Object.keys(subject);

    await write(
        'INSERT INTO `'+ tbl +'` ' +
        '(' + keys.map(key => key).join(', ') + ') ' +
        'VALUES (' + keys.map(() => '?').join(', ') + ')',
        keys.map(key => subject[key])
    );
}

await insert('apps', {
    uid: 'app-fbbdb72b-ad08-4cb4-86a1-de0f27cf2e1e',
    owner_user_id: 1,
    name: 'puter-linux',
    index_url: 'https://builtins.namespaces.puter.com/emulator',
    title: 'Puter Linux',
    description: 'Linux emulator for Puter',
    approved_for_listing: 1,
    approved_for_opening_items: 1,
    approved_for_incentive_program: 0,
    timestamp: '2020-01-01 00:00:00',
});
