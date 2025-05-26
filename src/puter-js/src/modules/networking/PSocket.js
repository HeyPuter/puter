import EventListener from "../../lib/EventListener.js";
import { errors } from "./parsers.js";
import { PWispHandler } from "./PWispHandler.js";
const texten = new TextEncoder();
const requireAuth = false; // for initial launch

export let wispInfo = {
    server: "wss://puter.cafe/", // Unused currently
    handler: undefined
};

export class PSocket extends EventListener {
    _events = new Map();
    _streamID;
    constructor(host, port) {
        super(["data", "drain", "open", "error", "close", "tlsdata", "tlsopen", "tlsclose"]);

        (async () => {
            if(!puter.authToken && puter.env === 'web' && requireAuth){
                try{
                    await puter.ui.authenticateWithPuter();
                    
                }catch(e){
                    // if authentication fails, throw an error
                    throw (e);
                }
            }
            if (!wispInfo.handler) {
                // first launch -- lets init the socket
                const { token: wispToken, server: wispServer } = (await (await fetch(puter.APIOrigin + '/wisp/relay-token/create', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${puter.authToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({}),
                })).json());
    
                wispInfo.handler = new PWispHandler(wispServer, wispToken);
                // Wait for websocket to fully open
                await new Promise((res, req) => {
                    wispInfo.handler.onReady = res;
                });
            }



            const callbacks = {
                dataCallBack: (data) => {
                    this.emit("data", data);
                },
                closeCallBack: (reason) => {
                    if (reason !== 0x02) {
                        this.emit("error", new Error(errors[reason]));
                        this.emit("close", true);
                        return;    
                    }
                    this.emit("close", false);
                }
            }
    
            this._streamID = wispInfo.handler.register(host, port, callbacks);
            setTimeout(() => {this.emit("open", undefined)}, 0);

        })();
    }
    addListener(...args) {
        this.on(...args);
    }
    write(data, callback) {
        if (data.buffer) { // TypedArray
            wispInfo.handler.write(this._streamID, data);
            if (callback) callback();
        } else if (data.resize) { // ArrayBuffer
            data.write(this._streamID, new Uint8Array(data));
            if (callback) callback();
        } else if (typeof(data) === "string") {
            wispInfo.handler.write(this._streamID, texten.encode(data))
            if (callback) callback();
        } else {
            throw new Error("Invalid data type (not TypedArray, ArrayBuffer or String!!)");
        }
    }
    close() {
        wispInfo.handler.close(this._streamID);
    }
}