import * as names from './pushNames.js';

const START = '// Generated from pushNames.js by tools/pushWorkerNames.mjs.';
const END = '// End of generated names.';

/** `source` with its generated names block rewritten from `pushNames.js`. */
export const withPushNames = (source) => {
    const start = source.indexOf(START);
    const end = source.indexOf(END, start);
    if (start < 0 || end < 0) throw new Error('no generated names block');
    const indent = source.slice(source.lastIndexOf('\n', start) + 1, start);
    const lines = Object.keys(names)
        .sort()
        .map((name) => `${indent}const ${name} = '${names[name]}';`);
    return `${source.slice(0, start)}${START}\n${lines.join('\n')}\n${indent}${source.slice(end)}`;
};

/** Whether `source`'s generated names match `pushNames.js`. */
export const hasPushNames = (source) => {
    try {
        return withPushNames(source) === source;
    } catch {
        return false;
    }
};
