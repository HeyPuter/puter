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
        this.onload = null;
        this.onerror = null;
        this.onloadend = null;
    }

    // The DOM FileReader fires `onload`/`onerror` and then `onloadend`.
    // Callers listen on the first pair, so a poly that only fires
    // `onloadend` leaves them waiting forever.
    #finish() {
        if ( this.error ) {
            if ( typeof this.onerror === 'function' ) this.onerror(this.error);
        } else if ( typeof this.onload === 'function' ) {
            this.onload({ target: this });
        }
        if ( typeof this.onloadend === 'function' ) this.onloadend();
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
            } catch (err) {
                self.error = err;
            }
            self.#finish();
        })();
    }
}
