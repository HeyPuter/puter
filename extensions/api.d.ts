import type { RequestHandler } from 'express';

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

interface Extension extends RouterMethods {
  // import(module: 'core'): {
  //   UserActorType: typeof UserActorType;
  // };
  import(module: string): any;
}

declare global {
  // Declare the extension variable
  const extension: Extension;
}

export {};
