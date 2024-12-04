const dedent = require('dedent');
const doctrine = require('doctrine');

class Out {
    constructor () {
        this.str = '';
        const fn = this.out.bind(this);
        fn.h = this.h.bind(this);
        fn.lf = this.lf.bind(this);
        fn.text = () => this.str;
        return fn;
    }
    
    h (n, text) {
        this.str += '#'.repeat(n) + ' ' + text + '\n\n';
    }
    
    lf () { this.str += '\n'; }
    
    out (str) {
        this.str += str;
    }
}

class Doc {
    constructor () {
        this._construct();
    }
    provide_comment (comment) {
        const parsed_comment = doctrine.parse(comment.value, { unwrap: true });
        this.comment = parsed_comment.description;
    }
}

class ModuleDoc extends Doc {
    _construct () {
        this.services = [];
        this.requires = [];
        this.libs = [];
    }
    
    add_service () {
        const service = new ServiceDoc();
        this.services.push(service);
        return service;
    }
    
    add_lib () {
        const lib = new LibDoc();
        this.libs.push(lib);
        return lib;
    }
    
    ready () {
        this.notes = [];
        const rel_requires = this.requires.filter(r => r.startsWith('../'));
        if ( rel_requires.length > 0 ) {
            this.notes.push({
                title: 'Outside Imports',
                desc: dedent(`
                    This module has external relative imports. When these are
                    removed it may become possible to move this module to an
                    extension.
                    
                    **Imports:**
                    ${rel_requires.map(r => {
                        let maybe_aside = '';
                        if ( r.endsWith('BaseService') ) {
                            maybe_aside = ' (use.BaseService)';
                        }
                        return `- \`${r}\`` + maybe_aside;
                    }).join('\n')}
                `)
            });
        }
    }
    
    toMarkdown ({ hl, out } = { hl: 1 }) {
        this.ready();

        out = out ?? new Out();
        
        out.h(hl, this.name);
        
        out(this.comment + '\n\n');
        
        if ( this.services.length > 0 ) {
            out.h(hl + 1, 'Services');
            
            for ( const service of this.services ) {
                service.toMarkdown({ out, hl: hl + 2 });
            }
        }
        
        if ( this.libs.length > 0 ) {
            out.h(hl + 1, 'Libraries');
            
            for ( const lib of this.libs ) {
                lib.toMarkdown({ out, hl: hl + 2 });
            }
        }

        if ( this.notes.length > 0 ) {
            out.h(hl + 1, 'Notes');
            for ( const note of this.notes ) {
                out.h(hl + 2, note.title);
                out(note.desc);
                out.lf();
            }
        }
        

        return out.text();
    }
}

class ServiceDoc extends Doc {
    _construct () {
        this.listeners = [];
        this.methods = [];
    }
    
    provide_comment (comment) {
        const parsed_comment = doctrine.parse(comment.value, { unwrap: true });
        this.comment = parsed_comment.description;
    }
    
    provide_listener (listener) {
        const parsed_comment = doctrine.parse(listener.comment, { unwrap: true });
        
        const params = [];
        for ( const tag of parsed_comment.tags ) {
            if ( tag.title !== 'evtparam' ) continue;
            const name = tag.description.slice(0, tag.description.indexOf(' '));
            const desc = tag.description.slice(tag.description.indexOf(' '));
            params.push({ name, desc })
        }

        this.listeners.push({
            ...listener,
            comment: parsed_comment.description,
            params,
        });
    }
    
    provide_method (method) {
        const parsed_comment = doctrine.parse(method.comment, { unwrap: true });
        
        const params = [];
        for ( const tag of parsed_comment.tags ) {
            if ( tag.title !== 'param' ) continue;
            const name = tag.name;
            const desc = tag.description;
            params.push({ name, desc })
        }

        this.methods.push({
            ...method,
            comment: parsed_comment.description,
            params,
        });
    }
    
    toMarkdown ({ hl, out } = { hl: 1 }) {
        out = out ?? new Out();
        
        out.h(hl, this.name);
        
        out(this.comment + '\n\n');
        
        if ( this.listeners.length > 0 ) {
            out.h(hl + 1, 'Listeners');
            
            for ( const listener of this.listeners ) {
                out.h(hl + 2, '`' + listener.key + '`');
                out (listener.comment + '\n\n');
                
                if ( listener.params.length > 0 ) {
                    out.h(hl + 3, 'Parameters');
                    for ( const param of listener.params ) {
                        out(`- **${param.name}:** ${param.desc}\n`);
                    }
                    out.lf();
                }
            }
        }
        
        if ( this.methods.length > 0 ) {
            out.h(hl + 1, 'Methods');
            
            for ( const method of this.methods ) {
                out.h(hl + 2, '`' + method.key + '`');
                out (method.comment + '\n\n');
                
                if ( method.params.length > 0 ) {
                    out.h(hl + 3, 'Parameters');
                    for ( const param of method.params ) {
                        out(`- **${param.name}:** ${param.desc}\n`);
                    }
                    out.lf();
                }
            }
        }
        
        return out.text();
    }
}

class LibDoc extends Doc {
    _construct () {
        this.functions = [];
    }
    
    provide_function ({ key, comment, params }) {
        const parsed_comment = doctrine.parse(comment, { unwrap: true });
        
        const parsed_params = [];
        for ( const tag of parsed_comment.tags ) {
            if ( tag.title !== 'param' ) continue;
            const name = tag.name;
            const desc = tag.description;
            parsed_params.push({ name, desc });
        }
        
        this.functions.push({
            key,
            comment: parsed_comment.description,
            params: parsed_params,
        });
    }
    
    toMarkdown ({ hl, out } = { hl: 1 }) {
        out = out ?? new Out();
        
        out.h(hl, this.name);
        
        console.log('functions?', this.functions);
        
        if ( this.functions.length > 0 ) {
            out.h(hl + 1, 'Functions');
            
            for ( const func of this.functions ) {
                out.h(hl + 2, '`' + func.key + '`');
                out(func.comment + '\n\n');
                
                if ( func.params.length > 0 ) {
                    out.h(hl + 3, 'Parameters');
                    for ( const param of func.params ) {
                        out(`- **${param.name}:** ${param.desc}\n`);
                    }
                    out.lf();
                }
            }
        }
        
        return out.text();
    }
}

module.exports = {
    ModuleDoc,
    ServiceDoc,
};
