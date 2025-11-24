// eslint-plugin-bang-space-if/index.js
'use strict';

/** @type {import('eslint').ESLint.Plugin} */
export default {
    meta: {
        type: 'layout',
        docs: {
            description:
    "Require a space after a top-level '!' in an if(...) condition (e.g., `if ( ! entry )`).",
            recommended: false,
        },
        fixable: 'whitespace',
        schema: [], // no options
    },
    create (context) {
        const source = context.getSourceCode();

        // Unwrap ParenthesizedExpression layers, if any
        function unwrapParens (node) {
            let n = node;
            // ESLint/ESTree: ParenthesizedExpression is supported by espree
            while ( n && n.type === 'ParenthesizedExpression' ) {
                n = n.expression;
            }
            return n;
        }

        return {
            IfStatement (ifNode) {
                const testRaw = ifNode.test;
                if ( ! testRaw ) return;

                const test = unwrapParens(testRaw);
                if ( !test || test.type !== 'UnaryExpression' || test.operator !== '!' ) {
                    return; // only top-level `!` expressions
                }

                // Ignore boolean-cast `!!x` cases to avoid producing `! !x`
                if ( test.argument && test.argument.type === 'UnaryExpression' && test.argument.operator === '!' ) {
                    return;
                }

                // Grab operator and argument tokens
                const opToken = source.getFirstToken(test); // should be '!'
                const argToken = source.getTokenAfter(opToken, { includeComments: false });
                if ( !opToken || !argToken ) return;

                // Compute current whitespace between '!' and the argument
                const between = source.text.slice(opToken.range[1], argToken.range[0]);

                // We want exactly one space
                if ( between === ' ' ) return;

                context.report({
                    node: test,
                    loc: {
                        start: opToken.loc.end,
                        end: argToken.loc.start,
                    },
                    message: "Expected a single space after top-level '!' in if(...) condition.",
                    fix (fixer) {
                        return fixer.replaceTextRange([opToken.range[1], argToken.range[0]], ' ');
                    },
                });
            },
        };
    },
};;;;
