import { resolveRelativePath } from './path.js';

// Iterate the given file, one line at a time.
// TODO: Make this read one line at a time, instead of all at once.
export async function* fileLines(ctx, relPath, options = { dashIsStdin: true }) {
    let lines = [];
    if (options.dashIsStdin && relPath === '-') {
        lines = await ctx.externs.in_.collect();
    } else {
        const absPath = resolveRelativePath(ctx.vars, relPath);
        const fileData = await ctx.platform.filesystem.read(absPath);
        if (fileData instanceof Blob) {
            const arrayBuffer = await fileData.arrayBuffer();
            const fileText = new TextDecoder().decode(arrayBuffer);
            lines = fileText.split(/\n|\r|\r\n/).map(it => it + '\n');
        } else if (typeof fileData === 'string') {
            lines = fileData.split(/\n|\r|\r\n/).map(it => it + '\n');
        } else {
            // ArrayBuffer or TypedArray
            const fileText = new TextDecoder().decode(fileData);
            lines = fileText.split(/\n|\r|\r\n/).map(it => it + '\n');
        }
    }

    for (const line of lines) {
        yield line;
    }
}