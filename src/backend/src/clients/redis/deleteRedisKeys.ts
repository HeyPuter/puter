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
import { redisClient } from './redisSingleton.js';

type DeleteRedisKeysInput = string | number | null | undefined | DeleteRedisKeysInput[];

const flattenInputs = (inputs: DeleteRedisKeysInput[]): Array<string | number | null | undefined> => {
    const flattened: Array<string | number | null | undefined> = [];

    for ( const input of inputs ) {
        if ( Array.isArray(input) ) {
            flattened.push(...flattenInputs(input));
            continue;
        }
        flattened.push(input);
    }

    return flattened;
};

export const deleteRedisKeys = async (...keysInput: DeleteRedisKeysInput[]) => {
    const keys = flattenInputs(keysInput)
        .map(key => key === null || key === undefined ? '' : String(key))
        .filter(Boolean);

    if ( keys.length === 0 ) {
        return 0;
    }

    let deleted = 0;
    for ( const key of new Set(keys) ) {
        deleted += await redisClient.del(key);
    }
    return deleted;
};
