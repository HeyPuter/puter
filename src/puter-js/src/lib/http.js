import EventListener from "./EventListener";

// TODO: this inheritance is an anti-pattern; we should use
//       a trait or mixin for event emitters.
export class HTTPRequest extends EventListener {
    constructor ({ options, callback }) {
        super(['data','end','error']);
        this.options = options;
        this.callback = callback;
    }
    end () {
        //
    }
}

export const make_http_api = ({ Socket, DEFAULT_PORT }) => {
    // Helper to create an EventEmitter-like object

    const api = {};
    
    api.request = (options, callback) => {
        const sock = new Socket(options.hostname, options.port ?? DEFAULT_PORT);
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();

        // Request object
        const req = new HTTPRequest([
            'data',
            'end',
            'error',
        ]);
        
        // Response object
        const res = new EventListener([
            'data',
            'end',
            'error',
        ]);
        res.headers = {};
        res.statusCode = null;
        res.statusMessage = '';
        
        let buffer = '';

        let amount = 0;
        const TRANSFER_CONTENT_LENGTH = {
            data: data => {
                const contentLength = parseInt(res.headers['content-length'], 10);
                if ( buffer ) {
                    const bin = encoder.encode(buffer);
                    data = new Uint8Array([...bin, ...data]);
                    buffer = '';
                }
                amount += data.length;
                res.emit('data', decoder.decode(data));
                if (amount >= contentLength) {
                    sock.close();
                }
            }
        };
        const TRANSFER_CHUNKED = {
            data: data => {
                // TODO
                throw new Error('Chunked transfer encoding not implemented');
            }
        };
        let transfer = null;

        const STATE_HEADERS = {
            data: data => {
                data = decoder.decode(data);

                buffer += data;
                const headerEndIndex = buffer.indexOf('\r\n\r\n');
                if ( headerEndIndex === -1 ) return;

                // Parse headers
                const headersString = buffer.substring(0, headerEndIndex);
                const headerLines = headersString.split('\r\n');

                // Remove headers from buffer
                buffer = buffer.substring(headerEndIndex + 4);

                // Parse status line
                const [httpVersion, statusCode, ...statusMessageParts] = headerLines[0].split(' ');
                res.statusCode = parseInt(statusCode, 10);
                res.statusMessage = statusMessageParts.join(' ');

                // Parse headers
                for (let i = 1; i < headerLines.length; i++) {
                    const [key, ...valueParts] = headerLines[i].split(':');
                    if (key) {
                        res.headers[key.toLowerCase().trim()] = valueParts.join(':').trim();
                    }
                }


                if ( res.headers['transfer-encoding'] === 'chunked' ) {
                    transfer = TRANSFER_CHUNKED;
                } else if ( res.headers['transfer-encoding'] ) {
                    throw new Error('Unsupported transfer encoding');
                } else if ( res.headers['content-length'] ) {
                    transfer = TRANSFER_CONTENT_LENGTH;
                } else {
                    throw new Error('No content length or transfer encoding');
                }
                state = STATE_BODY;

                callback(res);
            }
        };
        const STATE_BODY = {
            data: data => {
                transfer.data(data);
            }
        };
        let state = STATE_HEADERS;
        
        sock.on('data', (data) => {
            state.data(data);
        });

        sock.on('error', (err) => {
            req.emit('error', err);
        });

        sock.on('close', () => {
            res.emit('end');
        });

        // Construct and send HTTP request
        const method = options.method || 'GET';
        const path = options.path || '/';
        const headers = options.headers || {};
        headers['Host'] = options.hostname;
        
        let requestString = `${method} ${path} HTTP/1.1\r\n`;
        for (const [key, value] of Object.entries(headers)) {
            requestString += `${key}: ${value}\r\n`;
        }
        requestString += '\r\n';
        
        if (options.data) {
            requestString += options.data;
        }
        
        sock.write(encoder.encode(requestString));
        
        return req;
    };
    
    return api;
};