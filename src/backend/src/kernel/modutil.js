const fs = require('fs').promises;
const path = require('path');

async function prependToJSFiles (directory, snippet) {
    const jsExtensions = new Set(['.js', '.cjs', '.mjs', '.ts']);

    async function processDirectory (dir) {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            const promises = [];

            for ( const entry of entries ) {
                const fullPath = path.join(dir, entry.name);

                if ( entry.isDirectory() ) {
                    // Skip common directories that shouldn't be modified
                    if ( ! shouldSkipDirectory(entry.name) ) {
                        promises.push(processDirectory(fullPath));
                    }
                } else if ( entry.isFile() && jsExtensions.has(path.extname(entry.name)) ) {
                    promises.push(prependToFile(fullPath, snippet));
                }
            }

            await Promise.all(promises);
        } catch ( error ) {
            throw new Error(`error processing directory ${dir}`, {
                cause: error,
            });
        }
    }

    function shouldSkipDirectory (dirName) {
        const skipDirs = new Set([
            'node_modules',
            'gui',
        ]);
        if ( skipDirs.has(dirName) ) return true;
        if ( dirName.startsWith('.') ) return true;
        return false;
    }

    async function prependToFile (filePath, snippet) {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            if ( content.startsWith('//!no-prepend') ) return;
            const newContent = snippet + content;
            await fs.writeFile(filePath, newContent, 'utf8');
        } catch ( error ) {
            throw new Error(`error processing file ${filePath}`, {
                cause: error,
            });
        }
    }

    await processDirectory(directory);
}

module.exports = {
    prependToJSFiles,
};
