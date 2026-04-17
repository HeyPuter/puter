import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type {
    EndpointOptions,
    HttpMethod,
    RouterMethods,
} from '../../api.ts';
declare const extension: Partial<Record<HttpMethod, RouterMethods[HttpMethod]>>;
/**
 * Class decorator to set prefix on prototype and register routes on instantiation
 * @argument prefix - prefix for all routes under the class
 * @argument [adminUsernames] - gate all routes behind admin username check
 */
export const Controller = (
    prefix: string,
    adminUsernames?: string[],
    allowedAppIds?: string[],
): ClassDecorator => {
    return (target: Function) => {
        target.prototype.__controllerPrefix = prefix;
        target.prototype.__allowedAppIds = allowedAppIds;
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
    handler: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
    adminUsernames?: string[];
    allowedAppIds?: string[];
}

const createMethodDecorator = (method: HttpMethod) => {
    return <This>(
        path: string,
        routeOptions?: EndpointOptions & { allowedAppIds?: string[] },
        adminUsernames?: string[],
    ) => {
        const { allowedAppIds, ...options } = routeOptions ?? {};
        return (
            target: (req: Request, res: Response, next: NextFunction) => void | Promise<void>,
            _context: ClassMethodDecoratorContext<
                This,
                (
                    this: This,
                    ...args: [req: Request, res: Response, next: NextFunction]
                ) => void | Promise<void>
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
                    allowedAppIds,
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

interface HttpErrorOptions {
    cause?: unknown;
    legacyCode?: string;
    code?: string;
    fields?: Record<string, unknown>;
}

const isHttpErrorOptions = (value: unknown): value is HttpErrorOptions => {
    if ( !value || typeof value !== 'object' || Array.isArray(value) ) {
        return false;
    }

    return (
        Object.prototype.hasOwnProperty.call(value, 'cause')
        || Object.prototype.hasOwnProperty.call(value, 'legacyCode')
        || Object.prototype.hasOwnProperty.call(value, 'code')
        || Object.prototype.hasOwnProperty.call(value, 'fields')
    );
};

export class HttpError extends Error {
    statusCode: number;
    legacyCode?: string;
    code?: string;
    fields?: Record<string, unknown>;
    constructor (
        statusCode: StatusCodes,
        message: string,
        causeOrOptions?: unknown,
        legacyCode?: string,
    ) {
        const options = isHttpErrorOptions(causeOrOptions)
            ? causeOrOptions
            : undefined;
        const cause = options
            ? options.cause
            : causeOrOptions;
        const resolvedLegacyCode = legacyCode ?? options?.legacyCode;
        const code = options?.code;
        super(
            `${statusCode} - ${message}`,
            cause !== undefined ? { cause } : undefined,
        );
        this.statusCode = statusCode;
        this.legacyCode = resolvedLegacyCode;
        this.code = code;
        this.fields = options?.fields;
    }
}

// Registers all routes from a decorated controller instance to an Express router
export class ExtensionController {
    logger?: Console;
    // TODO DS: make this work with other express-like routers
    registerRoutes () {
        const logger = this.logger || console;
        const prefix = Object.getPrototypeOf(this).__controllerPrefix || '';
        const adminsForController = Object.getPrototypeOf(this).__adminUsernames as
            | string[]
            | undefined;
        const allowedAppIdsForController = Object.getPrototypeOf(this).__allowedAppIds as
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
            const allowedAppIds = route.allowedAppIds
                ? allowedAppIdsForController
                    ? allowedAppIdsForController.concat(route.allowedAppIds)
                    : route.allowedAppIds
                : allowedAppIdsForController
                    ? allowedAppIdsForController
                    : undefined;

            if ( ! extension[route.method] ) {
                throw new Error(`Unsupported HTTP method: ${route.method}`);
            } else {
                logger.log(`Registering route: [${route.method.toUpperCase()}] ${fullPath}`);

                (extension[route.method] as RouterMethods[HttpMethod])(
                    fullPath,
                    route.options || {},
                    async (req, res, next) => {
                        try {
                            if ( adminsForRoute || allowedAppIds ) {
                                if ( ! req.actor ) {
                                    throw new HttpError(StatusCodes.UNAUTHORIZED, 'Unauthenticated');
                                }
                            }
                            if ( adminsForRoute ) {
                                if ( ! adminsForRoute.includes(req.actor!.type.user.username) ) {
                                    throw new HttpError(
                                        StatusCodes.FORBIDDEN,
                                        'Only admins may request this resource.',
                                    );
                                }
                            }
                            if ( allowedAppIds ) {
                                if ( ( req.actor!.type?.app?.uid && !allowedAppIds.includes(req.actor!.type.app.uid) ) ) {
                                    throw new HttpError(
                                        StatusCodes.FORBIDDEN,
                                        'This app may not request this resource.',
                                    );
                                }
                            }
                            return await route.handler.bind(this)(req, res, next);
                        } catch ( error ) {
                            if ( error instanceof HttpError ) {
                                const payload: Record<string, unknown> = {
                                    error: error.message,
                                };
                                if ( error.legacyCode ) {
                                    payload.code = error.legacyCode;
                                }
                                if ( error.code ) {
                                    if ( payload.code === undefined ) {
                                        payload.code = error.code;
                                    } else {
                                        payload.errorCode = error.code;
                                    }
                                }
                                if ( error.fields ) {
                                    for ( const [key, value] of Object.entries(error.fields) ) {
                                        if ( payload[key] !== undefined ) {
                                            continue;
                                        }
                                        payload[key] = value;
                                    }
                                }
                                res.status(error.statusCode).send(payload);
                                logger.warn('httpError:', error);
                                return;
                            }
                            if ( error instanceof Error ) {
                                res.status(StatusCodes.INTERNAL_SERVER_ERROR).send({ error: error.message });
                                logger.error('Non-http error:', error);
                                return;
                            }
                            res.status(StatusCodes.INTERNAL_SERVER_ERROR).send({ error: 'An unknown error occurred' });
                            logger.error('An unknown error occurred:', error);
                        }
                    },
                );
            }
        }
    }
}
