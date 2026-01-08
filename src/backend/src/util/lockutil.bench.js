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
import { RWLock } from './lockutil.js';

describe('RWLock - Creation', () => {
    bench('create RWLock', () => {
        new RWLock();
    });

    bench('create 100 RWLocks', () => {
        for ( let i = 0; i < 100; i++ ) {
            new RWLock();
        }
    });
});

describe('RWLock - Mode checking', () => {
    const lock = new RWLock();

    bench('check effective_mode (idle)', () => {
        void lock.effective_mode;
    });
});

describe('RWLock - Read locks (no contention)', () => {
    bench('single rlock/unlock cycle', async () => {
        const lock = new RWLock();
        const handle = await lock.rlock();
        handle.unlock();
    });

    bench('10 sequential rlock/unlock cycles', async () => {
        const lock = new RWLock();
        for ( let i = 0; i < 10; i++ ) {
            const handle = await lock.rlock();
            handle.unlock();
        }
    });

    bench('concurrent read locks (5 readers)', async () => {
        const lock = new RWLock();
        const handles = await Promise.all([
            lock.rlock(),
            lock.rlock(),
            lock.rlock(),
            lock.rlock(),
            lock.rlock(),
        ]);
        for ( const handle of handles ) {
            handle.unlock();
        }
    });

    bench('concurrent read locks (10 readers)', async () => {
        const lock = new RWLock();
        const promises = [];
        for ( let i = 0; i < 10; i++ ) {
            promises.push(lock.rlock());
        }
        const handles = await Promise.all(promises);
        for ( const handle of handles ) {
            handle.unlock();
        }
    });
});

describe('RWLock - Write locks (no contention)', () => {
    bench('single wlock/unlock cycle', async () => {
        const lock = new RWLock();
        const handle = await lock.wlock();
        handle.unlock();
    });

    bench('10 sequential wlock/unlock cycles', async () => {
        const lock = new RWLock();
        for ( let i = 0; i < 10; i++ ) {
            const handle = await lock.wlock();
            handle.unlock();
        }
    });
});

describe('RWLock - Mixed read/write patterns', () => {
    bench('read then write then read', async () => {
        const lock = new RWLock();

        const r1 = await lock.rlock();
        r1.unlock();

        const w = await lock.wlock();
        w.unlock();

        const r2 = await lock.rlock();
        r2.unlock();
    });

    bench('write then multiple reads', async () => {
        const lock = new RWLock();

        const w = await lock.wlock();
        w.unlock();

        const handles = await Promise.all([
            lock.rlock(),
            lock.rlock(),
            lock.rlock(),
        ]);
        for ( const h of handles ) {
            h.unlock();
        }
    });

    bench('alternating read/write (10 cycles)', async () => {
        const lock = new RWLock();
        for ( let i = 0; i < 10; i++ ) {
            if ( i % 2 === 0 ) {
                const h = await lock.rlock();
                h.unlock();
            } else {
                const h = await lock.wlock();
                h.unlock();
            }
        }
    });
});

describe('RWLock - Contention patterns', () => {
    bench('readers waiting for writer', async () => {
        const lock = new RWLock();

        // Writer goes first
        const writePromise = (async () => {
            const h = await lock.wlock();
            // Simulate work
            h.unlock();
        })();

        // Readers queue up
        const readerPromises = [];
        for ( let i = 0; i < 5; i++ ) {
            readerPromises.push((async () => {
                const h = await lock.rlock();
                h.unlock();
            })());
        }

        await Promise.all([writePromise, ...readerPromises]);
    });

    bench('writer waiting for readers', async () => {
        const lock = new RWLock();

        // Readers go first
        const readerPromises = [];
        for ( let i = 0; i < 5; i++ ) {
            readerPromises.push((async () => {
                const h = await lock.rlock();
                h.unlock();
            })());
        }

        // Writer queues up
        const writePromise = (async () => {
            const h = await lock.wlock();
            h.unlock();
        })();

        await Promise.all([...readerPromises, writePromise]);
    });
});

describe('RWLock - Queue behavior', () => {
    bench('check_queue_ with empty queue', () => {
        const lock = new RWLock();
        lock.check_queue_();
    });
});

describe('RWLock - on_empty_ callback', () => {
    bench('set on_empty_ callback', () => {
        const lock = new RWLock();
        lock.on_empty_ = () => {
        };
    });

    bench('trigger on_empty_ via lock cycle', async () => {
        const lock = new RWLock();
        lock.on_empty_ = () => {
        };

        const h = await lock.rlock();
        h.unlock();
        // on_empty_ should be called
    });
});

describe('Real-world patterns', () => {
    bench('cache read pattern (10 concurrent readers)', async () => {
        const lock = new RWLock();
        const promises = [];

        for ( let i = 0; i < 10; i++ ) {
            promises.push((async () => {
                const h = await lock.rlock();
                // Simulate cache read
                h.unlock();
            })());
        }

        await Promise.all(promises);
    });

    bench('cache invalidation pattern', async () => {
        const lock = new RWLock();

        // Some readers first
        const readerPromises = [];
        for ( let i = 0; i < 3; i++ ) {
            readerPromises.push((async () => {
                const h = await lock.rlock();
                h.unlock();
            })());
        }

        // Invalidation (write)
        const invalidatePromise = (async () => {
            const h = await lock.wlock();
            // Simulate cache clear
            h.unlock();
        })();

        // New readers after invalidation
        for ( let i = 0; i < 3; i++ ) {
            readerPromises.push((async () => {
                const h = await lock.rlock();
                h.unlock();
            })());
        }

        await Promise.all([...readerPromises, invalidatePromise]);
    });

    bench('file access pattern (mostly reads, occasional write)', async () => {
        const lock = new RWLock();
        const operations = [];

        for ( let i = 0; i < 20; i++ ) {
            if ( i % 5 === 0 ) {
                // Write every 5th operation
                operations.push((async () => {
                    const h = await lock.wlock();
                    h.unlock();
                })());
            } else {
                // Read otherwise
                operations.push((async () => {
                    const h = await lock.rlock();
                    h.unlock();
                })());
            }
        }

        await Promise.all(operations);
    });
});
