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
import { EventService } from '../../services/EventService.js';
import { redisClient } from './redisSingleton.js';

type DeleteRedisKeysInput = string | number | null | undefined | DeleteRedisKeysInput[];
interface DeleteRedisKeysOptions {
    emitEvent?: boolean,
    eventService?: EventService,
}

const isDeleteOptions = (value: unknown): value is DeleteRedisKeysOptions => {
    return !!value
        && typeof value === 'object'
        && !Array.isArray(value)
        && (
            Object.prototype.hasOwnProperty.call(value, 'emitEvent') ||
            Object.prototype.hasOwnProperty.call(value, 'eventService')
        );
};

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

export const deleteRedisKeys = async (...inputs: (DeleteRedisKeysInput | DeleteRedisKeysOptions)[]) => {
    const keysInput = [...inputs];
    if ( isDeleteOptions(keysInput[keysInput.length - 1]) ) {
        keysInput.pop() as DeleteRedisKeysOptions;
    }

    const keys = flattenInputs(keysInput as DeleteRedisKeysInput[])
        .map(key => key === null || key === undefined ? '' : String(key))
        .filter(Boolean);

    if ( keys.length === 0 ) {
        return 0;
    }

    const uniqueKeys = [...new Set(keys)];

    let deleted = 0;
    for ( const key of uniqueKeys ) {
        deleted += await redisClient.del(key);
    }

    return deleted;
};
