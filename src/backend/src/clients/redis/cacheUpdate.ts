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

import type { EventService } from '../../services/EventService.js';
import { Context } from '../../util/context.js';
import { redisClient } from './redisSingleton.js';

type CacheKeyInput = string | number | null | undefined | CacheKeyInput[];
interface CacheUpdateOptions {
    eventService?: EventService,
    emitEvent?: boolean,
}

const SERVICES_KEY = Symbol.for('puter.helpers.services');

const flattenCacheKeys = (inputs: CacheKeyInput[]): Array<string | number | null | undefined> => {
    const flattened: Array<string | number | null | undefined> = [];
    for ( const input of inputs ) {
        if ( Array.isArray(input) ) {
            flattened.push(...flattenCacheKeys(input));
            continue;
        }
        flattened.push(input);
    }
    return flattened;
};

export const normalizeCacheKeys = (cacheKey: CacheKeyInput | CacheKeyInput[]): string[] => {
    const arr = Array.isArray(cacheKey) ? cacheKey : [cacheKey];
    return [...new Set(flattenCacheKeys(arr)
        .map(key => key === null || key === undefined ? '' : String(key))
        .filter(Boolean))];
};

const getEventService = (eventService?: CacheUpdateOptions['eventService']) => {
    if ( eventService?.emit ) return eventService;

    const contextServices = Context.get('services', { allow_fallback: true });
    if ( contextServices?.get ) {
        try {
            return contextServices.get('event');
        } catch (e) {
            // no-op
        }
    }

    const globalServices = (globalThis)[SERVICES_KEY]?.services as typeof contextServices;
    if ( globalServices?.get ) {
        try {
            return globalServices.get('event');
        } catch (e) {
            // no-op
        }
    }

    return null;
};

export const emitOuterCacheUpdate = (
    {
        cacheKey,
        data,
        ttlSeconds,
    }: {
        cacheKey: CacheKeyInput | CacheKeyInput[],
        data?: unknown,
        ttlSeconds?: number,
    },
    {
        eventService,
        emitEvent = true,
    }: CacheUpdateOptions = {},
) => {
    if ( ! emitEvent ) return;
    const keys = normalizeCacheKeys(cacheKey);
    if ( ! keys.length ) return;

    const svc_event = getEventService(eventService);
    if ( ! svc_event ) return;

    const payload: Record<string, unknown> = { cacheKey: keys };
    if ( data !== undefined ) payload.data = data;
    if ( ttlSeconds !== undefined && ttlSeconds !== null ) {
        payload.ttlSeconds = ttlSeconds;
    }

    svc_event.emit('outer.cacheUpdate', payload);
};

export const setRedisCacheValue = async (
    key: string,
    value: string | number,
    {
        ttlSeconds,
        eventData,
        eventService,
        emitEvent = true,
    }: {
        ttlSeconds?: number,
        eventData?: unknown,
        eventService?: CacheUpdateOptions['eventService'],
        emitEvent?: boolean,
    } = {},
) => {
    if ( ttlSeconds ) {
        await redisClient.set(key, value, 'EX', ttlSeconds);
    } else {
        await redisClient.set(key, value);
    }

    emitOuterCacheUpdate({
        cacheKey: [key],
        data: eventData === undefined ? value : eventData,
        ttlSeconds,
    }, {
        eventService,
        emitEvent,
    });
};
