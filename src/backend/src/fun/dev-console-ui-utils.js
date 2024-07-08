const config = require('../config');
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
    
    const probably_docker = (() => {
        try {
            // I don't know what the value of this is in Docker,
            // but what I do know is it'll throw an exception
            // when I do this to it.
            Array(process.stdout.columns - 1);
        } catch (e) {
            return true;
        }
    })();

    if ( probably_docker ) {
        // We just won't try to render any decoration on Docker;
        // it's not worth potentially breaking the output.
        return;
    }

    const max_length = process.stdout.columns - 6;
    // const max_length = Math.max(...lengths);

    const c = str => `\x1b[${col}m${str}\x1b[0m`;
    const bar = c(Array(max_length + 4).fill('━').join(''));
    for ( let i = 0 ; i < lines.length ; i++ ) {
        require('fs').appendFileSync('/tmp/asdfqwer',
            '' + lines[i] +':'+ lines[i].length +':'+ lengths[i]+
                ':'+max_length+'\n');
        if ( lengths[i] < max_length ) {
            lines[i] += Array(max_length - lengths[i])
                .fill(' ')
                .join('');
        }
        lines[i] = `${c('┃ ')} ${lines[i]} ${c(' ┃')}`;
    }
    if ( ! config.minimal_console ) {
        lines.unshift(`${c('┏')}${bar}${c('┓')}`);
        lines.push(`${c('┗')}${bar}${c('┛')}`);
    }
};

module.exports = {
    surrounding_box,
    es_import_promise,
};
