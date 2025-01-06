/*
 * Copyright (C) 2024-present Puter Technologies Inc.
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

const processors = [];

processors.push({
    title: 'track all require calls',
    match () { return true; },
    traverse: {
        CallExpression (path, context) {
            const callee = path.get('callee');
            if ( ! callee.isIdentifier() ) return;
            
            if ( callee.node.name === 'require' ) {
                context.doc_module.requires.push(path.node.arguments[0].value);
            }
        }
    }
});

processors.push({
    title: 'get leading comment',
    match () { return true; },
    traverse: {
        ClassDeclaration (path, context) {
            const node = path.node;
            const comment = (node.leadingComments && (
                node.leadingComments.length < 1 ? '' :
                node.leadingComments[node.leadingComments.length - 1]
            )) ?? '';
            context.comment = comment;
        }
    }
});

processors.push({
    title: 'provide name and comment for modules and services',
    match (context) {
        return context.type === 'module' || context.type === 'service';
    },
    traverse: {
        ClassDeclaration (path, context) {
            context.doc_item = context.doc_module;
            if ( context.type === 'service' ) {
                // Skip if class name doesn't end with 'Service'
                if ( ! path.node.id.name.endsWith('Service') ) {
                    context.skip = true;
                    return;
                }
                context.doc_item = context.doc_module.add_service();
            }
            context.doc_item.name = path.node.id.name;
            if ( context.comment === '' ) return;
            context.doc_item.provide_comment(context.comment);
        }
    }
});

processors.push({
    title: 'provide methods and listeners for services',
    match (context) {
        return context.type === 'service';
    },
    traverse: {
        ClassDeclaration (path, context) {
            path.node.body.body.forEach(member => {
                if ( member.type !== 'ClassMethod' ) return;

                const key = member.key.name ?? member.key.value;
                
                const comment = member.leadingComments?.[0]?.value ?? '';

                if ( key.startsWith('__on_') ) {
                    // 2nd argument is always an object destructuring;
                    // we want the list of keys in the object:
                    const params = member.params?.[1]?.properties ?? [];
                
                    context.doc_item.provide_listener({
                        key: key.slice(5),
                        comment,
                        params,
                    });
                } else {
                    // Method overrides
                    if ( key.startsWith('_') ) return;
                    
                    // Private methods
                    if ( key.endsWith('_') ) return;

                    const params = member.params ?? [];
                    
                    context.doc_item.provide_method({
                        key,
                        comment,
                        params,
                    });
                }
            });
        }
    }
});

processors.push({
    title: 'provide library function documentation',
    match (context) {
        return context.type === 'lib';
    },
    traverse: {
        VariableDeclaration (path, context) {
            // skip non-const declarations
            if ( path.node.kind !== 'const' ) return;
            
            // skip declarations with multiple declarators
            if ( path.node.declarations.length !== 1 ) return;
            
            // skip declarations without an initializer
            if ( ! path.node.declarations[0].init ) return;
            
            // skip declarations that aren't in the root scope
            if ( path.scope.parent ) return;
            
            console.log('path.node', path.node.declarations);

            // is it a function?
            if ( ! ['FunctionExpression', 'ArrowFunctionExpression'].includes(
                path.node.declarations[0].init.type
            ) ) return;
            
            // get the name of the function
            const name = path.node.declarations[0].id.name;
            
            // get the comment
            const comment = path.node.leadingComments?.[0]?.value ?? '';
            
            // get the parameters
            const params = path.node.declarations[0].init.params ?? [];
            
            context.doc_item.provide_function({
                key: name,
                comment,
                params,
            });
        }
    }
});

module.exports = processors;
