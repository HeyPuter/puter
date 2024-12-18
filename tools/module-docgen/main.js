const fs = require("fs");
const path_ = require("path");

const rootdir = path_.resolve(process.argv[2] ?? '.');

const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { ModuleDoc } = require("./defs");
const processors = require("./processors");

const doc_module = new ModuleDoc();

const handle_file = (code, context) => {
    const ast = parser.parse(code);
    
    const traverse_callbacks = {};
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
                context.skip = false;
                for ( const callback of traverse_callbacks[key] ) {
                    callback(path, context);
                    if ( context.skip ) return;
                }
            }
        });
    }
}

// Module and class files
{
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
        
        const context = {
            metadata,
            type,
            doc_module,
            filename: file,
        };
        
        handle_file(code, context);
    }
}

// Library files
if ( fs.existsSync(path_.join(rootdir, 'lib')) ) {
    const files = fs.readdirSync(path_.join(rootdir, 'lib'));
    for ( const file of files ) {
        if ( file.startsWith('_') ) continue;
        
        const code = fs.readFileSync(path_.join(rootdir, 'lib', file), 'utf8');

        const firstLine = code.slice(0, code.indexOf('\n'));
        let metadata = {};
        const METADATA_PREFIX = '// METADATA // ';
        if ( firstLine.startsWith(METADATA_PREFIX) ) {
            metadata = JSON.parse(firstLine.slice(METADATA_PREFIX.length));
        }
        
        const doc_item = doc_module.add_lib();
        doc_item.name = metadata.def ?? file.slice(0, -3);
        
        const context = {
            metadata,
            type: 'lib',
            doc_module,
            doc_item,
            filename: file,
        };
        
        handle_file(code, context);
    }
}

const outfile = path_.join(rootdir, 'README.md');

const out = doc_module.toMarkdown();

fs.writeFileSync(outfile, out);