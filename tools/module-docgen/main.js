const fs = require("fs");
const path_ = require("path");

const rootdir = path_.resolve(process.argv[2] ?? '.');

const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const doctrine = require('doctrine');

const def_module = {
    services: [],
};

const to_module_add_service = (def_module, values) => {
    def_module.services.push({
        ...values,
    });
}

const to_service_add_listener = (def_service, values) => {
    const parsed_comment = doctrine.parse(values.comment, { unwrap: true });
    
    const params = [];
    for ( const tag of parsed_comment.tags ) {
        if ( tag.title !== 'evtparam' ) continue;
        const name = tag.description.slice(0, tag.description.indexOf(' '));
        const desc = tag.description.slice(tag.description.indexOf(' '));
        params.push({ name, desc })
    }

    def_service.listeners.push({
        ...values,
        comment: parsed_comment.description,
        params,
    });
};

const to_service_add_comment = (def_service, comment) => {
    console.log('comment', comment);
    const parsed_comment = doctrine.parse(comment.value, { unwrap: true });
    def_service.comment = parsed_comment.description;
};

const to_module_add_comment = (def_module, comment) => {
    console.log('comment', comment);
    const parsed_comment = doctrine.parse(comment.value, { unwrap: true });
    def_module.comment = parsed_comment.description;
};

const create_service = () => ({
    listeners: []
});

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
    
    const def_service = create_service();
    
    console.log('file', file);
    const code = fs.readFileSync(path_.join(rootdir, file), 'utf8');
    const ast = parser.parse(code);
    traverse(ast, {
        ClassDeclaration (path) {
            const node = path.node;
            const name = node.id.name;
            def_service.name = name;
            
            // Skip utility classes (for now)
            if ( name !== file.slice(0, -3) ) {
                return;
            }
            
            const comment = (node.leadingComments && (
                node.leadingComments.length < 1 ? '' :
                node.leadingComments[node.leadingComments.length - 1]
            )) ?? '';
            
            if ( type === 'module' ) {
                def_module.name = name;
                if ( comment !== '' ) {
                    to_module_add_comment(def_module, comment);
                }
                return;
            }
            
            if ( comment !== '' ) {
                to_service_add_comment(def_service, comment);
            }
            
            console.log('class', name);
            path.node.body.body.forEach(member => {
                const key = member.key.name ?? member.key.value;
                
                const comment = member.leadingComments?.[0]?.value ?? '';

                if ( key.startsWith('__on_') ) {
                    // 2nd argument is always an object destructuring;
                    // we want the list of keys in the object:
                    const params = member.params?.[1]?.properties ?? [];
                
                    to_service_add_listener(def_service, {
                        key: key.slice(5),
                        comment,
                        params,
                    });
                }
                console.log(member.type, key, member.leadingComments);
            });
            // module_info.services.push({
            //     name,
            //     file,
            // });
        }
    })
    
    to_module_add_service(def_module, def_service);
    // console.log('parsed?', parsed);
}

console.log('module', JSON.stringify(def_module, undefined, '  '));

const outfile = path_.join(rootdir, 'README.md');

let out = '';

out += `# ${def_module.name}\n\n`;

if ( def_module.comment ) {
    out += `${def_module.comment}\n\n`;
}

out += '## Services\n\n';

for ( const service of def_module.services ) {
    out += `### ${service.name}\n\n`;
    out += `${service.comment}\n\n`;
    
    out += '#### Listeners\n\n';
    for ( const listener of service.listeners ) {
        out += `##### \`${listener.key}\`\n\n`;
        out += `${listener.comment}\n\n`;
        
        if ( listener.params.length > 0 ) {
            out += '###### Parameters\n\n';
            for ( const param of listener.params ) {
                out += `- \`${param.name}\`: ${param.desc}\n`;
            }
            out += '\n';
        }
    }
}

fs.writeFileSync(outfile, out);