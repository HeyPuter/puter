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
import { generate_identifier, generate_random_code } from './identifier.js';

describe('generate_identifier - Basic generation', () => {
    bench('generate single identifier (default separator)', () => {
        generate_identifier();
    });

    bench('generate identifier with hyphen separator', () => {
        generate_identifier('-');
    });

    bench('generate identifier with empty separator', () => {
        generate_identifier('');
    });

    bench('generate 100 identifiers', () => {
        for ( let i = 0; i < 100; i++ ) {
            generate_identifier();
        }
    });

    bench('generate 1000 identifiers', () => {
        for ( let i = 0; i < 1000; i++ ) {
            generate_identifier();
        }
    });
});

describe('generate_identifier - With custom RNG', () => {
    // Seeded pseudo-random for reproducibility
    const seededRng = () => {
        let seed = 12345;
        return () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed / 0x7fffffff;
        };
    };

    bench('generate with Math.random (default)', () => {
        generate_identifier('_', Math.random);
    });

    bench('generate with seeded RNG', () => {
        const rng = seededRng();
        generate_identifier('_', rng);
    });
});

describe('generate_random_code - Various lengths', () => {
    bench('generate 4-char code', () => {
        generate_random_code(4);
    });

    bench('generate 8-char code', () => {
        generate_random_code(8);
    });

    bench('generate 16-char code', () => {
        generate_random_code(16);
    });

    bench('generate 32-char code', () => {
        generate_random_code(32);
    });

    bench('generate 64-char code', () => {
        generate_random_code(64);
    });
});

describe('generate_random_code - Custom character sets', () => {
    const numericOnly = '0123456789';
    const hexChars = '0123456789ABCDEF';
    const alphaLower = 'abcdefghijklmnopqrstuvwxyz';
    const fullAlphanumeric = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    bench('numeric only (10 chars)', () => {
        generate_random_code(10, { chars: numericOnly });
    });

    bench('hex chars (16 chars)', () => {
        generate_random_code(16, { chars: hexChars });
    });

    bench('lowercase alpha (10 chars)', () => {
        generate_random_code(10, { chars: alphaLower });
    });

    bench('full alphanumeric (16 chars)', () => {
        generate_random_code(16, { chars: fullAlphanumeric });
    });
});

describe('generate_random_code - Batch generation', () => {
    bench('generate 100 codes (8 chars each)', () => {
        for ( let i = 0; i < 100; i++ ) {
            generate_random_code(8);
        }
    });

    bench('generate 1000 codes (8 chars each)', () => {
        for ( let i = 0; i < 1000; i++ ) {
            generate_random_code(8);
        }
    });
});

describe('Comparison with alternatives', () => {
    bench('generate_identifier', () => {
        generate_identifier();
    });

    bench('generate_random_code (8 chars)', () => {
        generate_random_code(8);
    });

    bench('Math.random().toString(36).slice(2, 10)', () => {
        Math.random().toString(36).slice(2, 10);
    });

    bench('Date.now().toString(36)', () => {
        Date.now().toString(36);
    });
});

describe('Real-world usage patterns', () => {
    bench('generate username suggestion', () => {
        // Pattern: adjective_noun_number
        generate_identifier('_');
    });

    bench('generate session token (32 chars)', () => {
        generate_random_code(32);
    });

    bench('generate verification code (6 chars, numeric)', () => {
        generate_random_code(6, { chars: '0123456789' });
    });

    bench('generate file suffix (8 chars)', () => {
        generate_random_code(8);
    });
});
