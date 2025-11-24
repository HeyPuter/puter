import ruleComposer from 'eslint-rule-composer';

// Adjust this require to match the package you use for the rule.
// For eslint-stylistic v2+ the package is "@stylistic/eslint-plugin"
import stylistic from '@stylistic/eslint-plugin';
const baseRule = stylistic.rules['space-unary-ops'];

// unwrap nested parentheses
function unwrapParens (node) {
    let n = node;
    while ( n && n.type === 'ParenthesizedExpression' ) n = n.expression;
    return n;
}

function isTopLevelBangInIfTest (node) {
    if ( !node || node.type !== 'UnaryExpression' || node.operator !== '!' ) return false;

    // Walk up through ancestors manually using .parent (safe in ESLint)
    let current = node;
    let parent = current.parent;

    // Skip ParenthesizedExpression layers
    while ( parent && parent.type === 'ParenthesizedExpression' ) {
        current = parent;
        parent = parent.parent;
    }

    return parent && parent.type === 'IfStatement' && unwrapParens(parent.test) === node;
}

// Filter out ONLY the reports for top-level ! inside if(...) condition
export default ruleComposer.filterReports(baseRule, (problem, context) => {
    const { node } = problem;
    // If this particular report is about a top-level ! in an if(...) test,
    // suppress it. Otherwise, keep the original report.
    return !isTopLevelBangInIfTest(node, context);
});
