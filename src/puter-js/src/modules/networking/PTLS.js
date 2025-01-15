/**
 * This file uses https://github.com/MercuryWorkshop/rustls-wasm authored by GitHub:@r58Playz under the MIT License
 */

import { PSocket } from "./PSocket";

let rustls = undefined;

export class PTLSSocket extends PSocket {
    constructor(...args) {
        super(...args);
        (async() => {
            if (!rustls) {
                rustls = (await import( /* webpackIgnore: true */ "https://puter-net.b-cdn.net/rustls.js"))
                // await rustls.default("https://puter-net.b-cdn.net/rustls.wasm")
                await rustls.default("https://alicesworld.tech/fun/rustls.wasm")
            }
            // const socket = new puter.net.Socket("google.com", 443)
            const readable = new ReadableStream({
                start: (controller) => {
                    super.on("data", (data) => {
                        controller.enqueue(data.buffer)
                    })
                    super.on("close", () => {
                        controller.close()
                    })
                }
            })
    
            const writable = new WritableStream({
                write: (chunk) => { super.write(chunk); },
                abort: () => { super.close(); },
                close: () => { super.close(); },
            })
    
            const {read, write} = await rustls.connect_tls(readable, writable, args[0]);
    
            this.writer = write.getWriter();
            // writer.write("GET / HTTP/1.1\r\nHost: google.com\r\n\r\n");
            let reader = read.getReader();
            let done = false;
            this.emit("tlsopen", undefined);

            while (!done) {
                const {done: readerDone, value} = await reader.read();
                done = readerDone;
                if (!done) {
                    this.emit("tlsdata", value);
                }
            }
        })();
    }
    on(event, callback) {
        if (event === "data" || event === "open") {
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