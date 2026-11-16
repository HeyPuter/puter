import * as names from '../src/puter-js/src/modules/notifications/lib/pushNames.js';

const START =
    '// Shared with puter.js: generated from lib/pushNames.js by tools/pushWorkerNames.mjs.';
const END = '// End of generated names.';

/** `source` with its generated names block rewritten from `pushNames.js`. */
export const withPushNames = (source) => {
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const text = source.replace(/\r\n/g, '\n');
    const start = text.indexOf(START);
    const end = text.indexOf(END, start);
    if (start < 0 || end < 0) throw new Error('no generated names block');
    const indent = text.slice(text.lastIndexOf('\n', start) + 1, start);
    const lines = Object.keys(names)
        .sort()
        .map((name) => `${indent}const ${name} = '${names[name]}';`);
    const next = `${text.slice(0, start)}${START}\n${lines.join('\n')}\n${indent}${text.slice(end)}`;
    return eol === '\n' ? next : next.replace(/\n/g, eol);
};

/** Whether `source`'s generated names match `pushNames.js`. */
export const hasPushNames = (source) => {
    try {
        return withPushNames(source) === source;
    } catch {
        return false;
    }
};
