/**
 * 
 * @param {Uint8Array} arr 
 * @returns {Object}
 */
function wispPacketParser(arr) {
    const returnObj = {};
    const view = new DataView(arr.buffer);

    returnObj.streamID = view.getUint32(0, true);
    returnObj.payload = arr.slice(5);

    switch (arr[0]) {
        case 1: // CONNECT
            returnObj.type = "CONNECT";
            returnObj.socketType = view.getUint8(5) === 1 ? "TCP": "UDP";
            returnObj.port = view.getUint16(6, true) === 1 ? "TCP": "UDP";
            returnObj.hostname = returnObj.payload.slice(7);
            break;
        case 2: // DATA
            returnObj.type = "DATA";
            break;
        case 3: // CONTINUE
            returnObj.type = "CONTINUE";
            returnObj.bufferRemaining = view.getUint32(5, true)
            break;
        case 4: // CLOSE
            returnObj.type = "CLOSE";
            returnObj.reason = view.getUint8(5)
            break;
        case 5: // PROTOEXT
            returnObj.type = "PROTOEXT"
            returnObj.wispVer = `${view.getUint8(5)}.${view.getUint8(6)}`
            returnObj.extensions = [];
            let pointer = 7;
            while (true) {
                if (pointer >= view.byteLength)
                    break;
                returnObj.extensions.push(
                    {
                        ID: view.getUint8(pointer),
                        metadata: view.slice(pointer + 2, pointer + view.getUint8(pointer + 1))
                    }
                )
                pointer += 2 + view.getUint8(pointer + 1);
            }
        break;

    }
    return returnObj;
}