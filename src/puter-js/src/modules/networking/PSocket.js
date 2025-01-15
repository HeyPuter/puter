import EventListener from "../../lib/EventListener.js";
import { errors } from "./parsers.js";
const texten = new TextEncoder();

export let wispInfo = {
    server: "wss://puter.cafe/",
    handler: undefined
};

export class PSocket extends EventListener {
    _events = new Map();
    _streamID;
    constructor(host, port) {
        super(["data", "drain", "open", "error", "close", "tlsdata", "tlsopen"]);
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