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

import { bench, describe } from 'vitest';
import { CircularQueue } from './CircularQueue';

/**
 * Naive array-based implementation for comparison (no Map optimization).
 * This serves as a baseline to demonstrate the performance improvement
 * of the Map-optimized CircularQueue.
 */
class NaiveCircularQueue {
    constructor (size) {
        this.size = size;
        this.queue = [];
        this.index = 0;
    }

    push (item) {
        this.queue[this.index] = item;
        this.index = (this.index + 1) % this.size;
    }

    get (index) {
        return this.queue[(this.index + index) % this.size];
    }

    has (item) {
        return this.queue.includes(item);
    }

    maybe_consume (item) {
        const index = this.queue.indexOf(item);
        if ( index !== -1 ) {
            this.queue[index] = null;
            return true;
        }
        return false;
    }
}

// Generate test tokens
const generateToken = () => Math.random().toString(36).substring(2, 15);

describe('CircularQueue - push() operations', () => {
    bench('push() with size=50', () => {
        const queue = new CircularQueue(50);
        for ( let i = 0; i < 1000; i++ ) {
            queue.push(generateToken());
        }
    });

    bench('push() with size=500', () => {
        const queue = new CircularQueue(500);
        for ( let i = 0; i < 1000; i++ ) {
            queue.push(generateToken());
        }
    });

    bench('NaiveCircularQueue push() with size=50 (baseline)', () => {
        const queue = new NaiveCircularQueue(50);
        for ( let i = 0; i < 1000; i++ ) {
            queue.push(generateToken());
        }
    });
});

describe('CircularQueue - has() operations', () => {
    const setupQueue = (QueueClass, size) => {
        const queue = new QueueClass(size);
        const tokens = [];
        for ( let i = 0; i < size; i++ ) {
            const token = generateToken();
            tokens.push(token);
            queue.push(token);
        }
        return { queue, tokens };
    };

    bench('has() on existing items - CircularQueue', () => {
        const { queue, tokens } = setupQueue(CircularQueue, 100);
        for ( let i = 0; i < 1000; i++ ) {
            queue.has(tokens[i % tokens.length]);
        }
    });

    bench('has() on existing items - NaiveCircularQueue (baseline)', () => {
        const { queue, tokens } = setupQueue(NaiveCircularQueue, 100);
        for ( let i = 0; i < 1000; i++ ) {
            queue.has(tokens[i % tokens.length]);
        }
    });

    bench('has() on non-existing items - CircularQueue', () => {
        const { queue } = setupQueue(CircularQueue, 100);
        for ( let i = 0; i < 1000; i++ ) {
            queue.has(`nonexistent-token-${ i}`);
        }
    });

    bench('has() on non-existing items - NaiveCircularQueue (baseline)', () => {
        const { queue } = setupQueue(NaiveCircularQueue, 100);
        for ( let i = 0; i < 1000; i++ ) {
            queue.has(`nonexistent-token-${ i}`);
        }
    });
});

describe('CircularQueue - maybe_consume() operations', () => {
    bench('maybe_consume() on existing items', () => {
        const queue = new CircularQueue(100);
        const tokens = [];
        for ( let i = 0; i < 100; i++ ) {
            const token = generateToken();
            tokens.push(token);
            queue.push(token);
        }
        for ( const token of tokens ) {
            queue.maybe_consume(token);
        }
    });

    bench('maybe_consume() mixed existing/non-existing', () => {
        const queue = new CircularQueue(100);
        const tokens = [];
        for ( let i = 0; i < 100; i++ ) {
            const token = generateToken();
            tokens.push(token);
            queue.push(token);
        }
        for ( let i = 0; i < 200; i++ ) {
            if ( i % 2 === 0 && i / 2 < tokens.length ) {
                queue.maybe_consume(tokens[i / 2]);
            } else {
                queue.maybe_consume(`fake-token-${ i}`);
            }
        }
    });
});

describe('CircularQueue - real-world usage pattern', () => {
    bench('CSRF token lifecycle: generate, validate, consume', () => {
        const queue = new CircularQueue(50);
        const activeTokens = [];

        for ( let i = 0; i < 500; i++ ) {
            // Generate new token
            const token = generateToken();
            queue.push(token);
            activeTokens.push(token);

            // Occasionally validate tokens
            if ( i % 3 === 0 && activeTokens.length > 0 ) {
                const checkToken = activeTokens[Math.floor(Math.random() * activeTokens.length)];
                queue.has(checkToken);
            }

            // Occasionally consume tokens
            if ( i % 5 === 0 && activeTokens.length > 0 ) {
                const consumeToken = activeTokens.shift();
                queue.maybe_consume(consumeToken);
            }
        }
    });
});
