// Main entry for `@heyputer/worker-types`.
//
// Importing this file (directly or via `"types": ["@heyputer/worker-types"]`)
// installs the ambient globals (`router`, `me`, etc.) AND re-exports the
// named types for users who want to reference them explicitly.

/// <reference path="./globals.d.ts" />

export type { Router } from './types/router.d.ts';
export type {
    Handler,
    HandlerReturn,
    PuterContext,
    WorkerEvent,
} from './types/event.d.ts';
export type { ExtractParams, Params } from './types/params.d.ts';
export type { Puter } from '@heyputer/puter.js';
