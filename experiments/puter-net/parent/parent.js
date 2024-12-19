
const streamID = 1;
const streamMapping = new Map();

const ws = new WebSocket("wss://anura.pro/");
ws.binaryType = "arraybuffer";
ws.onmessage = ((ev) => {
    const data = wispPacketParser(new Uint8Array(ev.data));
    if ( data.streamID !== 0 )
        streamMapping.get(data.streamID).rxCallBack(new Uint8Array(ev.data));
});




// Message registerer
window.addEventListener("message", (message) => {
    if (message.data.$ !== "wisp-reg") 
        return;
    
    const app = message.source;
    message.source.addEventListener("message", (message) => {
        if (message.data.$ === "wisp-tx") {            
            const unmapping = {};
            const messageData = wispPacketParser(message.data.packet);

            if (messageData.type === "CONNECT") {
                const view = new DataView(message.data.packet.buffer);
                streamMapping.set(streamID, {
                    originalID: messageData.streamID,
                    rxCallBack: (data) => {
                        const view = new DataView(data.buffer);
                        view.setUint32(0, messageData.streamID, true); // replace with old stream ID
                        
                        app.postMessage({
                            $: "wisp-rx",
                            packet: data
                        });
                    }
                })
                unmapping[messageData.streamID] = streamID;

                view.setUint32(0, streamID, true); // override the given stream ID with one we made instead to avoid conflicts
                ws.send(message.data);
            }
            if (messageData.type === "DATA") {
                const streamID = unmapping[messageData.streamID];
                const view = new DataView(message.data.packet.buffer);
                view.setUint32(0, streamID, true); // replace with old stream ID
                ws.send(message.data);

            }
            if (messageData.type === "CLOSE") {
                const streamID = unmapping[messageData.streamID];
                const view = new DataView(message.data.packet.buffer);
                view.setUint32(0, streamID, true); // replace with old stream ID
                ws.send(message.data);
                delete unmapping[messageData.streamID];
            }
        }
    });
})