import dedent from 'dedent';
import configVals from './config-vals.json.js';

const mdlib = {};
mdlib.h = (out, n, str) => {
    out(`${'#'.repeat(n)} ${str}\n\n`);
};

const N_START = 3;

const out = str => process.stdout.write(str);
for ( const configVal of configVals ) {
    mdlib.h(out, N_START, `\`${configVal.key}\``);
    out(`${dedent(configVal.description) }\n\n`);

    if ( configVal.example_values ) {
        mdlib.h(out, N_START + 1, 'Examples');
        for ( const example of configVal.example_values ) {
            out(`- \`"${configVal.key}": ${JSON.stringify(example)}\`\n`);
        }
    }

    out('\n');

}
