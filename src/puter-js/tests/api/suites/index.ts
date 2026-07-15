import type { Suite } from '../harness/types.ts';
import apps from './apps.suite.ts';
import auth from './auth.suite.ts';
import fs from './fs.suite.ts';
import kv from './kv.suite.ts';

/**
 * Explicit registry (no dynamic globbing) so the same list is visible to
 * the node runner and to esbuild when bundling for browsers and workerd.
 */
export const suites: Suite[] = [apps, auth, fs, kv];
