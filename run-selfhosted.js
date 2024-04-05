// node version check
{
    // JUST AN AESTHETIC THING
    // It's really hard to see the error message without using
    // the surrounding_box function to highlight its location.
    // The implementation of this in packages/backend might not
    // work in older versions of node, so we instead re-implement
    // it here.
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

    // Keeping track of WHY certain versions don't work
    const ver_info = [
        { under: 14, reasons: ['optional chaining is not available'] },
        { under: 16, reasons: ['diskusage package ABI mismatch'] },
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

(async () => {
    const {
        Kernel,
        CoreModule,
        DatabaseModule,
        PuterDriversModule,
        LocalDiskStorageModule,
        SelfhostedModule
    } = (await import('@heyputer/backend')).default;

    console.log('kerne', Kernel);
    const k = new Kernel();
    k.add_module(new CoreModule());
    k.add_module(new DatabaseModule());
    k.add_module(new PuterDriversModule());
    k.add_module(new LocalDiskStorageModule());
    k.add_module(new SelfhostedModule()),
    k.boot();
})();

