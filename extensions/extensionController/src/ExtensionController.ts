import type { RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import type {
    EndpointOptions,
    HttpMethod,
    RouterMethods,
} from '../../api.d.ts';
/**
 * Class decorator to set prefix on prototype and register routes on instantiation
 * @argument prefix - prefix for all routes under the class
 * @argument [adminUsernames] - gate all routes behind admin username check
 */
export const Controller = (
    prefix: string,
    adminUsernames?: string[],
): ClassDecorator => {
    return (target: Function) => {
        target.prototype.__controllerPrefix = prefix;
        target.prototype.__adminUsernames = adminUsernames
            ? [...adminUsernames, 'admin', 'system']
            : undefined;
    };
};

/**
 * Method decorator factory that collects route metadata
 */
interface RouteMeta {
    method: HttpMethod;
    path: string;
    options?: EndpointOptions | undefined;
    handler: RequestHandler;
    adminUsernames?: string[];
}

const createMethodDecorator = (method: HttpMethod) => {
    return <This>(
        path: string,
        options?: EndpointOptions,
        adminUsernames?: string[],
    ) => {
        return <
            P extends Record<string, string | undefined> = Record<
                string,
        string | undefined
            >,
        >(
            target: RequestHandler<P>,
            _context: ClassMethodDecoratorContext<
                This,
                (
                    this: This,
                    ...args: Parameters<RequestHandler<P>>
                ) => ReturnType<RequestHandler<P>>
            >,
        ) => {
            _context.addInitializer(function () {
                // eslint-disable-next-line no-invalid-this
                const proto = Object.getPrototypeOf(this); // will be bound to class
                if ( ! proto.__routes ) {
                    proto.__routes = [];
                }
                proto.__routes.push({
                    method,
                    path,
                    options: options as EndpointOptions | undefined,
                    adminUsernames: adminUsernames
                        ? [...adminUsernames, 'admin', 'system']
                        : undefined,
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

export class HttpError extends Error {
    statusCode: number;
    constructor (statusCode: StatusCodes, message: string, cause?: unknown) {
        super(`${statusCode} - ${message}`, { cause });
        this.statusCode = statusCode;
    }
}

// Registers all routes from a decorated controller instance to an Express router
export class ExtensionController {
    // TODO DS: make this work with other express-like routers
    registerRoutes () {
        const prefix = Object.getPrototypeOf(this).__controllerPrefix || '';
        const adminsForController = Object.getPrototypeOf(this).__adminUsernames as
            | string[]
            | undefined;
        const routes: RouteMeta[] = Object.getPrototypeOf(this).__routes || [];
        for ( const route of routes ) {
            const fullPath = `${prefix}/${route.path}`.replace(/\/+/g, '/');
            const adminsForRoute = route.adminUsernames
                ? adminsForController
                    ? adminsForController.concat(route.adminUsernames)
                    : route.adminUsernames
                : adminsForController
                    ? adminsForController
                    : undefined;
            if ( ! extension[route.method] ) {
                throw new Error(`Unsupported HTTP method: ${route.method}`);
            } else {
                console.log(`Registering route: [${route.method.toUpperCase()}] ${fullPath}`);

                (extension[route.method] as RouterMethods[HttpMethod])(
                                fullPath,
                                route.options || {},
                                async (req, res, next) => {
                                    try {
                                        if ( adminsForRoute ) {
                                            if ( ! adminsForRoute.includes(req.actor.type.user.username) ) {
                                                throw new HttpError(StatusCodes.UNAUTHORIZED,
                                                                'Only admins may request this resource.');
                                            }
                                        }
                                        await route.handler.bind(this)(req, res, next);
                                    } catch ( error ) {
                                        if ( error instanceof HttpError ) {
                                            res.status(error.statusCode).send({ error: error.message });
                                            console.error('httpError:', error);
                                            return;
                                        }
                                        if ( error instanceof Error ) {
                                            res
                                                .status(StatusCodes.INTERNAL_SERVER_ERROR)
                                                .send({ error: error.message });
                                            console.error('Non-http error:', error);
                                            return;
                                        }
                                        res
                                            .status(StatusCodes.INTERNAL_SERVER_ERROR)
                                            .send({ error: 'An unknown error occurred' });
                                        console.error('An unknown error occurred:', error);
                                    }
                                });
            }
        }
    }
}
