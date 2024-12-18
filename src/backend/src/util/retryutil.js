/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
 * Retries a function a maximum number of times, with a given interval between each try.
 * @param {Function} func - The function to retry
 * @param {Number} max_tries - The maximum number of tries
 * @param {Number} interval - The interval between each try
 * @returns {Promise<[Error, Boolean, any]>} - A promise that resolves to an
 * array containing the last error, a boolean indicating whether the function
 * eventually succeeded, and the return value of the function
 */
const simple_retry = async function simple_retry (func, max_tries, interval) {
    let tries = 0;
    let last_error = null;

    if ( max_tries === undefined ) {
        throw new Error('simple_retry: max_tries is undefined');
    }
    if ( interval === undefined ) {
        throw new Error('simple_retry: interval is undefined');
    }

    while ( tries < max_tries ) {
        try {
            return [last_error, true, await func()];
        } catch ( error ) {
            last_error = error;
            tries++;
            await new Promise((resolve) => setTimeout(resolve, interval));
        }
    }
    if ( last_error === null ) {
        last_error = new Error('simple_retry: failed, but error is null');
    }
    return [last_error, false];
};

const poll = async function poll({ poll_fn, schedule_fn }) {
    let delay;

    while ( true ) {
        const is_done = await poll_fn();
        if ( is_done ) {
            return;
        }
        delay = schedule_fn(delay);
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
}

module.exports = {
    simple_retry,
    poll,
};
