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
                context.doc_item = context.doc_module.add_service();
            }
            context.doc_item.name = path.node.id.name;
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

module.exports = processors;
