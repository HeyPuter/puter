import type { Suite } from '../harness/types.ts';
import ai from './ai.suite.ts';
import apps from './apps.suite.ts';
import auth from './auth.suite.ts';
import fs from './fs.suite.ts';
import hosting from './hosting.suite.ts';
import kv from './kv.suite.ts';
import net from './net.suite.ts';
import perms from './perms.suite.ts';
import system from './system.suite.ts';
import util from './util.suite.ts';
import workers from './workers.suite.ts';

/**
 * Explicit registry (no dynamic globbing) so the same list is visible to
 * the node runner and to esbuild when bundling for browsers and workerd.
 */
export const suites: Suite[] = [
    ai,
    apps,
    auth,
    fs,
    hosting,
    kv,
    net,
    perms,
    system,
    util,
    workers,
];
