import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * Bundle a harness entry (which pulls in the executor and all suites) into
 * a single IIFE script runnable in a foreign runtime — a browser fixture
 * page or a worker. Node-side only; never import this from an entry that
 * itself gets bundled.
 */
export const bundleHarnessEntry = async (entryUrl: URL): Promise<string> => {
    const result = await build({
        entryPoints: [fileURLToPath(entryUrl)],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target: 'es2022',
    });
    return result.outputFiles[0].text;
};
