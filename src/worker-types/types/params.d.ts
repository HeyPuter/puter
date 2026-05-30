/**
 * Extract route parameters from a path literal like `/posts/:id/comments/:cid`
 * or `/files/*path` into an object type whose keys are the param names.
 *
 * Examples:
 *   ExtractParams<'/posts/:id'>            -> { id: string }
 *   ExtractParams<'/posts/:id/c/:cid'>     -> { id: string; cid: string }
 *   ExtractParams<'/files/*path'>          -> { path: string }
 *   ExtractParams<'/static'>               -> {}
 */
export type ExtractParams<S extends string> =
    S extends `${string}:${infer Param}/${infer Rest}`
        ? { [K in Param]: string } & ExtractParams<`/${Rest}`>
    : S extends `${string}:${infer Param}`
        ? { [K in Param]: string }
    : S extends `${string}*${infer Param}/${infer Rest}`
        ? { [K in Param]: string } & ExtractParams<`/${Rest}`>
    : S extends `${string}*${infer Param}`
        ? { [K in Param]: string }
    : {};

export type Params = Record<string, string>;
