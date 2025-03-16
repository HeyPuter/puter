const webdav = require('webdav-server').v2;
const bcrypt = require('bcrypt');
const express = require('express');
const FSNodeContext = require('../src/filesystem/FSNodeContext.js');
const { PuterFSProvider } = require('../src/modules/puterfs/lib/PuterFSProvider.js');
const { get_user } = require('../src/helpers');
const path = require('path');
const APIError = require('../src/api/APIError.js');
const { NodePathSelector } = require('../src/filesystem/node/selectors'); // Import NodePathSelector

class PuterFileSystem extends webdav.FileSystem {
    constructor(fsProvider, Context) {
/**
 * Initializes a new instance of the PuterFileSystem class.
 *
 * @param {PuterFSProvider} fsProvider - The file system provider instance.
 * @param {Context} Context - The context containing configuration and services.
 */

        super("puter", { uid: 1, gid: 1 });
        this.fsProvider = fsProvider;
        this.Context = Context;
        this.services = Context.get('services');
    }

    _getPath(filePath) {
        try {
            if (typeof filePath !== 'string') {
                filePath = filePath.toString();
            }
            return path.resolve('/', filePath).replace(/\.\./g, '');
        } catch (e) {
            console.error("error in _getPath", e);
            throw e;
        }
    }

    async getFSNode(filePath) {
        const normalizedPath = this._getPath(filePath);
        return new FSNodeContext({
            services: this.services,
            selector: new NodePathSelector(normalizedPath), // Use NodePathSelector instance
            provider: this.fsProvider,
            fs: this.services.get('filesystem')
        });
    }

    async _type(ctx, filePath, callback) {
        try {
            const node = await this.getFSNode(filePath);
            const exists = await node.exists();
            if (!exists) {
                return callback(webdav.Errors.ResourceNotFound);
            }
            const isDir = await node.get('is_dir');
            callback(null, isDir ? webdav.ResourceType.Directory : webdav.ResourceType.File);
        } catch (e) {
            this._mapError(e, callback, '_type');
        }
    }

    async _exist(ctx, filePath, callback) {
        try {
            const node = await this.getFSNode(filePath);
            const exists = await node.exists();
            callback(null, exists);
        } catch (e) {
            this._mapError(e, callback, '_exist');
        }
    }

    async _openReadStream(ctx, filePath, callback) {
        try {
            const node = await this.getFSNode(filePath);
            if (await node.get('is_dir')) {
                return callback(webdav.Errors.IsADirectory);
            }
            const content = await this.services.get('filesystem').read(node);
            callback(null, content);
        } catch (e) {
            this._mapError(e, callback, '_openReadStream');
        }
    }

    async _openWriteStream(ctx, filePath, callback) {
        try {
            const node = await this.getFSNode(filePath);
            const parentPath = path.dirname(filePath);
            const parentNode = await this.getFSNode(parentPath);

            return callback(null, {
                write: async (content) => {
                    await this.services.get('filesystem').write(node, content, {
                        parent: parentNode,
                        name: path.basename(filePath)
                    });
                },
                end: callback
            });
        } catch (e) {
            this._mapError(e, callback, '_openWriteStream');
        }
    }

    async _create(ctx, filePath, type, callback) {
        try {
            console.log('Create operation is called for:', filePath);
            const parentPath = path.dirname(filePath);
            const name = path.basename(filePath);
            const parentNode = await this.getFSNode(parentPath);
            if (type === webdav.ResourceType.Directory) {
                console.log('making directory: ', name);
                await this.services.get('filesystem').mkdir(parentNode, name);
            } else {
                await this.services.get('filesystem').write(
                    { path: filePath },
                    Buffer.alloc(0),
                    { parent: parentNode, name }
                );
            }
            callback();
        } catch (e) {
            this._mapError(e, callback, '_create');
        }
    }

    async _delete(ctx, filePath, callback) {
        try {
            const node = await this.getFSNode(filePath);
            if (await node.get('is_dir')) {
                await this.services.get('filesystem').rmdir(node);
            } else {
                await this.services.get('filesystem').unlink(node);
            }
            callback();
        } catch (e) {
            this._mapError(e, callback, '_delete');
        }
    }

    async _size(ctx, filePath, callback) {
        try {
            const node = await this.getFSNode(filePath);
            const size = await node.get('size');
            callback(null, size || 0);
        } catch (e) {
            this._mapError(e, callback, '_size');
        }
    }

    async _lastModifiedDate(ctx, filePath, callback) {
        try {
            const node = await this.getFSNode(filePath);
            const modified = await node.get('modified');
            callback(null, modified ? new Date(modified * 1000) : new Date());
        } catch (e) {
            this._mapError(e, callback, '_lastModifiedDate');
        }
    }

