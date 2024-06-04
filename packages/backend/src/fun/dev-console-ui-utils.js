const { TeePromise } = require('../util/promise');

const es_import_promise = new TeePromise();
let stringLength;
(async () => {
    stringLength = (await import('string-length')).default;
    es_import_promise.resolve();
    // console.log('STRING LENGTH', stringLength);
    // process.exit(0);
})();
const surrounding_box = (col, lines, lengths) => {
    if ( ! stringLength ) return;
    if ( ! lengths ) {
        lengths = lines.map(line => stringLength(line));
    }

    const max_length = Math.max(...lengths);
    const c = str => `\x1b[${col}m${str}\x1b[0m`;
    const bar = c(Array(max_length + 4).fill('━').join(''));
    for ( let i = 0 ; i < lines.length ; i++ ) {
        while ( stringLength(lines[i]) < max_length ) {
            lines[i] += ' ';
        }
        lines[i] = `${c('┃ ')} ${lines[i]} ${c(' ┃')}`;
    }
    lines.unshift(`${c('┏')}${bar}${c('┓')}`);
    lines.push(`${c('┗')}${bar}${c('┛')}`);
};

module.exports = {
    surrounding_box,
    es_import_promise,
};
