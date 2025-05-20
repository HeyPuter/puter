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
// TODO redirects, chunked encoding

export function pFetch(...args) {
    return new Promise((res, rej) => {
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
            rej(
                `Failed to fetch. URL scheme "${parsedURL.protocol}" is not supported.`,
            );
        }

        // Sending default UA
        if (!headers.get("user-agent")) {
            headers.set("user-agent", navigator.userAgent);
        }

        let reqHead = `${reqObj.method} ${parsedURL.pathname} HTTP/1.1\r\nHost: ${parsedURL.host}\r\nConnection: close\r\n`;
        for (const [key, value] of headers) {
            reqHead += `${key}: ${value}\r\n`;
        }
        reqHead += "\r\n";

        socket.on("open", () => {
            socket.write(reqHead);
        });
        const decoder = new TextDecoder();
        let responseHead = "";
        let dataOffset = -1;
        const fullDataParts = [];
        let responseReturned = false;
        let contentLength = -1;
        let ingestedContent = 0;

        const outStream = new ReadableStream({
            start(controller) {
                socket.on("data", (data) => {
                    // Dataoffset is set to another value once head is returned, its safe to assume all remaining data is body
                    if (dataOffset !== -1) {
                        controller.enqueue(data);
                        ingestedContent += data.length;
                    }

                    fullDataParts.push(data);
                    responseHead += decoder.decode(data, { stream: true });

                    // See if we have the HEAD of an HTTP/1.1 yet
                    if (reqHead.indexOf("\r\n\r\n") !== -1) {
                        dataOffset = responseHead.indexOf("\r\n\r\n");
                        responseHead = responseHead.slice(0, dataOffset);
                        const parsedHead = parseHTTPHead(responseHead);
                        contentLength = Number(
                            parsedHead.headers.get("content-length"),
                        );
                        // Return initial response object
                        res(new Response(outStream, parsedHead));

                        // Add any content we have but isn't part of the head into the body stream
                        const residualBody = mergeUint8Arrays(
                            ...fullDataParts,
                        ).slice(dataOffset + 4);
                        ingestedContent += residualBody.length;
                        controller.enqueue(residualBody);
                    }

                    if (
                        contentLength !== -1 &&
                        ingestedContent === contentLength
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
                    rej("Socket errored with the following reason: " + reason);
                });
            },
        });
    });
}
