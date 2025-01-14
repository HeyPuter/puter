import EventListener from "../../lib/EventListener.js";
import {PWispHandler} from "./PWispHandler.js"


export let wispInfo = {
    server: "wss://puter.cafe/",
    handler: undefined
};

export class PSocket extends EventListener {
    _events = new Map();
    _streamID;
    constructor(host, port) {
        super(["data", "drain", "open", "close"]);
        const callbacks = {
            dataCallBack: (data) => {
                this.emit("data", data);
            },
            closeCallBack: (reason) => {
                this.emit("close", false); // TODO, report errors
            },
            openCallBack: () => {
                this.emit("open");
            }
        }

        this._streamID = wispInfo.handler.register(host, port, callbacks);
        
    }
    addListener(...args) {
        this.on(...args);
    }
    write(data, callback) {
        if (data.buffer) { // typedArray
            wispInfo.handler.write(this._streamID, data);
            if (callback) callback();
        } else if (data.resize) {
            data.write(this._streamID, new Uint8Array(data));
            if (callback) callback();
        } else if (data.arrayBuffer) { // Oh No, a blob, I need to handle this later, maybe with https://gist.github.com/jimmywarting/65c358f878cac8e7f39cfb7d43931f62?
            
        }
    }
    close() {
        wispInfo.handler.close(this._streamID);
    }
}