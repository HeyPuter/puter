/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 * 
 * This file is part of Puter.
 * 
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */


const { HLReadDir } = require("../filesystem/hl_operations/hl_readdir");
const { HLStat } = require("../filesystem/hl_operations/hl_stat");
const { LLRead } = require("../filesystem/ll_operations/ll_read");
const { HLWrite } = require("../filesystem/hl_operations/hl_write");
const { HLMkdir } = require("../filesystem/hl_operations/hl_mkdir");
const { HLMove } = require("../filesystem/hl_operations/hl_move");
const { HLCopy } = require("../filesystem/hl_operations/hl_copy");
const { NodePathSelector, NodeUIDSelector } = require("../filesystem/node/selectors");
const configurable_auth = require("../middleware/configurable_auth");
const { Context } = require("../util/context");
const { Endpoint } = require("../util/expressutil");
const BaseService = require("./BaseService");
const path = require('path');
const { HLRemove } = require("../filesystem/hl_operations/hl_remove");
const bcrypt = require('bcrypt')

function convertToWebDAVPropfindXML(fsEntry) {
  const isDirectory = fsEntry.is_dir;
  const lastModified = new Date(fsEntry.modified * 1000).toUTCString();
  const createdDate = new Date(fsEntry.created * 1000).toISOString();

  // Ensure href ends with / for directories
  let href = fsEntry.path;
  if (isDirectory && !href.endsWith('/')) {
    href += '/';
  }

  // Build the XML response
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav${escapeXml(href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(fsEntry.name)}</D:displayname>
        <D:getlastmodified>${lastModified}</D:getlastmodified>
        <D:creationdate>${createdDate}</D:creationdate>
        ${isDirectory ?
      '<D:resourcetype><D:collection/></D:resourcetype>' :
      `<D:resourcetype/>
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
}

function convertMultipleToWebDAVPropfindXML(selfStat, fsEntries) {
  fsEntries = [selfStat, ...fsEntries];
  const responses = fsEntries.map(fsEntry => {
    const isDirectory = fsEntry.is_dir;
    const lastModified = new Date((fsEntry.modified||0) * 1000).toUTCString();
    const createdDate = new Date((fsEntry.created||0) * 1000).toISOString();

    // Ensure href ends with / for directories
    let href = fsEntry.path;
    if (isDirectory && !href.endsWith('/')) {
      href += '/';
    }

    return `  <D:response>
    <D:href>/dav${escapeXml(href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(fsEntry.name)}</D:displayname>
        <D:getlastmodified>${lastModified}</D:getlastmodified>
        <D:creationdate>${createdDate}</D:creationdate>
        ${isDirectory ?
        '<D:resourcetype><D:collection/></D:resourcetype>' :
        `<D:resourcetype/>
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
  }).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${responses}
</D:multistatus>`;
}

function getProperMimeType(originalType, filename) {
  // If we have a type and it's not the generic octet-stream, use it
  if (originalType && originalType !== 'application/octet-stream') {
    return originalType;
  }

  // Otherwise, guess based on file extension
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js': return 'application/javascript';
    case 'css': return 'text/css';
    case 'html': case 'htm': return 'text/html';
    case 'txt': return 'text/plain';
    case 'json': return 'application/json';
    case 'xml': return 'application/xml';
    case 'pdf': return 'application/pdf';
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

function escapeXml(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function createStaticDavRootResponse() {
  const currentDate = new Date().toUTCString();
  const currentISODate = new Date().toISOString();
  const timestamp = Math.floor(Date.now() / 1000);
  
  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>dav</D:displayname>
        <D:getlastmodified>${currentDate}</D:getlastmodified>
        <D:creationdate>${currentISODate}</D:creationdate>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:getetag>"dav-root-${timestamp}"</D:getetag>
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
  <D:response>
    <D:href>/dav/admin/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>admin</D:displayname>
        <D:getlastmodified>${currentDate}</D:getlastmodified>
        <D:creationdate>${currentISODate}</D:creationdate>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:getetag>"admin-folder-${timestamp}"</D:getetag>
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
}

function createRootWebDAVResponse() {
  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>dav</D:displayname>
        <D:getlastmodified>Fri, 03 Jan 2025 10:30:45 GMT</D:getlastmodified>
        <D:creationdate>2025-01-03T10:30:45Z</D:creationdate>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:getetag>"dav-folder-1735898445"</D:getetag>
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
}


const operations = {
    stat: (node)=>{
        const hl_stat = new HLStat();
        return hl_stat.run({
            subject: node,
            user: Context.get("actor"),
            return_subdomains: true,
            return_permissions: true,
            return_shares: false,
            return_versions: false,
            return_size: true,
        });;
    },
    readdir: (node) => {
        const hl_readdir = new HLReadDir();
        return hl_readdir.run({
            subject: node,
            // user: Context.get("actor").type.user,
            actor: Context.get("actor"),
            recursive: false,
            no_thumbs: false,
            no_assocs: false,
        });
    },
    read: (node, options) => {
        const ll_read = new LLRead();
        return ll_read.run({
            fsNode: node,
            actor: Context.get("actor"),
            ...options
        });
    },
    write: (node, options) => {
        const hl_write = new HLWrite();
        return hl_write.run({
            destination_or_parent: node,
            actor: Context.get("actor"),
            file: {
                stream: options.stream,
                size: options.size || 0,
                ...options.file // Allow additional file properties
            },
            overwrite: options.overwrite !== undefined ? options.overwrite : true, // Default to true for WebDAV PUT
            create_missing_parents: false,
            dedupe_name: false,
            user: Context.get("actor").type.user,
            specified_name: options.name, // Optional filename if node is a directory
            fallback_name: options.fallback_name,
            shortcut_to: options.shortcut_to,
            no_thumbnail: options.no_thumbnail || true, // Disable thumbnails for WebDAV by default
            message: options.message,
            app_id: options.app_id,
            socket_id: options.socket_id,
            operation_id: options.operation_id,
            item_upload_id: options.item_upload_id,
            offset: options.offset, // For partial/resume uploads
        });
    },
    mkdir: (node, options) => {
        const hl_mkdir = new HLMkdir();
        return hl_mkdir.run({
            parent: node,
            path: options.path || options.name, // Support both path and name parameters
            actor: Context.get("actor"),
            overwrite: options.overwrite || false, // WebDAV MKCOL should not overwrite by default
            create_missing_parents: options.create_missing_parents !== undefined ? options.create_missing_parents : true, // Auto-create parent directories
            shortcut_to: options.shortcut_to, // Support for shortcuts
            user: Context.get("actor").type.user, // User context for permissions
        });
    },
    delete: (node) => {
        const hl_remove = new HLRemove();
        return hl_remove.run({
            target: node,
            recursive: true,
            user: Context.get("actor"),
        });
    },
    move: (sourceNode, options) => {
        const hl_move = new HLMove();
        return hl_move.run({
            source: sourceNode, // The source fileNode being moved
            destination_or_parent: options.destinationNode, // The destination fileNode (could be parent dir or exact destination)
            user: Context.get("actor").type.user,
            actor: Context.get("actor"),
            new_name: options.new_name, // New name in the destination folder
            overwrite: options.overwrite !== undefined ? options.overwrite : false, // WebDAV overwrite is optional
            dedupe_name: options.dedupe_name || false, // Handle name conflicts
            create_missing_parents: options.create_missing_parents || false, // Whether to create missing parent directories
            new_metadata: options.new_metadata, // Optional metadata updates
        });
    },
    copy: (sourceNode, options) => {
        const hl_copy = new HLCopy();
        return hl_copy.run({
            source: sourceNode, // The source fileNode being copied
            destination_or_parent: options.destinationNode, // The destination fileNode (could be parent dir or exact destination)
            user: Context.get("actor").type.user,
            new_name: options.new_name, // New name in the destination folder
            overwrite: options.overwrite !== undefined ? options.overwrite : false, // WebDAV overwrite is optional
            dedupe_name: options.dedupe_name || false, // Handle name conflicts
        });
    }

}

class WebDavFS extends BaseService {
    /**
     * Authenticate WebDAV user credentials
     * Override this method to implement your authentication logic
     * @param {string} username - The username from Basic auth
     * @param {string} password - The password from Basic auth  
     * @param {import("express").Request} req - Express request object
     * @param {import("express").Response} res - Express response object
     * @returns {Promise<object|null>} - Return actor object if authenticated, null if not
     */
    async authenticateWebDavUser(username, password, req, res) {
        // Default implementation - you should override this method
        // Return null to reject authentication
        const svc_auth = this.services.get('auth');

        const user = await services.get('get-user').get_user({ username: username, cached: false });
        console.log("authing")
        if (await bcrypt.compare(password, user.password)) {
            const { token } = await svc_auth.create_session_token(user);
            res.cookie(this.global_config.cookie_name, token, {
                sameSite: 'none',
                secure: true,
                httpOnly: true,
            });
            console.log("auth done!")
            return await svc_auth.authenticate_from_token(token);
        }
        console.log("auth failed")
        return null;
    }

    ['__on_install.routes'](_, { app }) {
        const r_webdav = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router();
        })();

        app.use('/dav', r_webdav);

        Endpoint({
            route: '/*',
            methods: ["PROPFIND", "PROPPATCH", "MKCOL", "GET", "HEAD", "POST", "PUT", "DELETE", "COPY", "MOVE", "LOCK", "UNLOCK"],
            mw: [configurable_auth({ optional: true })],
            /**
             * 
             * @param {import("express").Request} req 
             * @param {import("express").Response} res 
             */
            handler: async (req, res) => {
                const svc_token = this.services.get('token');
                const svc_fs = this.services.get('filesystem');
                const svc_su = this.services.get("su")
                let actor = req.actor;
                
                console.log("actor: ", actor)
                // Check if authentication is required (except for OPTIONS)
                if (!actor) {
                    // Check for Basic Authentication header
                    const authHeader = req.headers.authorization;
                    console.error('WebDAV authentication trying:', req.headers.authorization);
                    console.log("all headers: ", req.headers)
                    if (authHeader && authHeader.startsWith('Basic ')) {
                        try {
                            // Parse Basic auth credentials
                            const base64Credentials = authHeader.split(' ')[1];
                            const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
                            const [username, password] = credentials.split(':');
                            console.log("waiting for auth!!")
                            // Call user's authentication function
                            actor = await this.authenticateWebDavUser(username, password, req, res);
                            
                            if (!actor) {
                                // Authentication failed
                                res.set({
                                    'WWW-Authenticate': 'Basic realm="WebDAV"',
                                    'DAV': '1, 2',
                                    'MS-Author-Via': 'DAV'
                                });
                                res.status(401).end('Unauthorized');
                                return;
                            }
                        } catch (error) {
                            console.error('WebDAV authentication error:', error);
                            res.set({
                                'WWW-Authenticate': 'Basic realm="WebDAV"',
                                'DAV': '1, 2',
                                'MS-Author-Via': 'DAV'
                            });
                            res.status(401).end('Unauthorized');
                            return;
                        }
                    } else {
                        // No credentials provided, send challenge
                        res.set({
                            'WWW-Authenticate': 'Basic realm="WebDAV"',
                            'DAV': '1, 2',
                            'MS-Author-Via': 'DAV'
                        });
                        res.status(401).end('Unauthorized');
                        return;
                    }
                }

                let filePath = decodeURIComponent(req.path)
                // Handle root path for WebDAV compatibility
                if (filePath === "/" || filePath === "") {
                  filePath = "/";  // Keep as root for WebDAV
                }
                console.log("url: ", req.path)
                console.log("actor: ", actor)
                console.log("logged the actor")
                svc_su.sudo(actor, async ()=> {
                    const fileNode = await svc_fs.node(new NodePathSelector(filePath));
                    const exists = await fileNode.exists();
                    switch (req.method) {
                        case "GET":
                        case "HEAD":
                            if (!exists) {
                                res.status(404).end('File not found');
                                return;
                            }
                            
                            // Get file stats for Content-Length and other headers
                            const fileStat = await operations.stat(fileNode);
                            
                            // Set appropriate headers
                            const headers = {
                                'Accept-Ranges': 'bytes'
                            };
                            
                            // Set Content-Length for files (not directories)
                            if (!fileStat.is_dir) {
                                headers['Content-Length'] = fileStat.size || 0;
                                headers['Content-Type'] = getProperMimeType(fileStat.type, fileStat.name);
                            }
                            
                            // Set last modified header
                            if (fileStat.modified) {
                                headers['Last-Modified'] = new Date(fileStat.modified * 1000).toUTCString();
                            }
                            
                            // Set ETag
                            headers['ETag'] = `"${fileStat.uid}-${Math.floor(fileStat.modified)}"`;
                            
                            res.set(headers);
                            
                            // For HEAD requests, only send headers, no body
                            if (req.method === "HEAD") {
                                res.status(200).end();
                                break;
                            }
                            
                            // For GET requests, send the file content
                            if (fileStat.is_dir) {
                                res.status(400).end('Cannot GET a directory');
                                return;
                            }
                            
                            const options = {
                                ...(req.headers["range"] ? { range: req.headers["range"] } : {})
                            };

                            const stream = await operations.read(fileNode, options);
                            stream.on("data", (data) => {
                                res.write(data);
                            });
                            stream.on("end", () => {
                                res.end();
                            });
                            stream.on("error", (error) => {
                                console.error("Stream error:", error);
                                res.status(500).end('Internal server error');
                            });
                            break;
                        case "PROPFIND":
                            console.log("PROPFIND FOR " + filePath + " and NODE " + fileNode);
                            
                            // Set proper headers for WebDAV XML response
                            res.set({
                                'Content-Type': 'application/xml; charset=utf-8',
                                'DAV': '1, 2',
                                'MS-Author-Via': 'DAV'
                            });
                            
                            // Handle special case for /dav/ root - return static response with only admin folder
                            if (filePath === "/" || filePath === "") {
                                res.status(207);
                                // res.end(createStaticDavRootResponse());
                                const rootNode = await svc_fs.node(new NodePathSelector("/"));
                                console.log("Current File Path: ", rootNode)
                                res.end(convertMultipleToWebDAVPropfindXML(await operations.stat(rootNode), await operations.readdir(rootNode)));
                                console.log("DONE! (static dav root)");
                                return;
                            }
                            
                            if (!exists) {
                                res.status(404).end('Not Found');
                                return;
                            }
                            
                            // Handle Depth header (Windows WebDAV client compatibility)
                            const depth = req.headers.depth || '1';
                            
                            const stat = await operations.stat(fileNode);
                            if (stat.is_dir && depth !== '0') {
                                res.status(207);
                                res.end(convertMultipleToWebDAVPropfindXML(stat, await operations.readdir(fileNode)));
                                console.log("DONE!")
                            } else {
                                res.status(207);
                                res.end(convertToWebDAVPropfindXML(stat));
                                console.log("DONE! (file)")
                            }
                            break;
                        case "PUT":
                            try {
                                // Check Content-Length header
                                const contentLength = req.headers['content-length'];
                                if (!contentLength) {
                                    res.status(400).end('Content-Length header required');
                                    return;
                                }
                                
                                const fileSize = parseInt(contentLength);
                                if (isNaN(fileSize) || fileSize < 0) {
                                    res.status(400).end('Invalid Content-Length');
                                    return;
                                }
                                
                                // Check if file exists before writing (for proper status code)
                                const existedBefore = exists;
                                
                                // Set Content-Type if provided
                                const contentType = req.headers['content-type'];
                                
                                // Prepare write options
                                const writeOptions = {
                                    stream: req, // Express request object is a readable stream
                                    size: fileSize,
                                    overwrite: true, // PUT should always overwrite
                                    create_missing_parents: true, // Create directories as needed
                                    no_thumbnail: true, // Disable thumbnails for WebDAV
                                };
                                
                                // If Content-Type is provided, include it in file metadata
                                if (contentType) {
                                    writeOptions.file = {
                                        mimetype: contentType
                                    };
                                }
                                
                                // Write the file
                                const result = await operations.write(fileNode, writeOptions);
                                
                                // Set response headers
                                res.set({
                                    'ETag': `"${result.uid}-${Math.floor(result.modified)}"`,
                                    'Last-Modified': new Date(result.modified * 1000).toUTCString()
                                });
                                
                                // Return appropriate status code
                                if (existedBefore) {
                                    res.status(204).end(); // 204 No Content for updated file
                                } else {
                                    res.status(201).end(); // 201 Created for new file
                                }
                                
                                console.log("PUT completed successfully");
                                
                            } catch (error) {
                                console.error("PUT error:", error);
                                
                                // Handle specific error types
                                if (error.code === 'item_with_same_name_exists') {
                                    res.status(409).end('Conflict: Item already exists');
                                } else if (error.code === 'storage_limit_reached') {
                                    res.status(507).end('Insufficient Storage');
                                } else if (error.code === 'permission_denied') {
                                    res.status(403).end('Forbidden');
                                } else if (error.code === 'file_too_large') {
                                    res.status(413).end('Request Entity Too Large');
                                } else {
                                    res.status(500).end('Internal Server Error');
                                }
                            }
                            break;
                        case "MKCOL":
                            try {
                                // Check if request has a body (not allowed for MKCOL)
                                const contentLength = req.headers['content-length'];
                                if (contentLength && parseInt(contentLength) > 0) {
                                    res.status(415).end('Unsupported Media Type');
                                    return;
                                }
                                
                                // Parse the path to get parent directory and target name
                                const targetPath = filePath;
                                const parentPath = path.dirname(targetPath);
                                const targetName = path.basename(targetPath);
                                
                                // Handle root directory case
                                if (parentPath === '.' || targetPath === '/') {
                                    res.status(403).end('Forbidden');
                                    return;
                                }
                                
                                // Check if target already exists
                                if (exists) {
                                    res.status(405).end('Method Not Allowed');
                                    return;
                                }
                                
                                // Get parent directory node
                                const parentNode = await svc_fs.node(new NodePathSelector(parentPath));
                                const parentExists = await parentNode.exists();
                                
                                if (!parentExists) {
                                    res.status(409).end('Conflict');
                                    return;
                                }
                                
                                // Verify parent is a directory
                                const parentStat = await operations.stat(parentNode);
                                if (!parentStat.is_dir) {
                                    res.status(409).end('Conflict');
                                    return;
                                }
                                
                                // Create the directory
                                const result = await operations.mkdir(parentNode, {
                                    name: targetName,
                                    overwrite: false,
                                    create_missing_parents: false
                                });
                                
                                // Set response headers
                                res.set({
                                    'Location': `/dav${targetPath}${targetPath.endsWith('/') ? '' : '/'}`,
                                    'Content-Length': '0'
                                });
                                
                                res.status(201).end(); // 201 Created
                                console.log("MKCOL completed successfully");
                                
                            } catch (error) {
                                console.error("MKCOL error:", error);
                                
                                // Handle specific error types
                                if (error.code === 'item_with_same_name_exists') {
                                    res.status(405).end('Method Not Allowed');
                                } else if (error.code === 'permission_denied') {
                                    res.status(403).end('Forbidden');
                                } else if (error.code === 'dest_does_not_exist') {
                                    res.status(409).end('Conflict');
                                } else if (error.code === 'invalid_file_name') {
                                    res.status(400).end('Bad Request');
                                } else {
                                    res.status(500).end('Internal Server Error');
                                }
                            }
                            break;
                        case "PROPPATCH":
                            // Stub implementation for PROPPATCH - always returns success
                            // Our filesystem doesn't support extended attributes, so we just
                            // pretend that property updates succeed
                            try {
                                // Set proper headers for WebDAV XML response
                                res.set({
                                    'Content-Type': 'application/xml; charset=utf-8',
                                    'DAV': '1, 2',
                                    'MS-Author-Via': 'DAV'
                                });
                                
                                // Return a generic success response
                                // In a real implementation, we would parse the request body and
                                // return specific success/failure for each property
                                const stubResponse = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav${escapeXml(filePath)}</D:href>
    <D:propstat>
      <D:prop/>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
                                
                                res.status(207);
                                res.end(stubResponse);
                                console.log("PROPPATCH completed (stubbed)");
                                
                            } catch (error) {
                                console.error("PROPPATCH error:", error);
                                res.status(500).end('Internal Server Error');
                            }
                            break;
                        case "DELETE":
                            try {
                                // Check if the resource exists
                                if (!exists) {
                                    res.status(404).end('Not Found');
                                    return;
                                }
                                
                                // Delete the resource using operations.delete
                                await operations.delete(fileNode);
                                
                                // Return success response
                                res.status(204).end(); // 204 No Content for successful deletion
                                console.log("DELETE completed successfully");
                                
                            } catch (error) {
                                console.error("DELETE error:", error);
                                
                                // Handle specific error types
                                if (error.code === 'permission_denied') {
                                    res.status(403).end('Forbidden');
                                } else if (error.code === 'immutable') {
                                    res.status(403).end('Forbidden');
                                } else if (error.code === 'dir_not_empty') {
                                    res.status(409).end('Conflict');
                                } else {
                                    res.status(500).end('Internal Server Error');
                                }
                            }
                            break;
                        case "MOVE":
                            try {
                                // Check if the resource exists
                                if (!exists) {
                                    res.status(404).end('Not Found');
                                    return;
                                }
                                
                                // Parse Destination header (required for MOVE)
                                const destinationHeader = req.headers.destination;
                                if (!destinationHeader) {
                                    res.status(400).end('Bad Request: Destination header required');
                                    return;
                                }
                                
                                // Parse destination URI - extract path after /dav
                                let destinationPath;
                                try {
                                    const destUrl = new URL(destinationHeader, `http://${req.headers.host}`);
                                    if (!destUrl.pathname.startsWith('/dav/')) {
                                        res.status(400).end('Bad Request: Destination must be within WebDAV namespace');
                                        return;
                                    }
                                    destinationPath = destUrl.pathname.substring(4); // Remove '/dav' prefix
                                    if (!destinationPath.startsWith('/')) {
                                        destinationPath = '/' + destinationPath;
                                    }
                                } catch (error) {
                                    res.status(400).end('Bad Request: Invalid destination URI');
                                    return;
                                }
                                
                                // Parse Overwrite header (T = true, F = false, default = T)
                                const overwriteHeader = req.headers.overwrite;
                                const overwrite = overwriteHeader !== 'F'; // Default to true unless explicitly F
                                
                                // Parse destination path to get parent and new name
                                const destParentPath = path.dirname(destinationPath);
                                const destName = path.basename(destinationPath);
                                
                                // Check if destination already exists
                                const destNode = await svc_fs.node(new NodePathSelector(destinationPath));
                                const destExists = await destNode.exists();
                                
                                if (destExists && !overwrite) {
                                    res.status(412).end('Precondition Failed: Destination exists and Overwrite is F');
                                    return;
                                }
                                
                                // Get destination parent node
                                const destParentNode = await svc_fs.node(new NodePathSelector(destParentPath));
                                const destParentExists = await destParentNode.exists();
                                
                                if (!destParentExists) {
                                    res.status(409).end('Conflict: Destination parent does not exist');
                                    return;
                                }
                                
                                // Verify destination parent is a directory
                                const destParentStat = await operations.stat(destParentNode);
                                if (!destParentStat.is_dir) {
                                    res.status(409).end('Conflict: Destination parent is not a directory');
                                    return;
                                }
                                
                                // Perform the move operation
                                const result = await operations.move(fileNode, {
                                    destinationNode: destParentNode,
                                    new_name: destName,
                                    overwrite: overwrite,
                                    dedupe_name: false, // WebDAV should not auto-dedupe
                                    create_missing_parents: false
                                });
                                
                                // Set response headers
                                if (destExists) {
                                    res.status(204).end(); // 204 No Content for overwrite
                                } else {
                                    res.status(201).end(); // 201 Created for new resource
                                }
                                
                                console.log("MOVE completed successfully");
                                
                            } catch (error) {
                                console.error("MOVE error:", error);
                                
                                // Handle specific error types
                                if (error.code === 'permission_denied') {
                                    res.status(403).end('Forbidden');
                                } else if (error.code === 'item_with_same_name_exists') {
                                    res.status(412).end('Precondition Failed: Destination exists');
                                } else if (error.code === 'immutable') {
                                    res.status(403).end('Forbidden: Resource is immutable');
                                } else if (error.code === 'dest_does_not_exist') {
                                    res.status(409).end('Conflict: Destination parent does not exist');
                                } else {
                                    res.status(500).end('Internal Server Error');
                                }
                            }
                            break;
                        case "COPY":
                            try {
                                // Check if the resource exists
                                if (!exists) {
                                    res.status(404).end('Not Found');
                                    return;
                                }
                                
                                // Parse Destination header (required for COPY)
                                const destinationHeader = req.headers.destination;
                                if (!destinationHeader) {
                                    res.status(400).end('Bad Request: Destination header required');
                                    return;
                                }
                                
                                // Parse destination URI - extract path after /dav
                                let destinationPath;
                                try {
                                    const destUrl = new URL(destinationHeader, `http://${req.headers.host}`);
                                    if (!destUrl.pathname.startsWith('/dav/')) {
                                        res.status(400).end('Bad Request: Destination must be within WebDAV namespace');
                                        return;
                                    }
                                    destinationPath = destUrl.pathname.substring(4); // Remove '/dav' prefix
                                    if (!destinationPath.startsWith('/')) {
                                        destinationPath = '/' + destinationPath;
                                    }
                                } catch (error) {
                                    res.status(400).end('Bad Request: Invalid destination URI');
                                    return;
                                }
                                
                                // Parse Overwrite header (T = true, F = false, default = T)
                                const overwriteHeader = req.headers.overwrite;
                                const overwrite = overwriteHeader !== 'F'; // Default to true unless explicitly F
                                
                                // Parse destination path to get parent and new name
                                const destParentPath = path.dirname(destinationPath);
                                const destName = path.basename(destinationPath);
                                
                                // Check if destination already exists
                                const destNode = await svc_fs.node(new NodePathSelector(destinationPath));
                                const destExists = await destNode.exists();
                                
                                if (destExists && !overwrite) {
                                    res.status(412).end('Precondition Failed: Destination exists and Overwrite is F');
                                    return;
                                }
                                
                                // Get destination parent node
                                const destParentNode = await svc_fs.node(new NodePathSelector(destParentPath));
                                const destParentExists = await destParentNode.exists();
                                
                                if (!destParentExists) {
                                    res.status(409).end('Conflict: Destination parent does not exist');
                                    return;
                                }
                                
                                // Verify destination parent is a directory
                                const destParentStat = await operations.stat(destParentNode);
                                if (!destParentStat.is_dir) {
                                    res.status(409).end('Conflict: Destination parent is not a directory');
                                    return;
                                }
                                
                                // Perform the copy operation
                                const result = await operations.copy(fileNode, {
                                    destinationNode: destParentNode,
                                    new_name: destName,
                                    overwrite: overwrite,
                                    dedupe_name: false, // WebDAV should not auto-dedupe
                                });
                                
                                // Set response headers
                                if (destExists) {
                                    res.status(204).end(); // 204 No Content for overwrite
                                } else {
                                    res.status(201).end(); // 201 Created for new resource
                                }
                                
                                console.log("COPY completed successfully");
                                
                            } catch (error) {
                                console.error("COPY error:", error);
                                
                                // Handle specific error types
                                if (error.code === 'permission_denied') {
                                    res.status(403).end('Forbidden');
                                } else if (error.code === 'item_with_same_name_exists') {
                                    res.status(412).end('Precondition Failed: Destination exists');
                                } else if (error.code === 'immutable') {
                                    res.status(403).end('Forbidden: Resource is immutable');
                                } else if (error.code === 'dest_does_not_exist') {
                                    res.status(409).end('Conflict: Destination parent does not exist');
                                } else {
                                    res.status(500).end('Internal Server Error');
                                }
                            }
                            break;
                        case "LOCK":
                            // Stub implementation for LOCK - always returns a fake lock token
                            // Puter doesn't support file locking, so we pretend to lock successfully
                            try {
                                // Check if the resource exists
                                if (!exists) {
                                    res.status(404).end('Not Found');
                                    return;
                                }
                                
                                // Generate a fake lock token
                                const lockToken = `opaquelocktoken:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                                
                                // Set proper headers for WebDAV XML response
                                res.set({
                                    'Content-Type': 'application/xml; charset=utf-8',
                                    'Lock-Token': `<${lockToken}>`,
                                    'DAV': '1, 2',
                                    'MS-Author-Via': 'DAV'
                                });
                                
                                // Return a fake lock response
                                const lockResponse = `<?xml version="1.0" encoding="utf-8"?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:exclusive/></D:lockscope>
      <D:depth>0</D:depth>
      <D:owner>
        <D:href>webdav-user</D:href>
      </D:owner>
      <D:timeout>Second-7200</D:timeout>
      <D:locktoken>
        <D:href>${lockToken}</D:href>
      </D:locktoken>
      <D:lockroot>
        <D:href>/dav${escapeXml(filePath)}</D:href>
      </D:lockroot>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>`;
                                
                                res.status(200);
                                res.end(lockResponse);
                                console.log("LOCK completed (stubbed)");
                                
                            } catch (error) {
                                console.error("LOCK error:", error);
                                res.status(500).end('Internal Server Error');
                            }
                            break;
                        case "UNLOCK":
                            // Stub implementation for UNLOCK - always returns success
                            // Puter doesn't support file locking, so we pretend to unlock successfully
                            try {
                                // Check if the resource exists
                                if (!exists) {
                                    res.status(404).end('Not Found');
                                    return;
                                }
                                
                                // Check for Lock-Token header (normally required for UNLOCK)
                                const lockToken = req.headers['lock-token'];
                                if (!lockToken) {
                                    res.status(400).end('Bad Request: Lock-Token header required');
                                    return;
                                }
                                
                                // Always return success since we don't actually track locks
                                res.status(204).end(); // 204 No Content for successful unlock
                                console.log("UNLOCK completed (stubbed)");
                                
                            } catch (error) {
                                console.error("UNLOCK error:", error);
                                res.status(500).end('Internal Server Error');
                            }
                            break;
                        default:
                            // Method not allowed
                            res.set({
                                'Allow': 'OPTIONS, GET, HEAD, POST, PUT, DELETE, COPY, MOVE, MKCOL, PROPFIND, PROPPATCH, LOCK, UNLOCK',
                                'DAV': '1, 2',
                                'MS-Author-Via': 'DAV'
                            });
                            res.status(405).end('Method Not Allowed');
                            break;
                    }
                })
                
            }

        }).attach(r_webdav);

        const r_rootdav = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router();
        })();
        app.use('/', r_rootdav);
        Endpoint({
            route: '/',
            methods: ["PROPFIND"],
            mw: [configurable_auth({ optional: true })],
            /**
             * 
             * @param {import("express").Request} req 
             * @param {import("express").Response} res 
             */
            handler: async (req, res) => {
                console.log("GOT A ROOT DAV REQ")
                let actor = req.actor;
                
                // Check if authentication is required
                if (!actor) {
                    // Check for Basic Authentication header
                    const authHeader = req.headers.authorization;
                    if (authHeader && authHeader.startsWith('Basic ')) {
                        try {
                            // Parse Basic auth credentials
                            const base64Credentials = authHeader.split(' ')[1];
                            const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
                            const [username, password] = credentials.split(':');
                            
                            // Call user's authentication function
                            actor = await this.authenticateWebDavUser(username, password, req, res);
                            
                            if (!actor) {
                                // Authentication failed
                                res.set({
                                    'WWW-Authenticate': 'Basic realm="WebDAV"',
                                    'DAV': '1, 2',
                                    'MS-Author-Via': 'DAV'
                                });
                                res.status(401).end('Unauthorized');
                                return;
                            }
                        } catch (error) {
                            console.error('WebDAV authentication error:', error);
                            res.set({
                                'WWW-Authenticate': 'Basic realm="WebDAV"',
                                'DAV': '1, 2',
                                'MS-Author-Via': 'DAV'
                            });
                            res.status(401).end('Unauthorized');
                            return;
                        }
                    } else {
                        // No credentials provided, send challenge
                        res.set({
                            'WWW-Authenticate': 'Basic realm="WebDAV"',
                            'DAV': '1, 2',
                            'MS-Author-Via': 'DAV'
                        });
                        res.status(401).end('Unauthorized');
                        return;
                    }
                }
                
                // Set proper headers for WebDAV XML response
                res.set({
                    'Content-Type': 'application/xml; charset=utf-8',
                    'DAV': '1, 2',
                    'MS-Author-Via': 'DAV'
                });
                
                res.status(207);
                res.end(createRootWebDAVResponse());

            }

        }).attach(r_rootdav);
    }
}

module.exports = {
    WebDavFS,
};
