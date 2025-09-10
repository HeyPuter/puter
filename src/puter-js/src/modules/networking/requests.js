// SO: https://stackoverflow.com/a/76332760/ under CC BY-SA 4.0
function mergeUint8Arrays(...arrays) {
    const totalSize = arrays.reduce((acc, e) => acc + e.length, 0);
    const merged = new Uint8Array(totalSize);

    arrays.forEach((array, i, arrays) => {
        const offset = arrays.slice(0, i).reduce((acc, e) => acc + e.length, 0);
        merged.set(array, offset);
    });

    return merged;
}

function parseHTTPHead(head) {
    const lines = head.split("\r\n");

    const firstLine = lines.shift().split(" ");
    const status = Number(firstLine[1]);
    const statusText = firstLine.slice(2).join(" ") || "";

    const headersArray = [];
    for (const header of lines) {
        const splitHeaders = header.split(": ");
        const key = splitHeaders[0];
        const value = splitHeaders.slice(1).join(": ");
        headersArray.push([key, value]);
    }
    new Headers(headersArray);
    return { headers: new Headers(headersArray), statusText, status };
}

// Trivial stream based HTTP 1.1 client
// TODO optional redirect handling

export function pFetch(...args) {
    return new Promise(async (res, rej) => {
        try {
            const reqObj = new Request(...args);
            const parsedURL = new URL(reqObj.url);
            let headers = new Headers(reqObj.headers); // Make a headers object we can modify

            // Socket creation: regular for HTTP, TLS for https
            let socket;
            if (parsedURL.protocol === "http:") {
                socket = new puter.net.Socket(
                    parsedURL.hostname,
                    parsedURL.port || 80,
                );
            } else if (parsedURL.protocol === "https:") {
                socket = new puter.net.tls.TLSSocket(
                    parsedURL.hostname,
                    parsedURL.port || 443,
                );
            } else {
                const errorMsg = `Failed to fetch. URL scheme "${parsedURL.protocol}" is not supported.`;
                
                // Log the error
                if (globalThis.puter?.apiCallLogger?.isEnabled()) {
                    globalThis.puter.apiCallLogger.logRequest({
                        service: 'network',
                        operation: 'pFetch',
                        params: { url: reqObj.url, method: reqObj.method },
                        error: { message: errorMsg }
                    });
                }
                
                rej(errorMsg);
                return;
            }

            // Sending default UA
            if (!headers.get("user-agent")) {
                headers.set("user-agent", navigator.userAgent);
            }

            let reqHead = `${reqObj.method} ${parsedURL.pathname}${parsedURL.search} HTTP/1.1\r\nHost: ${parsedURL.host}\r\nConnection: close\r\n`;
            for (const [key, value] of headers) {
                reqHead += `${key}: ${value}\r\n`;
            }
            let requestBody;
            if (reqObj.body) {
                requestBody = new Uint8Array(await reqObj.arrayBuffer());
                // If we have a body, we need to set the content length
                if (!headers.has("content-length")) {
                    headers.set("content-length", requestBody.length);
                } else if (
                    headers.get("content-length") !== String(requestBody.length)
                ) {
                    return rej(
                        "Content-Length header does not match the body length. Please check your request.",
                    );
                }
                reqHead += `Content-Length: ${requestBody.length}\r\n`;
            }

            reqHead += "\r\n";

            socket.on("open", async () => {
                socket.write(reqHead); // Send headers
                if (requestBody) {
                    socket.write(requestBody); // Send body if present
                }
            });
            const decoder = new TextDecoder();
            let responseHead = "";
            let dataOffset = -1;
            const fullDataParts = [];
            let responseReturned = false;
            let contentLength = -1;
            let ingestedContent = 0;
            let chunkedTransfer = false;
            let currentChunkLeft = -1;
            let buffer = new Uint8Array(0);

            const outStream = new ReadableStream({
                start(controller) {
                    // This is annoyingly long
                    function parseIncomingChunk(data) {
                        // append new data to our rolling buffer
                        const tmp = new Uint8Array(buffer.length + data.length);
                        tmp.set(buffer, 0);
                        tmp.set(data, buffer.length);
                        buffer = tmp;

                        // pull out as many complete chunks (or headers) as we can
                        while (true) {
                            if (currentChunkLeft > 0) {
                                // we’re in the middle of reading a chunk body
                                // need size + 2 bytes (for trailing \r\n)
                                if (buffer.length >= currentChunkLeft + 2) {
                                    // full body + CRLF available
                                    const chunk = buffer.slice(0, currentChunkLeft);
                                    controller.enqueue(chunk);

                                    // strip body + CRLF and reset for next header
                                    buffer = buffer.slice(currentChunkLeft + 2);
                                    currentChunkLeft = 0;
                                } else {
                                    // only a partial body available
                                    controller.enqueue(buffer);
                                    currentChunkLeft -= buffer.length;
                                    buffer = new Uint8Array(0);
                                    break; // wait for more data
                                }
                            } else {
                                // we need to parse the next size line
                                // find the first "\r\n"
                                let idx = -1;
                                for (let i = 0; i + 1 < buffer.length; i++) {
                                    if (
                                        buffer[i] === 0x0d &&
                                        buffer[i + 1] === 0x0a
                                    ) {
                                        idx = i;
                                        break;
                                    }
                                }
                                if (idx < 0) {
                                    // we don’t yet have a full size line
                                    break;
                                }

                                // decode just the size line as ASCII hex
                                const sizeText = decoder
                                    .decode(buffer.slice(0, idx))
                                    .trim();
                                currentChunkLeft = parseInt(sizeText, 16);
                                if (isNaN(currentChunkLeft)) {
                                    controller.error(
                                        "Invalid chunk length from server",
                                    );
                                }
                                // strip off the size line + CRLF
                                buffer = buffer.slice(idx + 2);

                                // zero-length => end of stream
                                if (currentChunkLeft === 0) {
                                    responseReturned = true;
                                    controller.close();
                                    return;
                                }
                            }
                        }
                    }
                    socket.on("data", (data) => {
                        // Dataoffset is set to another value once head is returned, its safe to assume all remaining data is body
                        if (dataOffset !== -1 && !chunkedTransfer) {
                            controller.enqueue(data);
                            ingestedContent += data.length;
                        }

                        // We dont have the full responseHead yet
                        if (dataOffset === -1) {
                            fullDataParts.push(data);
                            responseHead += decoder.decode(data, { stream: true });
                        }
                        if (chunkedTransfer) {
                            parseIncomingChunk(data);
                        }

                        // See if we have the HEAD of an HTTP/1.1 yet
                        if (responseHead.indexOf("\r\n\r\n") !== -1) {
                            dataOffset = responseHead.indexOf("\r\n\r\n");
                            responseHead = responseHead.slice(0, dataOffset);
                            const parsedHead = parseHTTPHead(responseHead);
                            contentLength = Number(
                                parsedHead.headers.get("content-length"),
                            );
                            chunkedTransfer =
                                parsedHead.headers.get("transfer-encoding") ===
                                "chunked";
                            
                            // Log the response
                            if (globalThis.puter?.apiCallLogger?.isEnabled()) {
                                globalThis.puter.apiCallLogger.logRequest({
                                    service: 'network',
                                    operation: 'pFetch',
                                    params: { url: reqObj.url, method: reqObj.method },
                                    result: { status: parsedHead.status, statusText: parsedHead.statusText }
                                });
                            }
                            
                            // Return initial response object
                            res(new Response(outStream, parsedHead));

                            const residualBody = mergeUint8Arrays(
                                ...fullDataParts,
                            ).slice(dataOffset + 4);
                            if (!chunkedTransfer) {
                                // Add any content we have but isn't part of the head into the body stream
                                ingestedContent += residualBody.length;
                                controller.enqueue(residualBody);
                            } else {
                                parseIncomingChunk(residualBody);
                            }
                        }

                        if (
                            contentLength !== -1 &&
                            ingestedContent === contentLength &&
                            !chunkedTransfer
                        ) {
                            // Work around for the close bug for compliant HTTP/1.1 servers
                            if (!responseReturned) {
                                responseReturned = true;
                                controller.close();
                            }
                        }
                    });
                    socket.on("close", () => {
                        if (!responseReturned) {
                            responseReturned = true;
                            controller.close();
                        }
                    });
                    socket.on("error", (reason) => {
                        // Log the error
                        if (globalThis.puter?.apiCallLogger?.isEnabled()) {
                            globalThis.puter.apiCallLogger.logRequest({
                                service: 'network',
                                operation: 'pFetch',
                                params: { url: reqObj.url, method: reqObj.method },
                                error: { message: "Socket errored with the following reason: " + reason }
                            });
                        }
                        rej("Socket errored with the following reason: " + reason);
                    });
                },
            });
        } catch (e) {
            // Log unexpected errors
            if (globalThis.puter?.apiCallLogger?.isEnabled()) {
                globalThis.puter.apiCallLogger.logRequest({
                    service: 'network',
                    operation: 'pFetch',
                    params: { url: reqObj.url, method: reqObj.method },
                    error: { message: e.message || e.toString(), stack: e.stack }
                });
            }
            rej(e);
        }});
}
