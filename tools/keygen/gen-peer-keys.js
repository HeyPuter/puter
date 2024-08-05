const nacl = require('tweetnacl');

const pair = nacl.box.keyPair();

const format_key = key => {
    const version = new Uint8Array([0x31]);
    const buffer = Buffer.concat([
        Buffer.from(version),
        Buffer.from(key),
    ]);
    return buffer.toString('base64');
};

console.log(JSON.stringify({
    keys: {
        public: format_key(pair.publicKey),
        secret: format_key(pair.secretKey),
    },
}, undefined, '    '));
