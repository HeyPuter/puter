// surrounding_box function
//
// It's really hard to see an error message without using
// the surrounding_box function to highlight its location.
// The implementation of this in packages/backend might not
// work in older versions of node, so we instead re-implement
// it here.
import console from 'node:console';
import process from 'node:process';

const surrounding_box = (col, lines) => {
    const lengths = lines.map(line => line.length);

    const max_length = Math.max(...lengths);
    const c = str => `\x1b[${col}m${str}\x1b[0m`;
    const bar = c(Array(max_length + 4).fill('━').join(''));
    for ( let i = 0 ; i < lines.length ; i++ ) {
        while ( lines[i].length < max_length ) {
            lines[i] += ' ';
        }
        lines[i] = `${c('┃ ')} ${lines[i]} ${c(' ┃')}`;
    }
    lines.unshift(`${c('┏')}${bar}${c('┓')}`);
    lines.push(`${c('┗')}${bar}${c('┛')}`);
};

// node version check
{
    // Keeping track of WHY certain versions don't work
    const ver_info = [
        { under: 14, reasons: ['optional chaining is not available'] },
        { under: 16, reasons: ['disk usage package ABI mismatch'] },
    ];

    const lowest_allowed = Math.max(...ver_info.map(r => r.under));

    // ACTUAL VERSION CHECK
    const [major, minor] = process.versions.node.split('.').map(Number);
    if ( major < lowest_allowed ) {
        const lines = [];
        lines.push(`Please use a version of Node.js ${lowest_allowed} or newer.`);
        lines.push(`Issues with node ${process.versions.node}:`);
        // We also show the user the reasons in case they want to know
        for ( const { under, reasons } of ver_info ) {
            if ( major < under ) {
                lines.push(`  - ${reasons.join(', ')}`);
            }
        }
        surrounding_box('31;1', lines);
        console.error(lines.join('\n'));
        process.exit(1);
    }
}

// Annoying polyfill for inconsistency in different node versions
if ( ! import.meta.filename ) {
    Object.defineProperty(import.meta, 'filename', {
        get: import.meta.url.slice('file://'.length),
    })
}

const main = async () => {
    const {
        Kernel,
        CoreModule,
        DatabaseModule,
        LocalDiskStorageModule,
        SelfHostedModule
    } = (await import('@heyputer/backend')).default;

    const k = new Kernel({
        entry_path: import.meta.filename
    });
    k.add_module(new CoreModule());
    k.add_module(new DatabaseModule());
    k.add_module(new LocalDiskStorageModule());
    k.add_module(new SelfHostedModule());
    k.boot();
};

const early_init_errors = [
    {
        text: `Cannot find package '@heyputer/backend'`,
        notes: [
            'this usually happens if you forget `npm install`'
        ],
        suggestions: [
            'try running `npm install`'
        ],
        technical_notes: [
            '@heyputer/backend is in an npm workspace'
        ]
    },
    {
        text: `Cannot find package`,
        notes: [
            'this usually happens if you forget `npm install`'
        ],
        suggestions: [
            'try running `npm install`'
        ],
    }
];

// null coalescing operator
const nco = (...args) => {
    for ( const arg of args ) {
        if ( arg !== undefined && arg !== null ) {
            return arg;
        }
    }
    return undefined;
}

const _print_error_help = (error_help) => {
    const lines = [];
    lines.push(nco(error_help.title, error_help.text));
    for ( const note of (nco(error_help.notes, [])) ) {
        lines.push(`📝 ${note}`)
    }
    if ( error_help.suggestions ) {
        lines.push('Suggestions:');
        for ( const suggestion of error_help.suggestions ) {
            lines.push(`- ${suggestion}`);
        }
    }
    if ( error_help.technical_notes ) {
        lines.push('Technical Notes:');
        for ( const note of error_help.technical_notes ) {
            lines.push(`- ${note}`);
        }
    }
    surrounding_box('31;1', lines);
    console.error(lines.join('\n'));
}

(async () => {
    try {
        await main();
    } catch (e) {
        for ( const error_help of early_init_errors ) {
            const message = e && e.message;
            if ( e.message && e.message.includes(error_help.text) ) {
                _print_error_help(error_help);
                break;
            }
        }
        throw e;
    }
})();
