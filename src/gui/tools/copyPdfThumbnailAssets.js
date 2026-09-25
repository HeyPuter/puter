import { cp, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PDFJS_VERSION } from '../src/services/pdfThumbnails/config.js';

export const copyPdfThumbnailAssets = async (distPath) => {
    const require = createRequire(import.meta.url);
    const packagePath = require.resolve('pdfjs-dist/package.json');
    const metadata = JSON.parse(await readFile(packagePath, 'utf8'));
    if ( metadata.version !== PDFJS_VERSION ) throw new Error('PDF thumbnail assets must match the pinned PDF.js version');
    const source = path.dirname(packagePath);
    const destination = path.join(distPath, 'pdf-thumbnails', PDFJS_VERSION);
    await mkdir(destination, { recursive: true });
    for ( const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs', 'LICENSE'] ) {
        await cp(path.join(source, name), path.join(destination, name), { recursive: true });
    }
    for ( const name of ['pdf', 'pdf.worker'] ) {
        await cp(path.join(source, 'build', `${name}.min.mjs`), path.join(destination, `${name}.mjs`));
    }
    for ( const name of ['worker.js', 'config.js'] ) {
        await cp(new URL(`../src/services/pdfThumbnails/${name}`, import.meta.url), path.join(destination, name));
    }
};
