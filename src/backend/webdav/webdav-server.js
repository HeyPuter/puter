const webdav = require('webdav-server').v2;
const bcrypt = require('bcrypt');
const express = require('express');
const { FSNodeContext } = require('../src/filesystem/FSNodeContext.js');
const { PuterFSProvider } = require('../src/modules/puterfs/lib/PuterFSProvider.js');
const { get_user } = require('../src/helpers');
const path = require('path');

class PuterFileSystem extends webdav.FileSystem {
    constructor(fsProvider, user, Context) {
        super("puter", { uid: 1, gid: 1 });
        this.fsProvider = fsProvider;
        this.user = user;
        this.Context = Context;
    }

    _getPath(filePath) {
        return path.normalize(filePath);
    }

    async _getFSNode(filePath) {
        const normalizedPath = this._getPath(filePath);
        return new FSNodeContext({
            services: this.Context.get('services'),
            selector: { path: normalizedPath },
            provider: this.fsProvider,
            fs: { node: this._getFSNode }
        });
    }

    // Implement required WebDAV methods
    async _openReadStream(ctx, filePath, callback) {
        try {
            const node = await this._getFSNode(filePath);
            const stream = await node.read();
            callback(null, stream);
        } catch (e) {
            callback(e);
        }
    }

    async _openWriteStream(ctx, filePath, callback) {
        try {
            const node = await this._getFSNode(filePath);
            const stream = await node.write();
            callback(null, stream);
        } catch (e) {
            callback(e);
        }
    }

    async _create(ctx, filePath, type, callback) {
        try {
            const node = await this._getFSNode(filePath);
            if (type === webdav.ResourceType.Directory) {
                await node.mkdir();
            } else {
                await node.create();
            }
            callback();
        } catch (e) {
            callback(e);
        }
    }

    async _delete(ctx, filePath, callback) {
        try {
            const node = await this._getFSNode(filePath);
            await node.delete();
            callback();
        } catch (e) {
            callback(e);
        }
    }

    // Implement other required methods (size, lastModifiedDate, etc.)
    async _size(ctx, filePath, callback) {
        try {
            const node = await this._getFSNode(filePath);
            const size = await node.size();
            callback(null, size);
        } catch (e) {
            callback(e);
        }
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
    // Initialize Puter filesystem components
    const services = Context.get('services');
    const fsProvider = new PuterFSProvider(services);
    const puterFS = new PuterFileSystem(fsProvider, null, Context);

    const server = new webdav.WebDAVServer({
        port: port,
        autoSave: false,
        rootFileSystem: puterFS  // Use Puter filesystem as root
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
            next();
        } catch (error) {
            console.error('Authentication error:', error);
            res.status(500).send('Internal server error');
        }
    });
    // Mount WebDAV server
    app.use(webdav.extensions.express('/webdav', server));

    // Start server
    app.listen(port, () => {
        console.log(`Puter WebDAV server running on port ${port}`);
        console.log(`Access via: http://puter.localhost:${port}/webdav`);
    });

    return server;
}

module.exports = {
    startWebDAVServer
};