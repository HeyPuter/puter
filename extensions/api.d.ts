import type { RequestHandler } from 'express';
import type helpers from '../src/backend/src/helpers.js';

declare global {
  namespace Express {
    interface Request {
      actor: any; // TODO
    }
  }
}

type EndpointOptions = {
  allowedMethods?: string[]
  subdomain?: string
  noauth?: boolean
}

type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

type AddRouteFunction = (path: string, options: EndpointOptions, handler: RequestHandler) => void

type RouterMethods = {
  [K in HttpMethod]: {
    (path: string, options: EndpointOptions, handler: RequestHandler): void;
    (path: string, handler: RequestHandler, options?: EndpointOptions): void;
  };
}

type CoreRuntimeModule = {
  util: {
    helpers: typeof helpers,
  }
}

interface Extension extends RouterMethods {
  // import(module: 'core'): {
  //   UserActorType: typeof UserActorType;
  // };
  import(module: 'core'): CoreRuntimeModule;
  import(module: string): any;
}

declare global {
  // Declare the extension variable
  const extension: Extension;
  const config: { [k: string | number | symbol]: unknown };
}

export {};
