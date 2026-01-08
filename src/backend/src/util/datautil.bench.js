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
import { hash_serializable_object, stringify_serializable_object } from './datautil.js';

// Test data generators
const createFlatObject = (size) => {
    const obj = {};
    for ( let i = 0; i < size; i++ ) {
        obj[`key${i}`] = `value${i}`;
    }
    return obj;
};

const createNestedObject = (depth, breadth) => {
    if ( depth === 0 ) {
        return { leaf: 'value' };
    }
    const obj = {};
    for ( let i = 0; i < breadth; i++ ) {
        obj[`level${depth}_child${i}`] = createNestedObject(depth - 1, breadth);
    }
    return obj;
};

const createMixedObject = () => ({
    string: 'hello world',
    number: 42,
    boolean: true,
    null: null,
    array: [1, 2, 3, { nested: 'array' }],
    nested: {
        deep: {
            value: 'found',
            numbers: [1, 2, 3],
        },
    },
});

// Objects with different key orderings (should produce same hash)
const objA = { z: 1, a: 2, m: 3 };
const objB = { a: 2, m: 3, z: 1 };
const objC = { m: 3, z: 1, a: 2 };

describe('stringify_serializable_object - Flat objects', () => {
    const small = createFlatObject(5);
    const medium = createFlatObject(20);
    const large = createFlatObject(100);

    bench('small flat object (5 keys)', () => {
        stringify_serializable_object(small);
    });

    bench('medium flat object (20 keys)', () => {
        stringify_serializable_object(medium);
    });

    bench('large flat object (100 keys)', () => {
        stringify_serializable_object(large);
    });
});

describe('stringify_serializable_object - Nested objects', () => {
    const shallow = createNestedObject(2, 3); // depth 2, 3 children each
    const medium = createNestedObject(3, 3); // depth 3, 3 children each
    const deep = createNestedObject(4, 2); // depth 4, 2 children each

    bench('shallow nested (depth=2, breadth=3)', () => {
        stringify_serializable_object(shallow);
    });

    bench('medium nested (depth=3, breadth=3)', () => {
        stringify_serializable_object(medium);
    });

    bench('deep nested (depth=4, breadth=2)', () => {
        stringify_serializable_object(deep);
    });
});

describe('stringify_serializable_object - Mixed types', () => {
    const mixed = createMixedObject();

    bench('mixed type object', () => {
        stringify_serializable_object(mixed);
    });

    bench('primitives', () => {
        stringify_serializable_object('string');
        stringify_serializable_object(42);
        stringify_serializable_object(true);
        stringify_serializable_object(null);
        stringify_serializable_object(undefined);
    });
});

describe('stringify_serializable_object - Key ordering normalization', () => {
    bench('objects with different key orderings', () => {
        // All should produce the same output
        stringify_serializable_object(objA);
        stringify_serializable_object(objB);
        stringify_serializable_object(objC);
    });
});

describe('stringify_serializable_object vs JSON.stringify', () => {
    const obj = createFlatObject(20);

    bench('stringify_serializable_object', () => {
        stringify_serializable_object(obj);
    });

    bench('JSON.stringify (baseline, no key sorting)', () => {
        JSON.stringify(obj);
    });

    bench('JSON.stringify with sorted keys (manual)', () => {
        const sortedObj = {};
        Object.keys(obj).sort().forEach(k => {
            sortedObj[k] = obj[k];
        });
        JSON.stringify(sortedObj);
    });
});

describe('hash_serializable_object', () => {
    const small = createFlatObject(5);
    const medium = createFlatObject(20);
    const mixed = createMixedObject();

    bench('hash small object', () => {
        hash_serializable_object(small);
    });

    bench('hash medium object', () => {
        hash_serializable_object(medium);
    });

    bench('hash mixed object', () => {
        hash_serializable_object(mixed);
    });

    bench('hash objects with different key orderings (should be equal)', () => {
        hash_serializable_object(objA);
        hash_serializable_object(objB);
        hash_serializable_object(objC);
    });
});
