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

// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
const { insertId: temp_group_id } = await write(
    'INSERT INTO `group` (`uid`, `owner_user_id`, `extra`, `metadata`) '+
    'VALUES (?, ?, ?, ?)',
    [
        'b7220104-7905-4985-b996-649fdcdb3c8f',
        1,
        '{"critical": true, "type": "default", "name": "temp"}',
        '{"title": "Guest", "color": "#777777"}'
    ]
);
