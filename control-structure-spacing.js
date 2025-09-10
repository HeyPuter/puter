export default {
    meta: {
        type: 'layout',
        docs: {
            description: 'enforce spacing inside parentheses for control structures only',
            category: 'Stylistic Issues',
        },
        fixable: 'whitespace',
        schema: [],
        messages: {
            missingSpaceAfterOpen: 'Missing space after opening parenthesis in control structure.',
            missingSpaceBeforeClose: 'Missing space before closing parenthesis in control structure.',
            unexpectedSpaceAfterOpen: 'Unexpected space after opening parenthesis in function call.',
            unexpectedSpaceBeforeClose: 'Unexpected space before closing parenthesis in function call.',
        },
    },

    create(context) {
        const sourceCode = context.getSourceCode();

        function checkControlStructureSpacing(node) {
            // For control structures, we need to find the parentheses around the condition/test
            let conditionNode;

            if ( node.type === 'IfStatement' || node.type === 'WhileStatement' || node.type === 'DoWhileStatement' ) {
                conditionNode = node.test;
            } else if ( node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement' ) {
                // For loops, we want the parentheses around the entire for clause
                conditionNode = node;
            } else if ( node.type === 'SwitchStatement' ) {
                conditionNode = node.discriminant;
            } else if ( node.type === 'CatchClause' ) {
                conditionNode = node.param;
            }

            if ( !conditionNode ) return;

            // Find the opening paren - it should be right before the condition starts
            const openParen = sourceCode.getTokenBefore(conditionNode, token => token.value === '(');
            if ( !openParen || openParen.value !== '(' ) return;

            // Find the closing paren - it should be right after the condition ends
            const closeParen = sourceCode.getTokenAfter(conditionNode, token => token.value === ')');
            if ( !closeParen || closeParen.value !== ')' ) return;

            const afterOpen = sourceCode.getTokenAfter(openParen);
            const beforeClose = sourceCode.getTokenBefore(closeParen);

            // Control structures should have spacing
            if ( afterOpen && openParen.range[1] === afterOpen.range[0] ) {
                context.report({
                    node,
                    loc: openParen.loc,
                    messageId: 'missingSpaceAfterOpen',
                    fix(fixer) {
                        return fixer.insertTextAfter(openParen, ' ');
                    },
                });
            }

            if ( beforeClose && beforeClose.range[1] === closeParen.range[0] ) {
                context.report({
                    node,
                    loc: closeParen.loc,
                    messageId: 'missingSpaceBeforeClose',
                    fix(fixer) {
                        return fixer.insertTextBefore(closeParen, ' ');
                    },
                });
            }
        }

        function checkForLoopSpacing(node) {
            // For loops are special - we need to find the opening paren after the 'for' keyword
            // and the closing paren before the body
            const forKeyword = sourceCode.getFirstToken(node);
            if ( !forKeyword || forKeyword.value !== 'for' ) return;

            const openParen = sourceCode.getTokenAfter(forKeyword, token => token.value === '(');
            if ( !openParen ) return;

            // The closing paren should be right before the body
            const closeParen = sourceCode.getTokenBefore(node.body, token => token.value === ')');
            if ( !closeParen ) return;

            const afterOpen = sourceCode.getTokenAfter(openParen);
            const beforeClose = sourceCode.getTokenBefore(closeParen);

            if ( afterOpen && openParen.range[1] === afterOpen.range[0] ) {
                context.report({
                    node,
                    loc: openParen.loc,
                    messageId: 'missingSpaceAfterOpen',
                    fix(fixer) {
                        return fixer.insertTextAfter(openParen, ' ');
                    },
                });
            }

            if ( beforeClose && beforeClose.range[1] === closeParen.range[0] ) {
                context.report({
                    node,
                    loc: closeParen.loc,
                    messageId: 'missingSpaceBeforeClose',
                    fix(fixer) {
                        return fixer.insertTextBefore(closeParen, ' ');
                    },
                });
            }
        }

        function checkFunctionCallSpacing(node) {
            // Find the opening parenthesis for this function call
            const openParen = sourceCode.getFirstToken(node, token => token.value === '(');
            const closeParen = sourceCode.getLastToken(node, token => token.value === ')');

            if ( !openParen || !closeParen ) return;

            const afterOpen = sourceCode.getTokenAfter(openParen);
            const beforeClose = sourceCode.getTokenBefore(closeParen);

            // Function calls should NOT have spacing
            if ( afterOpen && openParen.range[1] !== afterOpen.range[0] ) {
                const spaceAfter = sourceCode.getText().slice(openParen.range[1], afterOpen.range[0]);
                if ( /^\s+$/.test(spaceAfter) ) {
                    context.report({
                        node,
                        loc: openParen.loc,
                        messageId: 'unexpectedSpaceAfterOpen',
                        fix(fixer) {
                            return fixer.removeRange([openParen.range[1], afterOpen.range[0]]);
                        },
                    });
                }
            }

            if ( beforeClose && beforeClose.range[1] !== closeParen.range[0] ) {
                const spaceBefore = sourceCode.getText().slice(beforeClose.range[1], closeParen.range[0]);
                if ( /^\s+$/.test(spaceBefore) ) {
                    context.report({
                        node,
                        loc: closeParen.loc,
                        messageId: 'unexpectedSpaceBeforeClose',
                        fix(fixer) {
                            return fixer.removeRange([beforeClose.range[1], closeParen.range[0]]);
                        },
                    });
                }
            }
        }

        return {
            // Control structures that should have spacing
            IfStatement(node) {
                checkControlStructureSpacing(node);
            },
            WhileStatement(node) {
                checkControlStructureSpacing(node);
            },
            DoWhileStatement(node) {
                checkControlStructureSpacing(node);
            },
            SwitchStatement(node) {
                checkControlStructureSpacing(node);
            },
            CatchClause(node) {
                if ( node.param ) {
                    checkControlStructureSpacing(node);
                }
            },

            // For loops need special handling
            ForStatement(node) {
                checkForLoopSpacing(node);
            },
            ForInStatement(node) {
                checkForLoopSpacing(node);
            },
            ForOfStatement(node) {
                checkForLoopSpacing(node);
            },

            // Function calls that should NOT have spacing
            CallExpression(node) {
                checkFunctionCallSpacing(node);
            },
            NewExpression(node) {
                if ( node.arguments.length > 0 || sourceCode.getLastToken(node).value === ')' ) {
                    checkFunctionCallSpacing(node);
                }
            },
        };
    },
};