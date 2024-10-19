import putility from "@heyputer/putility";

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
            async do () {
                console.log('do() was called');
                this.initializeSocket();
            }
        }
    ]

    _init () {
        console.log('does this init get called');
        this.initializeSocket();
    }

    initializeSocket () {
        console.log('THIS IS RUNNING');
        if (this.socket) {
            this.socket.disconnect();
        }

        this.socket = io(this.APIOrigin, {
            auth: {
                auth_token: this.authToken,
            }
        });

        this.bindSocketEvents();
    }

    bindSocketEvents() {
        this.socket.on('connect', () => {
            if(puter.debugMode)
                console.log('FileSystem Socket: Connected', this.socket.id);
        });

        this.socket.on('disconnect', () => {
            if(puter.debugMode)
                console.log('FileSystem Socket: Disconnected');
        });

        this.socket.on('reconnect', (attempt) => {
            if(puter.debugMode)
                console.log('FileSystem Socket: Reconnected', this.socket.id);
        });

        this.socket.on('reconnect_attempt', (attempt) => {
            if(puter.debugMode)
                console.log('FileSystem Socket: Reconnection Attemps', attempt);
        });

        this.socket.on('reconnect_error', (error) => {
            if(puter.debugMode)
                console.log('FileSystem Socket: Reconnection Error', error);
        });

        this.socket.on('reconnect_failed', () => {
            if(puter.debugMode)
                console.log('FileSystem Socket: Reconnection Failed');
        });

        this.socket.on('error', (error) => {
            if(puter.debugMode)
                console.error('FileSystem Socket Error:', error);
        });
    }
}
