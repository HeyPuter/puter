function toBase64FromBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    // use the requested reduce logic
    const binary = bytes.reduce((data, byte) => data + String.fromCharCode(byte), '');
    return typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
}

export class FileReaderPoly {
    constructor() {
        this.result = null;
        this.error = null;
        this.onloadend = null;
    }
    readAsDataURL(blob) {
        const self = this;
        (async function () {
            try {
                let buffer;
                if (blob && typeof blob.arrayBuffer === 'function') {
                    buffer = await blob.arrayBuffer();
                } else if (blob instanceof ArrayBuffer) {
                    buffer = blob;
                } else if (ArrayBuffer.isView(blob)) {
                    buffer = blob.buffer;
                } else {
                    buffer = new Uint8Array(0).buffer;
                }

                const base64 = toBase64FromBuffer(buffer);
                const mime = (blob && blob.type) || 'application/octet-stream';
                self.result = 'data:' + mime + ';base64,' + base64;
                if (typeof self.onloadend === 'function') self.onloadend();
            } catch (err) {
                self.error = err;
                if (typeof self.onloadend === 'function') self.onloadend();
            }
        })();
    }
}