    async _move(ctx, srcPath, destPath, callback) {
        try {
            const srcNode = await this.getFSNode(srcPath);
            const destParent = await this.getFSNode(path.dirname(destPath));
            await this.services.get('filesystem').move(
                srcNode,
                destParent,
                path.basename(destPath)
            );
            callback();
        } catch (e) {
            this._mapError(e, callback, '_move');
        }
    }

    async _copy(ctx, srcPath, destPath, callback) {
        try {
            const srcNode = await this.getFSNode(srcPath);
            const destParent = await this.getFSNode(path.dirname(destPath));
            await this.services.get('filesystem').copy(
                srcNode,
                destParent,
                path.basename(destPath)
            );
            callback();
        } catch (e) {
            this._mapError(e, callback, '_copy');
        }
    }

    async _propertyManager(ctx, filePath, callback) {
        callback(null, {
            getProperties: async (name, callback) => {
                try {
                    const node = await this.getFSNode(filePath);
                    const entry = await node.fetchEntry();
                    callback(null, {
                        displayname: entry.name,
                        getlastmodified: new Date(entry.modified * 1000).toUTCString(),
                        getcontentlength: entry.size || '0',
                        resourcetype: entry.is_dir ? ['collection'] : [],
                        getcontenttype: entry.mime_type || 'application/octet-stream'
                    });
                } catch (e) {
                    this._mapError(e, callback, '_propertyManager');
                }
            }
        });
    }

    _mapError(e, callback, methodName) {
        console.error('WebDAV operation error:', e);
        if (e instanceof APIError) {
            switch (e.code) {
                case 'not_found': return callback(webdav.Errors.ResourceNotFound);
                case 'item_with_same_name_exists': return callback(webdav.Errors.InvalidOperation);
                case 'not_empty': return callback(webdav.Errors.Forbidden);
                default: return callback(webdav.Errors.InternalError);
            }
        }
        if (e instanceof TypeError && e.message.includes('Cannot read properties of undefined (reading \'isDirectory\')')) {
            return callback(webdav.Errors.InternalServerError);
        }
        return callback(e);
    }
}

async function validateUser(username, password, Context) {
    try {
        const services = Context.get('services');

        // Fetch user from Puter's authentication service
        const user = await get_user({ username, cached: false });
        if (!user) {
            console.log(`Authentication failed: User '${username}' not found.`);
            return null;
        }

        // Validate password with bcrypt
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            console.log(`Authentication failed: Incorrect password.`);
            return null;
        }

        console.log(`Authentication successful for user: ${username}`);
        return user;
    } catch (error) {
        console.error('Error during authentication:', error);
        return null;
    }
}

async function startWebDAVServer(port, Context) {
    const app = express();
    const fsProvider = new PuterFSProvider(Context.get('services'));
    const puterFS = new PuterFileSystem(fsProvider, Context);

    const server = new webdav.WebDAVServer({
        rootFileSystem: puterFS,
        autoSave: false,
        strictMode: false
    });

    // Add the missing functions to the PuterFileSystem prototype
    PuterFileSystem.prototype.type = PuterFileSystem.prototype._type;
    PuterFileSystem.prototype.exist = PuterFileSystem.prototype._exist;
    PuterFileSystem.prototype.create = PuterFileSystem.prototype._create;
    PuterFileSystem.prototype.delete = PuterFileSystem.prototype._delete;
    PuterFileSystem.prototype.openReadStream = PuterFileSystem.prototype._openReadStream;
    PuterFileSystem.prototype.openWriteStream = PuterFileSystem.prototype._openWriteStream;
    PuterFileSystem.prototype.size = PuterFileSystem.prototype._size;
    PuterFileSystem.prototype.lastModifiedDate = PuterFileSystem.prototype._lastModifiedDate;
    PuterFileSystem.prototype.move = PuterFileSystem.prototype._move;
    PuterFileSystem.prototype.copy = PuterFileSystem.prototype._copy;
    PuterFileSystem.prototype.propertyManager = PuterFileSystem.prototype._propertyManager;

    server.beforeRequest((ctx, next) => {
        ctx.response.setHeader('MS-Author-Via', 'DAV');
        next();
    });

    // Authentication middleware
    app.use(async (req, res, next) => {
        const authHeader = req.headers.authorization;

        const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
        const [username, password] = credentials.split(':');

        try {
            const user = await validateUser(username, password, Context);
            if (!user) return res.status(401).send('Invalid credentials');
            req.user = user;
            delete req.headers.authorization;
            next();
        } catch (error) {
            console.error('Authentication error:', error);
            res.status(500).send('Internal server error');
        }
    });

    app.use('/webdav', webdav.extensions.express('/', server));

    app.listen(port, () => {
        console.log(`Puter WebDAV server running on port ${port}`);
    });

    return server;
}

module.exports = { startWebDAVServer };