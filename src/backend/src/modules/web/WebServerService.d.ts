import { Server } from 'http';
import BaseService from '../../services/BaseService';

/**
 * WebServerService is responsible for starting and managing the Puter web server.
 */
export class WebServerService extends BaseService {
    /**
     * Allow requests with undefined Origin header for a specific route.
     * @param route The route (string or RegExp) to allow.
     */
    allow_undefined_origin (route: string | RegExp): void;

    /**
     * Returns the underlying HTTP server instance.
     */
    get_server (): Server;
}

export = WebServerService;