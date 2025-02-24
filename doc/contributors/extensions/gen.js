const dedent = require('dedent');
const events = require('./events.json.js');

const mdlib = {};
mdlib.h = (out, n, str) => {
    out(`${'#'.repeat(n)} ${str}\n\n`);
}

const N_START = 3;

const out = str => process.stdout.write(str);
for ( const event of events ) {
    mdlib.h(out, N_START, `\`${event.id}\``);
    out(dedent(event.description) + '\n\n');
    
    for ( const k in event.properties ) {
        const prop = event.properties[k];
        mdlib.h(out, N_START + 1, `Property \`${k}\``);
        out(prop.summary + '\n');
        out(`- **Type**: ${prop.type}\n`);
        out(`- **Mutability**: ${prop.mutability}\n`);
        if ( prop.notes ) {
            out(`- **Notes**: ${prop.n}\n`);
            for ( const note of prop.notes ) {
                out(`  - ${note}\n`);
            }
        }
    }

}
