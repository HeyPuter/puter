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

const crypto = require('crypto');

class UUIDFPE {
    static ALGORITHM = 'aes-128-ecb';

    constructor(key) {
        if ( !key || key.length !== 16 ) {
            throw new Error('Key must be a 16-byte Buffer.');
        }
        this.key = key;
    }

    static uuidToBuffer (uuidStr) {
        const hexStr = uuidStr.replace(/-/g, '');
        return Buffer.from(hexStr, 'hex');
    }
    static bufferToUuid (buffer) {
        const hexStr = buffer.toString('hex');
        return [
            hexStr.substring(0, 8),
            hexStr.substring(8, 12),
            hexStr.substring(12, 16),
            hexStr.substring(16, 20),
            hexStr.substring(20)
        ].join('-');
    }

    encrypt(uuidStr) {
        const plaintext = this.constructor.uuidToBuffer(uuidStr);

        const cipher = crypto.createCipheriv(
            this.constructor.ALGORITHM,
            this.key,
            null,
        );
        cipher.setAutoPadding(false);

        const encrypted = Buffer.concat([
            cipher.update(plaintext),
            cipher.final(),
        ]);
        return this.constructor.bufferToUuid(encrypted);
    }

    decrypt(encryptedUuidStr) {
        const encrypted = this.constructor.uuidToBuffer(encryptedUuidStr);
        const decipher = crypto.createDecipheriv(
            this.constructor.ALGORITHM,
            this.key,
            null,
        );
        decipher.setAutoPadding(false);

        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return this.constructor.bufferToUuid(decrypted);
    }
}

module.exports = {
    UUIDFPE,
};
