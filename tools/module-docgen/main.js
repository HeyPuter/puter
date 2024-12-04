const fs = require("fs");
const path_ = require("path");

const rootdir = path_.resolve(process.argv[2] ?? '.');

const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { ModuleDoc } = require("./defs");
const processors = require("./processors");

const doc_module = new ModuleDoc();

// List files in this directory
const files = fs.readdirSync(rootdir);
for ( const file of files ) {
    const stat = fs.statSync(path_.join(rootdir, file));
    if ( stat.isDirectory() ) {
        continue;
    }
    if ( ! file.endsWith('.js') ) continue;
    
    const type =
        file.endsWith('Service.js') ? 'service' :
        file.endsWith('Module.js') ? 'module' :
        null;
        
    if ( type === null ) continue;
    
    console.log('file', file);
    const code = fs.readFileSync(path_.join(rootdir, file), 'utf8');

    const firstLine = code.slice(0, code.indexOf('\n'));
    let metadata = {};
    const METADATA_PREFIX = '// METADATA // ';
    if ( firstLine.startsWith(METADATA_PREFIX) ) {
        metadata = JSON.parse(firstLine.slice(METADATA_PREFIX.length));
    }

    const ast = parser.parse(code);
    
    const traverse_callbacks = {};
    const context = {
        type,
        doc_module,
        filename: file,
    };
    for ( const processor of processors ) {
        if ( processor.match(context) ) {
            for ( const key in processor.traverse ) {
                if ( ! traverse_callbacks[key] ) {
                    traverse_callbacks[key] = [];
                }
                traverse_callbacks[key].push(processor.traverse[key]);
            }
        }
    }
    for ( const key in traverse_callbacks ) {
        traverse(ast, {
            [key] (path) {
                for ( const callback of traverse_callbacks[key] ) {
                    callback(path, context);
                }
            }
        });
    }
}

const outfile = path_.join(rootdir, 'README.md');

const out = doc_module.toMarkdown();

fs.writeFileSync(outfile, out);