/**
 * @typedef {import('express').Request & {services: import('../../BaseService.js')}} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('../../../filesystem/FSNodeContext')} FSNodeContext
 */

/**
 * @typedef {(req: Request, res: Response, filePath: string, fileNode: FSNodeContext, headerLockToken: string) => Promise<void>} HandlerFunction
 */

/**
 * @type {HandlerFunction}
 */
export const unsupportedMethodHandler = async (
    req,
    res,
    _filePath,
    _fileNode,
    _headerLockToken ) => {
    res.set({
        Allow:
      'OPTIONS, GET, HEAD, POST, PUT, DELETE, COPY, MOVE, MKCOL, PROPFIND, PROPPATCH, LOCK, UNLOCK',
        DAV: '1, 2',
        'MS-Author-Via': 'DAV',
    });
    res.status(405).end( 'Method Not Allowed');
};
