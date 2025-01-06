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

const { AdvancedBase } = require('@heyputer/putility');

class KeyPairHelper extends AdvancedBase {
    static MODULES = {
        tweetnacl: require('tweetnacl'),
    };
    
    constructor ({
        kpublic,
        ksecret,
    }) {
        super();
        this.kpublic = kpublic;
        this.ksecret = ksecret;
        this.nonce_ = 0;
    }
    
    to_nacl_key_ (key) {
        console.log('WUT', key);
        const full_buffer = Buffer.from(key, 'base64');

        // Remove version byte (assumed to be 0x31 and ignored for now)
        const buffer = full_buffer.slice(1);
        
        return new Uint8Array(buffer);
    }
    
    get naclSecret () {
        return this.naclSecret_ ?? (
            this.naclSecret_ = this.to_nacl_key_(this.ksecret));
    }
    get naclPublic () {
        return this.naclPublic_ ?? (
            this.naclPublic_ = this.to_nacl_key_(this.kpublic));
    }
    
    write (text) {
        const require = this.require;
        const nacl = require('tweetnacl');

        const nonce = nacl.randomBytes(nacl.box.nonceLength);
        const message = {};
        
        const textUint8 = new Uint8Array(Buffer.from(text, 'utf-8'));
        const encryptedText = nacl.box(
            textUint8, nonce,
            this.naclPublic, this.naclSecret
        );
        message.text = Buffer.from(encryptedText);
        message.nonce = Buffer.from(nonce);
        
        return message;
    }
    
    read (message) {
        const require = this.require;
        const nacl = require('tweetnacl');
        
        const arr = nacl.box.open(
            new Uint8Array(message.text),
            new Uint8Array(message.nonce),
            this.naclPublic,
            this.naclSecret,
        );
        
        return Buffer.from(arr).toString('utf-8');
    }
}

module.exports = {
    KeyPairHelper,
};
