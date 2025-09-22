export function pFetch(...args) {
    return new Promise(async (res, rej) => {
        try {
            const reqObj = new Request(...args);
            const parsedURL = new URL(reqObj.url);

            // --- Safari / WebKit fallback ---
            // If running in Safari (no socket support, but fetch exists), just use fetch.
            if (typeof navigator !== "undefined" && /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)) {
                try {
                    const response = await fetch(reqObj);
                    
                    // Log Safari fallback
                    if (globalThis.puter?.apiCallLogger?.isEnabled()) {
                        globalThis.puter.apiCallLogger.logRequest({
                            service: 'network',
                            operation: 'pFetch',
                            params: { url: reqObj.url, method: reqObj.method },
                            result: { status: response.status, statusText: response.statusText },
                            note: "Safari fallback to native fetch()"
                        });
                    }

                    res(response);
                    return; // ✅ Don’t continue with socket logic
                } catch (safariErr) {
                    rej("Safari fallback fetch failed: " + safariErr.message);
                    return;
                }
            }
            // --- End Safari Fallback ---

            // Continue with existing socket-based networking
            let headers = new Headers(reqObj.headers); // Make a headers object we can modify

            let body = null;
            if (reqObj.method !== "GET" && reqObj.method !== "HEAD") {
                body = await reqObj.arrayBuffer();
            }

            // Prepare request object
            const request = {
                url: parsedURL.href,
                method: reqObj.method,
                headers: Object.fromEntries(headers.entries()),
                body: body ? new Uint8Array(body) : null,
            };

            // Call puter socket API
            const socket = globalThis.puter?.socket;
            if (!socket) {
                throw new Error("Puter socket not available");
            }

            socket.emit("httpRequest", request, (response) => {
                try {
                    const resInit = {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers,
                    };
                    const blob = new Blob([response.body || new Uint8Array()], { type: response.headers["content-type"] });
                    const finalResponse = new Response(blob, resInit);

                    res(finalResponse);
                } catch (err) {
                    rej(err);
                }
            });
        } catch (err) {
            rej(err);
        }
    });
}
