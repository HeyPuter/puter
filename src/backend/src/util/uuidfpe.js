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
