const babelParser = require('@babel/parser');
const generate = (require('@babel/generator')).default;
const fs = require('fs');

const recast = require('recast');

const example = fs.readFileSync('./src/backend/src/filesystem/ll_operations/ll_read.js');

{
    const ast = recast.parse(example, {
        parser: {
            parse (source) {
                return babelParser.parse(source, {
                    ranges: true,
                    tokens: true,
                });
            },
        },
    });
    const { code } = recast.print(ast);
}

{
    const ast = babelParser.parse('' + example, {
        tokens: true,
    });

    console.log(JSON.stringify(ast, undefined, '  '));
}

/*
const { code } = generate(ast, {
    retainLines: true,
});
*/

// console.log(code);