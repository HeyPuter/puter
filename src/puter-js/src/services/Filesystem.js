import putility from '@heyputer/putility';
import { PuterAPIFilesystem } from '../lib/filesystem/APIFS.js';
import { CachedFilesystem } from '../lib/filesystem/CacheFS.js';
import { ProxyFilesystem, TFilesystem } from '../lib/filesystem/definitions.js';
import { PostMessageFilesystem } from '../lib/filesystem/PostMessageFS.js';
import io from '../lib/socket.io/socket.io.esm.min.js';

export class FilesystemService extends putility.concepts.Service {
    static PROPERTIES = {
        // filesystem:
    };

    static DEPENDS = ['api-access'];
    static HOOKS = [
        {
            service: 'api-access',
            event: 'update',
            description: `
                re-initialize the socket connection whenever the
                authentication token or API origin is changed.
            `,
            async do() {
                this.initializeSocket();
            },
        },
    ];

    _init() {
        const env = this._.context.env;

        if ( env === 'app' ) {
            // TODO: uncomment when relay is ready
            // this.init_app_fs_();

            this.init_top_fs_();
        } else {
            this.init_top_fs_();
        }

        this.initializeSocket();
    }

    init_app_fs_() {
        this.fs_nocache_ = new PostMessageFilesystem({
            messageTarget: globalThis.parent,
            rpc: this._.context.util.rpc,
        }).as(TFilesystem);
        this.filesystem = this.fs_nocache_;
    }
    init_top_fs_() {
        const api_info = this._.context.services.get('api-access').get_api_info();
        this.fs_nocache_ = new PuterAPIFilesystem({ api_info }).as(TFilesystem);
        this.fs_cache_ = new CachedFilesystem({ delegate: this.fs_nocache_ }).as(TFilesystem);
        // this.filesystem = this.fs_nocache;
        this.fs_proxy_ = new ProxyFilesystem({ delegate: this.fs_nocache_ });
        this.filesystem = this.fs_proxy_.as(TFilesystem);
    }

    cache_on() {
        this.fs_proxy_.delegate = this.fs_cache_;
    }
    cache_off() {
        this.fs_proxy_.delegate = this.fs_nocache_;
    }

    async initializeSocket() {
        if ( this.socket ) {
            this.socket.disconnect();
        }

        const svc_apiAccess = this._.context.services.get('api-access');
        const api_info = svc_apiAccess.get_api_info();

        if ( api_info.api_origin === undefined ) {
            // This will get called again later with updated information
            return;
        }

        this.socket = io(api_info.api_origin, {
            auth: { auth_token: api_info.auth_token },
            autoUnref: this._.context.env === 'nodejs',
        });

        this.bindSocketEvents();
    }

    bindSocketEvents() {
        this.socket.on('connect', () => {
            if ( puter.debugMode )
            {
                console.log('FileSystem Socket: Connected', this.socket.id);
            }
        });

        this.socket.on('disconnect', () => {
            if ( puter.debugMode )
            {
                console.log('FileSystem Socket: Disconnected');
            }
        });

        this.socket.on('reconnect', (attempt) => {
            if ( puter.debugMode )
            {
                console.log('FileSystem Socket: Reconnected', this.socket.id);
            }
        });

        this.socket.on('reconnect_attempt', (attempt) => {
            if ( puter.debugMode )
            {
                console.log('FileSystem Socket: Reconnection Attemps', attempt);
            }
        });

        this.socket.on('reconnect_error', (error) => {
            if ( puter.debugMode )
            {
                console.log('FileSystem Socket: Reconnection Error', error);
            }
        });

        this.socket.on('reconnect_failed', () => {
            if ( puter.debugMode )
            {
                console.log('FileSystem Socket: Reconnection Failed');
            }
        });

        this.socket.on('error', (error) => {
            if ( puter.debugMode )
            {
                console.error('FileSystem Socket Error:', error);
            }
        });
    }
}
