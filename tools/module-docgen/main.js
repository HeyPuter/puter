const fs = require("fs");
const path_ = require("path");

const rootdir = path_.resolve(process.argv[2] ?? '.');

const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { ModuleDoc } = require("./defs");

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
    const ast = parser.parse(code);
    traverse(ast, {
        CallExpression (path) {
            const callee = path.get('callee');
            if ( ! callee.isIdentifier() ) return;
            
            if ( callee.node.name === 'require' ) {
                doc_module.requires.push(path.node.arguments[0].value);
            }
        },
        ClassDeclaration (path) {
            const node = path.node;
            const name = node.id.name;
            
            // Skip utility classes (for now)
            if ( name !== file.slice(0, -3) ) {
                return;
            }
            
            const comment = (node.leadingComments && (
                node.leadingComments.length < 1 ? '' :
                node.leadingComments[node.leadingComments.length - 1]
            )) ?? '';
            
            let doc_item = doc_module;
            if ( type !== 'module' ) {
                doc_item = doc_module.add_service();
            }
            
            doc_item.name = name;
            if ( comment !== '' ) {
                doc_item.provide_comment(comment);
            }

            if ( type === 'module' ) {
                return;
            }
    
            
            if ( comment !== '' ) {
                doc_item.provide_comment(comment);
                // to_service_add_comment(def_service, comment);
            }
            
            console.log('class', name);
            path.node.body.body.forEach(member => {
                const key = member.key.name ?? member.key.value;
                
                const comment = member.leadingComments?.[0]?.value ?? '';

                if ( key.startsWith('__on_') ) {
                    // 2nd argument is always an object destructuring;
                    // we want the list of keys in the object:
                    const params = member.params?.[1]?.properties ?? [];
                
                    doc_item.provide_listener({
                        key: key.slice(5),
                        comment,
                        params,
                    });
                }
                console.log(member.type, key, member.leadingComments);
            });
        }
    })
}

const outfile = path_.join(rootdir, 'README.md');

const out = doc_module.toMarkdown();

fs.writeFileSync(outfile, out);