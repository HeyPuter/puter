/*
 * Copyright (C) 2024 Puter Technologies Inc.
 * 
 * This file is part of Puter.
 * 
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// METADATA // {"ai-commented":{"service":"claude"}}
const dedent = require('dedent');
const doctrine = require('doctrine');


/**
* Out class - A utility class for generating formatted text output
* Provides methods for creating headings, line feeds, and text output
*
* ~~with a fluent interface.~~
*  ^ Nope, AI got this wrong but maybe it's a good idea to
*    make this a fluent interface
*
* The constructor returns a bound function that
* maintains the output state and provides access to helper methods.
*/
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
    

    /**
    * Adds a line feed (newline) to the output string
    * @returns {void}
    */
    lf () { this.str += '\n'; }
    
    /**
     * Append to the string
     * @param {string} str 
     */
    out (str) {
        this.str += str;
    }
}


/**
* Doc class serves as a base class for documentation generation.
* Provides core functionality for parsing and storing documentation comments
* using the doctrine parser. Contains methods for handling JSDoc-style
* comments and maintaining documentation state.
*/
class Doc {
    constructor () {
        this._construct();
    }
    provide_comment (comment) {
        const parsed_comment = doctrine.parse(comment.value, { unwrap: true });
        this.comment = parsed_comment.description;
    }
}


/**
* ModuleDoc class extends Doc to represent documentation for a module.
* Handles module-level documentation including services, libraries, and requirements.
* Provides methods for adding services/libraries and generating markdown documentation.
* Tracks external imports and generates notes about module dependencies.
*/
class ModuleDoc extends Doc {
    /**
    * Initializes the base properties for a ModuleDoc instance
    * Sets up empty arrays for services, requires, and libs collections
    * @private
    */
    _construct () {
        this.services = [];
        this.requires = [];
        this.libs = [];
    }
    

    /**
    * Creates and adds a new service to this module's services array
    * @returns {ServiceDoc} The newly created service document instance
    */
    add_service () {
        const service = new ServiceDoc();
        this.services.push(service);
        return service;
    }
    

    /**
    * Creates and adds a new LibDoc instance to the module's libs array
    * @returns {LibDoc} The newly created LibDoc instance
    */
    add_lib () {
        const lib = new LibDoc();
        this.libs.push(lib);
        return lib;
    }
    

    /**
     * Populates a "notes" array for the module documentation
     * based on findings about imports.
     */
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


/**
* ServiceDoc class represents documentation for a service module.
* Handles parsing and formatting of service-related documentation including
* listeners, methods, and their associated parameters. Extends the base Doc class
* to provide specialized documentation capabilities for service components.
*/
class ServiceDoc extends Doc {
    /**
    * Represents documentation for a service
    * Handles parsing and storing service documentation including listeners and methods
    * Initializes with empty arrays for listeners and methods
    */
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


/**
* LibDoc class for documenting library modules
* Handles documentation for library functions including their descriptions,
* parameters, and markdown generation. Extends the base Doc class to provide
* specialized documentation capabilities for library components.
*/
class LibDoc extends Doc {
    /**
    * Represents documentation for a library module
    * 
    * Handles parsing and formatting documentation for library functions.
    * Stores function definitions with their comments, parameters and descriptions.
    * Can output formatted markdown documentation.
    */
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
