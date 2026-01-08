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
const { FileTracker } = require('./FileTracker');

// Helper to create a tracker with some access history
const createTrackerWithHistory = (accessCount) => {
    const tracker = new FileTracker({ key: 'test-key', size: 1024 });
    for ( let i = 0; i < accessCount; i++ ) {
        tracker.touch();
    }
    return tracker;
};

describe('FileTracker - Construction', () => {
    bench('create new FileTracker', () => {
        new FileTracker({ key: `test-key-${ Math.random()}`, size: 1024 });
    });

    bench('create multiple FileTrackers', () => {
        for ( let i = 0; i < 100; i++ ) {
            new FileTracker({ key: `key-${i}`, size: i * 100 });
        }
    });
});

describe('FileTracker - touch() operation', () => {
    bench('touch() on new tracker', () => {
        const tracker = new FileTracker({ key: 'test', size: 1024 });
        for ( let i = 0; i < 1000; i++ ) {
            tracker.touch();
        }
    });

    bench('touch() with EWMA calculation', () => {
        const tracker = new FileTracker({ key: 'test', size: 1024 });
        // Pre-warm with some touches
        for ( let i = 0; i < 10; i++ ) {
            tracker.touch();
        }
        // Benchmark steady-state touches
        for ( let i = 0; i < 1000; i++ ) {
            tracker.touch();
        }
    });
});

describe('FileTracker - score calculation', () => {
    bench('score on fresh tracker', () => {
        const tracker = new FileTracker({ key: 'test', size: 1024 });
        tracker.touch(); // Need at least one touch for meaningful score
        for ( let i = 0; i < 1000; i++ ) {
            void tracker.score;
        }
    });

    bench('score on tracker with history (10 accesses)', () => {
        const tracker = createTrackerWithHistory(10);
        for ( let i = 0; i < 1000; i++ ) {
            void tracker.score;
        }
    });

    bench('score on tracker with history (100 accesses)', () => {
        const tracker = createTrackerWithHistory(100);
        for ( let i = 0; i < 1000; i++ ) {
            void tracker.score;
        }
    });
});

describe('FileTracker - age calculation', () => {
    bench('age getter', () => {
        const tracker = new FileTracker({ key: 'test', size: 1024 });
        for ( let i = 0; i < 10000; i++ ) {
            void tracker.age;
        }
    });
});

describe('FileTracker - Cache eviction simulation', () => {
    bench('compare scores of multiple trackers', () => {
        // Simulate cache with 100 items
        const trackers = [];
        for ( let i = 0; i < 100; i++ ) {
            const tracker = new FileTracker({ key: `file-${i}`, size: i * 100 });
            // Simulate varying access patterns
            const accessCount = Math.floor(Math.random() * 20);
            for ( let j = 0; j < accessCount; j++ ) {
                tracker.touch();
            }
            trackers.push(tracker);
        }

        // Find lowest score (eviction candidate)
        for ( let i = 0; i < 100; i++ ) {
            let minScore = Infinity;
            let evictCandidate = null;
            for ( const tracker of trackers ) {
                const score = tracker.score;
                if ( score < minScore ) {
                    minScore = score;
                    evictCandidate = tracker;
                }
            }
        }
    });

    bench('sort trackers by score (eviction ordering)', () => {
        const trackers = [];
        for ( let i = 0; i < 50; i++ ) {
            const tracker = new FileTracker({ key: `file-${i}`, size: i * 100 });
            for ( let j = 0; j < i % 10; j++ ) {
                tracker.touch();
            }
            trackers.push(tracker);
        }

        // Sort by score
        for ( let i = 0; i < 10; i++ ) {
            [...trackers].sort((a, b) => a.score - b.score);
        }
    });
});

describe('FileTracker - Real-world access patterns', () => {
    bench('hot file pattern (frequent access)', () => {
        const tracker = new FileTracker({ key: 'hot-file', size: 1024 });
        for ( let i = 0; i < 1000; i++ ) {
            tracker.touch();
            if ( i % 10 === 0 ) {
                void tracker.score;
            }
        }
    });

    bench('cold file pattern (rare access)', () => {
        const tracker = new FileTracker({ key: 'cold-file', size: 1024 });
        tracker.touch();
        for ( let i = 0; i < 1000; i++ ) {
            void tracker.score;
            void tracker.age;
        }
    });

    bench('mixed access with score checks', () => {
        const trackers = [];
        for ( let i = 0; i < 20; i++ ) {
            trackers.push(new FileTracker({ key: `file-${i}`, size: 1024 }));
        }

        for ( let i = 0; i < 500; i++ ) {
            // Random access
            const idx = Math.floor(Math.random() * trackers.length);
            trackers[idx].touch();

            // Periodic eviction check
            if ( i % 50 === 0 ) {
                for ( const t of trackers ) {
                    void t.score;
                }
            }
        }
    });
});
