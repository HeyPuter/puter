import { fsOperations, getProperMimeType } from '../utils.mjs';

const parseRangeHeader = ( rangeHeader ) => {
    // Check if this is a multipart range request
    if ( rangeHeader.includes(',') ) {
        // For now, we'll only serve the first range in multipart requests
        // as the underlying storage layer doesn't support multipart responses
        const firstRange = rangeHeader.split(',')[0].trim();
        const matches = firstRange.match(/bytes=(\d+)-(\d*)/);
        if ( ! matches ) {
            return null;
        }

        const start = parseInt(matches[1], 10);
        const end = matches[2] ? parseInt(matches[2], 10) : null;

        return { start, end, isMultipart: true };
    }

    // Single range request
    const matches = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if ( ! matches ) {
        return null;
    }

    const start = parseInt(matches[1], 10);
    const end = matches[2] ? parseInt(matches[2], 10) : null;

    return { start, end, isMultipart: false };
};

/**
 * @type {import('./method.mjs').HandlerFunction}
 */
export const HEAD_GET = async ( req, res, _filePath, fileNode, _headerLockToken ) => {
    try {
        const exists = await fileNode?.exists();
        if ( ! exists ) {
            res.status(404).end( 'File not found');
            return;
        }

        // Get file stats for Content-Length and other headers
        const fileStat = await fsOperations.stat(fileNode);

        // Set appropriate headers
        const headers = {
            'Accept-Ranges': 'bytes',
        };

        // Set Content-Length for files (not directories)
        if ( ! fileStat.is_dir ) {
            headers['Content-Length'] = fileStat.size || 0;
            headers['Content-Type'] = getProperMimeType(fileStat.type, fileStat.name);
        }

        // Set last modified header
        if ( fileStat.modified ) {
            headers['Last-Modified'] = new Date(fileStat.modified * 1000).toUTCString();
        }

        // Set ETag
        headers['ETag'] = `"${fileStat.uid}-${Math.floor(fileStat.modified)}"`;

        res.set(headers);

        // For HEAD requests, only send headers, no body
        if ( req.method === 'HEAD' ) {
            res.status(200).end();
            return;
        }

        // For GET requests, send the file content
        if ( fileStat.is_dir ) {
            res.status(400).end( 'Cannot GET a directory');
            return;
        }

        const options = {};

        if ( req.headers['range'] ) {
            res.status(206);
            options.range = req.headers['range'];
            // Parse the Range header and set Content-Range
            const rangeInfo = parseRangeHeader(req.headers['range']);
            if ( rangeInfo ) {
                const { start, end, isMultipart } = rangeInfo;

                // For open-ended ranges, we need to calculate the actual end byte
                let actualEnd = end;
                let fileSize = null;

                try {
                    fileSize = fileStat.size;
                    if ( end === null ) {
                        actualEnd = fileSize - 1; // File size is 1-based, end byte is 0-based
                    }
                } catch ( _error ) {
                    // If we can't get file size, we'll let the storage layer handle it
                    // and not set Content-Range header
                    actualEnd = null;
                    fileSize = null;
                }

                if ( actualEnd !== null ) {
                    const totalSize = fileSize !== null ? fileSize : '*';
                    const contentRange = `bytes ${start}-${actualEnd}/${totalSize}`;
                    res.set('Content-Range', contentRange);
                }

                // If this was a multipart request, modify the range header to only include the first range
                if ( isMultipart ) {
                    req.headers['range'] = end !== null ? `bytes=${start}-${end}` : `bytes=${start}-`;
                }
            }
        }

        const stream = await fsOperations.read(fileNode, options);
        stream.on('data', ( data ) => {
            res.write(data);
        });
        stream.on('end', () => {
            res.end();
        });
        stream.on('error', ( error ) => {
            console.error('Stream error:', error);
            res.status(500).end( 'Internal server error');
        });
    } catch ( error ) {
        console.error('HEAD or GET error:', error);
        res.status(500).end( 'Internal Server Error');
    }
};
