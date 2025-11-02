import type { Request, Response } from 'express';
import type { EndpointOptions, HttpMethod } from '../../api.d.ts';

/**
 * Controller decorator to set prefix on prototype and register routes on instantiation
 */
export const Controller = (prefix: string): ClassDecorator => {
    return (target: Function) => {
        target.prototype.__controllerPrefix = prefix;
    };
};

/**
 * Method decorator factory that collects route metadata
 */
interface RouteMeta {
    method: HttpMethod;
    path: string;
    options?: EndpointOptions | undefined;
    handler: (req: Request, res: Response)=> void | Promise<void>;
}

const createMethodDecorator = <This>(method: HttpMethod) => {
    return (path: string, options?: EndpointOptions) => {

        return (target: (req: Request, res: Response)=> void | Promise<void>, _context: ClassMethodDecoratorContext<This, (this:This, ...args:[req: Request, res: Response])=> void | Promise<void>>) => {

            _context.addInitializer(function()  {
                const proto = Object.getPrototypeOf(this);
                if ( !proto.__routes ) {
                    proto.__routes = [];
                }
                proto.__routes.push({
                    method,
                    path,
                    options: options as EndpointOptions | undefined,
                    handler: target,
                });
            });

        };
    };
};

// HTTP method decorators
export const Get = createMethodDecorator('get');
export const Post = createMethodDecorator('post');
export const Put = createMethodDecorator('put');
export const Delete = createMethodDecorator('delete');
// TODO DS: add others as needed (patch, etc)

// Registers all routes from a decorated controller instance to an Express router

export class ExtensionController {

    // TODO DS: make this work with other express-like routers
    registerRoutes() {
        const prefix = Object.getPrototypeOf(this).__controllerPrefix || '';
        const routes: RouteMeta[] = Object.getPrototypeOf(this).__routes || [];
        for ( const route of routes ) {
            const fullPath = `${prefix}/${route.path}`.replace(/\/+/g, '/');
            if ( !extension[route.method] ){
                throw new Error(`Unsupported HTTP method: ${route.method}`);
            } else {
                console.log(`Registering route: [${route.method.toUpperCase()}] ${fullPath}`);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (extension[route.method] as any)(fullPath, route.options, route.handler.bind(this));
            }
        }
    }
}
