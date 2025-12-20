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
const { UUIDFPE } = require('./uuidfpe');
const crypto = require('crypto');

// Test data
const testKey = Buffer.from('0123456789abcdef'); // 16-byte key
const testUuid = '550e8400-e29b-41d4-a716-446655440000';
const fpe = new UUIDFPE(testKey);
const encryptedUuid = fpe.encrypt(testUuid);

// Pre-generate UUIDs for batch tests
const uuids = [];
for ( let i = 0; i < 100; i++ ) {
    uuids.push(crypto.randomUUID());
}

describe('UUIDFPE - Construction', () => {
    bench('create UUIDFPE instance', () => {
        new UUIDFPE(testKey);
    });

    bench('create with random key', () => {
        const key = crypto.randomBytes(16);
        new UUIDFPE(key);
    });
});

describe('UUIDFPE - Static utilities', () => {
    bench('uuidToBuffer', () => {
        UUIDFPE.uuidToBuffer(testUuid);
    });

    bench('bufferToUuid', () => {
        const buffer = Buffer.from('550e8400e29b41d4a716446655440000', 'hex');
        UUIDFPE.bufferToUuid(buffer);
    });

    bench('round-trip buffer conversion', () => {
        const buffer = UUIDFPE.uuidToBuffer(testUuid);
        UUIDFPE.bufferToUuid(buffer);
    });
});

describe('UUIDFPE - Encryption', () => {
    bench('encrypt single UUID', () => {
        fpe.encrypt(testUuid);
    });

    bench('encrypt 10 UUIDs', () => {
        for ( let i = 0; i < 10; i++ ) {
            fpe.encrypt(uuids[i]);
        }
    });

    bench('encrypt 100 UUIDs', () => {
        for ( const uuid of uuids ) {
            fpe.encrypt(uuid);
        }
    });
});

describe('UUIDFPE - Decryption', () => {
    bench('decrypt single UUID', () => {
        fpe.decrypt(encryptedUuid);
    });

    // Pre-encrypt for decryption benchmarks
    const encryptedUuids = uuids.map(uuid => fpe.encrypt(uuid));

    bench('decrypt 10 UUIDs', () => {
        for ( let i = 0; i < 10; i++ ) {
            fpe.decrypt(encryptedUuids[i]);
        }
    });

    bench('decrypt 100 UUIDs', () => {
        for ( const encrypted of encryptedUuids ) {
            fpe.decrypt(encrypted);
        }
    });
});

describe('UUIDFPE - Round-trip', () => {
    bench('encrypt then decrypt (single)', () => {
        const encrypted = fpe.encrypt(testUuid);
        fpe.decrypt(encrypted);
    });

    bench('encrypt then decrypt (10 UUIDs)', () => {
        for ( let i = 0; i < 10; i++ ) {
            const encrypted = fpe.encrypt(uuids[i]);
            fpe.decrypt(encrypted);
        }
    });
});

describe('UUIDFPE - Comparison with alternatives', () => {
    bench('UUIDFPE encrypt', () => {
        fpe.encrypt(testUuid);
    });

    bench('native crypto.randomUUID (for comparison)', () => {
        crypto.randomUUID();
    });

    bench('SHA256 hash of UUID (for comparison)', () => {
        crypto.createHash('sha256').update(testUuid).digest('hex');
    });
});

describe('UUIDFPE - Different keys', () => {
    const keys = [];
    for ( let i = 0; i < 10; i++ ) {
        keys.push(crypto.randomBytes(16));
    }

    bench('encrypt with 10 different keys', () => {
        for ( const key of keys ) {
            const instance = new UUIDFPE(key);
            instance.encrypt(testUuid);
        }
    });
});

describe('Real-world patterns', () => {
    bench('obfuscate user ID', () => {
        // Simulate hiding internal UUID from external API
        fpe.encrypt(testUuid);
    });

    bench('de-obfuscate incoming ID', () => {
        // Simulate receiving obfuscated ID and decrypting
        fpe.decrypt(encryptedUuid);
    });

    bench('API response transformation (10 items)', () => {
        // Simulate transforming a list of items with obfuscated IDs
        uuids.slice(0, 10).map(uuid => ({
            id: fpe.encrypt(uuid),
            name: 'item',
        }));
    });
});
