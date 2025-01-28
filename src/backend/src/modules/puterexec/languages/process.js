const fs = require('fs');
const sample = JSON.parse(fs.readFileSync('sample.json', 'utf8'));

const parse_language_name = (name) => {
    // Possible formats:
    // "Name Of Language"
    // "Name Of Language (Version)"
    // "Name Of Language (Runtime Version)"
    // "Name of Language (Runtime Version, Runtime Version)"

    if ( name.indexOf('(') === -1 ) {
        return { language: name, versions: {} };
    }
    const language = name.slice(0, name.indexOf('(')).trim();
    const parens = name.slice(name.indexOf('(') + 1, name.indexOf(')'))
    const versions = parens.split(',').map(versionLine => {
        const parts = versionLine.split(' ');
        if ( parts.length === 1 ) {
            return { [language]: parts[0].trim() };
        }
        const [key, value] = parts;
        return { [key.trim().toLowerCase()]: value.trim() };
    }).reduce((acc, cur) => ({ ...acc, ...cur }), {});

    return { language, versions };
};

const normalizeName = name => {
    name = name.toLowerCase();
    if ( name === 'node.js' ) name = 'node';
    if ( name === 'assembly' ) name = 'asm';
    if ( name === 'visual basic.net' ) name = 'vb.net';

    // TODO: what kind of executable? ELF binary? Windows executable?
    // if ( name === 'executable' ) name = 'exe';

    return name;
};

const output = [];
for ( const item of sample ) {
    const { id, name } = item;
    let { language, versions } = parse_language_name(name);

    language = normalizeName(language);
    {
        const newVersions = {};
        for ( const key in versions ) {
            newVersions[normalizeName(key)] = versions[key];
        }
        versions = newVersions;
    }

    output.push({
        judge0_id: id,
        id: `j0-${id}`,
        language,
        version: versions[Object.keys(versions)[0]],
        versions,
    });
}

console.log(JSON.stringify(output, null, 2));