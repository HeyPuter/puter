import { escapeXml, fsOperations } from '../utils.mjs';

const getProperMimeType = ( originalType, filename ) => {
    if ( originalType && originalType !== 'application/octet-stream' ) {
        return originalType;
    }
    const ext = filename.split('.').pop()?.toLowerCase();
    switch ( ext ) {
    case 'js':
        return 'application/javascript';
    case 'css':
        return 'text/css';
    case 'html':
    case 'htm':
        return 'text/html';
    case 'txt':
        return 'text/plain';
    case 'json':
        return 'application/json';
    case 'xml':
        return 'application/xml';
    case 'pdf':
        return 'application/pdf';
    case 'png':
        return 'image/png';
    case 'jpg':
    case 'jpeg':
        return 'image/jpeg';
    case 'gif':
        return 'image/gif';
    case 'svg':
        return 'image/svg+xml';
    default:
        return 'application/octet-stream';
    }
};

const convertToWebDAVPropfindXML = ( fsEntry ) => {
    const isDirectory = fsEntry.is_dir;
    const lastModified = new Date(fsEntry.modified * 1000).toUTCString();
    const createdDate = new Date(fsEntry.created * 1000).toISOString();
    let href = fsEntry.path;
    if ( isDirectory && !href.endsWith('/') ) {
        href += '/';
    }
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav${escapeXml(encodeURI(href))}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(fsEntry.name)}</D:displayname>
        <D:getlastmodified>${lastModified}</D:getlastmodified>
        <D:creationdate>${createdDate}</D:creationdate>
        ${
            isDirectory
                ? '<D:resourcetype><D:collection/></D:resourcetype>'
                : `<D:resourcetype/>
        <D:getcontentlength>${fsEntry.size || 0}</D:getcontentlength>
        <D:getcontenttype>${escapeXml(getProperMimeType(fsEntry.type, fsEntry.name))}</D:getcontenttype>`
        }
        <D:getetag>"${fsEntry.uid}-${Math.floor(fsEntry.modified)}"</D:getetag>
        <D:supportedlock>
          <D:lockentry>
            <D:lockscope><D:exclusive/></D:lockscope>
            <D:locktype><D:write/></D:locktype>
          </D:lockentry>
          <D:lockentry>
            <D:lockscope><D:shared/></D:lockscope>
            <D:locktype><D:write/></D:locktype>
          </D:lockentry>
        </D:supportedlock>
        <D:lockdiscovery/>
        <D:ishidden>0</D:ishidden>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
    return xml;
};

const convertMultipleToWebDAVPropfindXML = ( selfStat, fsEntries ) => {
    fsEntries = [ selfStat, ...fsEntries ];
    const responses = fsEntries
        .map(( fsEntry ) => {
            const isDirectory = fsEntry.is_dir;
            const lastModified = new Date(( fsEntry.modified || 0 ) * 1000).toUTCString();
            const createdDate = new Date(( fsEntry.created || 0 ) * 1000).toISOString();
            let href = fsEntry.path;
            if ( isDirectory && !href.endsWith('/') ) {
                href += '/';
            }
            return `  <D:response>
    <D:href>/dav${escapeXml(encodeURI(href))}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(fsEntry.name)}</D:displayname>
        <D:getlastmodified>${lastModified}</D:getlastmodified>
        <D:creationdate>${createdDate}</D:creationdate>
        ${
            isDirectory
                ? '<D:resourcetype><D:collection/></D:resourcetype>'
                : `<D:resourcetype/>
        <D:getcontentlength>${fsEntry.size || 0}</D:getcontentlength>
        <D:getcontenttype>${escapeXml(getProperMimeType(fsEntry.type, fsEntry.name))}</D:getcontenttype>`
        }
        <D:getetag>"${fsEntry.uid}-${Math.floor(fsEntry.modified)}"</D:getetag>
        <D:supportedlock>
          <D:lockentry>
            <D:lockscope><D:exclusive/></D:lockscope>
            <D:locktype><D:write/></D:locktype>
          </D:lockentry>
          <D:lockentry>
            <D:lockscope><D:shared/></D:lockscope>
            <D:locktype><D:write/></D:locktype>
          </D:lockentry>
        </D:supportedlock>
        <D:lockdiscovery/>
        <D:ishidden>0</D:ishidden>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
        })
        .join( '\n');

    return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${responses}
</D:multistatus>`;
};

export const PROPFIND = async ( req, res, filePath, fileNode, _headerLockToken ) => {
    try {
        res.set({
            'Content-Type': 'application/xml; charset=utf-8',
            DAV: '1, 2',
            'MS-Author-Via': 'DAV',
        });

        const exists = await fileNode?.exists();

        // Handle special case for /dav/ root - return static response with only admin folder
        if ( filePath === '/' || filePath === '' ) {
            const stat = await fsOperations.stat(fileNode);
            const entries = await fsOperations.readdir(fileNode);
            res.status(207);
            res.end(convertMultipleToWebDAVPropfindXML(stat, entries));
            return;
        }

        // Check if file exists
        if ( !exists ) {
            res.status(404).end( 'Not Found');
            return;
        }

        // Handle Depth header (Windows WebDAV client compatibility)
        const depth = req.headers.depth || '1';

        const stat = await fsOperations.stat(fileNode);

        if ( stat.is_dir && depth !== '0' ) {
            const entries = await fsOperations.readdir(fileNode);
            res.status(207);
            res.end(convertMultipleToWebDAVPropfindXML(stat, entries));
        } else {
            res.status(207);
            res.end(convertToWebDAVPropfindXML(stat));
        }
    } catch( error ) {

        console.error('PROPFIND error:', error);
        res.status(500).end( 'Internal Server Error');
    }
};
