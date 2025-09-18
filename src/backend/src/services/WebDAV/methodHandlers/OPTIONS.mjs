export const OPTIONS = async (_req, res) => {
    res.set({
        'Allow': 'OPTIONS, GET, HEAD, POST, PUT, DELETE, TRACE, COPY, MOVE, MKCOL, PROPFIND, PROPPATCH, LOCK, UNLOCK',
        'DAV': '1, 2, ordered-collections',  // WebDAV compliance classes with ordered-collections for macOS
        'MS-Author-Via': 'DAV',  // Microsoft compatibility
        'Server': 'Puter/WebDAV',  // Server identification
        'Accept-Ranges': 'bytes',
        'Content-Type': 'text/plain; charset=utf-8',  // Explicit content type
        'Content-Length': '0',
        'Cache-Control': 'no-cache',  // Prevent caching issues
        'Connection': 'Keep-Alive',  // Keep connection alive for macOS
    });
    res.status(200).end();
};