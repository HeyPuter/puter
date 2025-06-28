/**
 * This file uses https://github.com/MercuryWorkshop/rustls-wasm authored by GitHub:@r58Playz under the MIT License
 */

import { PSocket } from "./PSocket.js";

let rustls = undefined;

export class PTLSSocket extends PSocket {
    constructor(...args) {
        super(...args);
        super.on("open", (async() => {
            if (!rustls) {
                rustls = (await import( /* webpackIgnore: true */ "https://puter-net.b-cdn.net/rustls.js"))
                await rustls.default("https://puter-net.b-cdn.net/rustls.wasm")
            }

            let cancelled = false;
            const readable = new ReadableStream({
                /**
                 * 
                 * @param {ReadableStreamDefaultController} controller 
                 */
                start: (controller) => {
                    super.on("data", (data) => {
                        controller.enqueue(data.buffer)
                    })
                    super.on("close", () => {
                        if (!cancelled)
                            controller.close()
                    })
                    
                },
                pull: (controller) => {

                },
                cancel: () => {
                    cancelled = true;
                }

            })
    
            const writable = new WritableStream({
                write: (chunk) => { super.write(chunk); },
                abort: () => { super.close(); },
                close: () => { super.close(); },
            })

            let read, write;
            try {
                const TLSConnnection = await rustls.connect_tls(readable, writable, args[0])
                read = TLSConnnection.read;
                write = TLSConnnection.write;
            } catch (e) {
                this.emit("error", new Error("TLS Handshake failed: " + e));
                return;
            }
            
            
            this.writer = write.getWriter();
            // writer.write("GET / HTTP/1.1\r\nHost: google.com\r\n\r\n");
            let reader = read.getReader();
            let done = false;
            this.emit("tlsopen", undefined);
            try {   
                while (!done) {    
                    const {done: readerDone, value} = await reader.read();
                    done = readerDone;
                    if (!done) {
                        this.emit("tlsdata", value);
                    }
                }
                this.emit("tlsclose", false);
            } catch (e) {
                this.emit("error", e)
                this.emit("tlsclose", true);
            }
            
        }));
    }
    on(event, callback) {
        if (event === "data" || event === "open" || event === "close") {
            return super.on("tls" + event, callback)
        } else {
            return super.on(event, callback);
        }
    }
    write(data, callback) {
        if (data.buffer) { // TypedArray
            this.writer.write(data.slice(0).buffer).then(callback);
        } else if (data.resize) { // ArrayBuffer
            this.writer.write(data).then(callback);
        } else if (typeof(data) === "string"){
            this.writer.write(data).then(callback);
        } else {
            throw new Error("Invalid data type (not TypedArray, ArrayBuffer or String!!)");
        }
    }

}