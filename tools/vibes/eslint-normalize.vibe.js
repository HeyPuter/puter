#!/usr/bin/env node

/*
This script is (almost) entirely written by AI.

This script would not have been worth adding if it had to be written
by hand, as it adds a small developer convenience that would be very
time consuming to write "by hand" (without AI).

The impact of this script failing is temporary developer inconvenience.

To maintain this script, it is acceptable to replace it completely.

https://claude.ai/artifacts/8d444028-08c1-4f4c-a234-75a15b2dbec2
*/

import fs from 'fs';
import jscodeshift from 'jscodeshift';

/**
 * Simple ESLint config merger using jscodeshift
 * Dependencies: npm install jscodeshift
 */
class ESLintConfigMerger {
    constructor() {
        this.j = jscodeshift.withParser('tsx');
    }

    /**
     * Extract all rules objects from the config
     */
    extractRulesFromConfig(source) {
        const ast = this.j(source);
        const rulesObjects = [];

        // Find the defineConfig call and get its array argument
        ast.find(this.j.CallExpression)
            .filter(path => 
                path.value.callee.type === 'Identifier' && 
                path.value.callee.name === 'defineConfig'
            )
            .forEach(callPath => {
                const arrayArg = callPath.value.arguments[0];
                if (arrayArg && arrayArg.type === 'ArrayExpression') {
                    // Each element in the array is a config block
                    arrayArg.elements.forEach((configBlock, blockIndex) => {
                        if (configBlock && configBlock.type === 'ObjectExpression') {
                            // Look for 'rules' property directly at the root of this config block
                            configBlock.properties.forEach(prop => {
                                if (prop.type === 'ObjectProperty' && 
                                    ((prop.key.type === 'Identifier' && prop.key.name === 'rules') ||
                                     (prop.key.type === 'StringLiteral' && prop.key.value === 'rules')) &&
                                    prop.value.type === 'ObjectExpression') {
                                    
                                    rulesObjects.push(prop.value);
                                }
                            });
                        }
                    });
                }
            });

        return rulesObjects;
    }

    /**
     * Find common rules across all rules objects
     */
    findCommonRules(rulesObjects) {
        if (rulesObjects.length < 2) return new Map();

        // Map rule names to all their values across blocks
        const ruleValuesMap = new Map(); // ruleName -> Set of normalized values
        const ruleNodeMap = new Map();   // "ruleName:value" -> AST node

        // Collect all values for each rule name
        rulesObjects.forEach(rulesObj => {
            rulesObj.properties.forEach(prop => {
                if (prop.type === 'ObjectProperty' || prop.type === 'ObjectMethod') {
                    const ruleName = prop.key.type === 'Identifier' ? prop.key.name : 
                                   prop.key.type === 'StringLiteral' ? prop.key.value : null;
                    
                    if (!ruleName) return;

                    // Normalize the rule code to handle formatting differences
                    const ruleCode = this.j(prop.value).toSource({
                        quote: 'single',
                        reuseParsers: true,
                        lineTerminator: '\n'
                    }).replace(/\s+/g, ' ').trim(); // Normalize whitespace
                    
                    if (!ruleValuesMap.has(ruleName)) {
                        ruleValuesMap.set(ruleName, new Set());
                    }
                    ruleValuesMap.get(ruleName).add(ruleCode);
                    
                    // Store the AST node for this rule+value combination
                    const ruleKey = `${ruleName}:${ruleCode}`;
                    if (!ruleNodeMap.has(ruleKey)) {
                        ruleNodeMap.set(ruleKey, prop.value);
                    }
                }
            });
        });

        // Only consider rules "common" if they have exactly one value across all blocks
        // AND appear in at least 2 blocks
        const commonRules = new Map();
        const minOccurrences = 2;

        ruleValuesMap.forEach((valueSet, ruleName) => {
            // Rule is common only if it has exactly one unique value across all blocks
            if (valueSet.size === 1) {
                const singleValue = Array.from(valueSet)[0];
                const ruleKey = `${ruleName}:${singleValue}`;
                
                // Count how many blocks actually contain this rule
                let occurrenceCount = 0;
                rulesObjects.forEach(rulesObj => {
                    const hasRule = rulesObj.properties.some(prop => {
                        const propRuleName = prop.key.type === 'Identifier' ? prop.key.name : 
                                           prop.key.type === 'StringLiteral' ? prop.key.value : null;
                        return propRuleName === ruleName;
                    });
                    if (hasRule) occurrenceCount++;
                });

                // Only include if it appears in multiple blocks with the same value
                if (occurrenceCount >= minOccurrences) {
                    commonRules.set(ruleName, ruleNodeMap.get(ruleKey));
                }
            }
        });

        return commonRules;
    }

    /**
     * Create a single const declaration for common rules
     */
    createCommonRulesConst(commonRules) {
        const properties = [];

        commonRules.forEach((valueNode, ruleName) => {
            properties.push(
                this.j.objectProperty(
                    this.j.stringLiteral(ruleName),
                    valueNode
                )
            );
        });

        return this.j.variableDeclaration('const', [
            this.j.variableDeclarator(
                this.j.identifier('commonRules'),
                this.j.objectExpression(properties)
            )
        ]);
    }

    /**
     * Transform the config to use common rules
     */
    transform(source) {
        const ast = this.j(source);
        const rulesObjects = this.extractRulesFromConfig(source);
        const commonRules = this.findCommonRules(rulesObjects);

        if (commonRules.size === 0) {
            console.log('No common rules found.');
            return source;
        }

        console.log(`Found ${commonRules.size} common rules:`, Array.from(commonRules.keys()));

        // Create the const declaration
        const constDecl = this.createCommonRulesConst(commonRules);

        // Find insertion point (after last import)
        let lastImportPath = null;
        ast.find(this.j.ImportDeclaration).forEach(path => {
            lastImportPath = path;
        });

        // Insert the const declaration
        if (lastImportPath) {
            lastImportPath.insertAfter(constDecl);
        } else {
            // If no imports, insert at the beginning
            ast.find(this.j.Program).get('body', 0).insertBefore(constDecl);
        }

        // Update ONLY the specific rules objects we identified earlier
        // Find the defineConfig call and update only the correct rules objects
        ast.find(this.j.CallExpression)
            .filter(path => 
                path.value.callee.type === 'Identifier' && 
                path.value.callee.name === 'defineConfig'
            )
            .forEach(callPath => {
                const arrayArg = callPath.value.arguments[0];
                if (arrayArg && arrayArg.type === 'ArrayExpression') {
                    
                    // Track which rules objects we've processed
                    let rulesObjectIndex = 0;
                    
                    arrayArg.elements.forEach((configBlock, blockIndex) => {
                        if (configBlock && configBlock.type === 'ObjectExpression') {
                            
                            // Find the rules property in this block
                            configBlock.properties.forEach(prop => {
                                if (prop.type === 'ObjectProperty' && 
                                    ((prop.key.type === 'Identifier' && prop.key.name === 'rules') ||
                                     (prop.key.type === 'StringLiteral' && prop.key.value === 'rules')) &&
                                    prop.value.type === 'ObjectExpression') {
                                    
                                    console.log(`Debug: Updating rules in block ${blockIndex}`);
                                    const rulesObj = prop.value;
                                    const newProperties = [];

                                    // Add spread element for common rules
                                    newProperties.push(this.j.spreadElement(this.j.identifier('commonRules')));

                                    // Add remaining rules that aren't common
                                    rulesObj.properties.forEach(ruleProp => {
                                        if (ruleProp.type === 'ObjectProperty' || ruleProp.type === 'ObjectMethod') {
                                            const ruleName = ruleProp.key.type === 'Identifier' ? ruleProp.key.name : 
                                                           ruleProp.key.type === 'StringLiteral' ? ruleProp.key.value : null;
                                            
                                            if (ruleName && !commonRules.has(ruleName)) {
                                                newProperties.push(ruleProp);
                                            }
                                        }
                                    });

                                    rulesObj.properties = newProperties;
                                    rulesObjectIndex++;
                                }
                            });
                        }
                    });
                }
            });

        return ast.toSource({
            quote: 'single',
            reuseParsers: true,
            lineTerminator: '\n'
        });
    }

    /**
     * Process the ESLint config file
     */
    async mergeConfig(filePath) {
        try {
            console.log(`Processing ${filePath}...`);
            
            const originalContent = fs.readFileSync(filePath, 'utf8');
            const transformedContent = this.transform(originalContent);

            if (transformedContent === originalContent) {
                console.log('No changes made - no common rules found.');
                return;
            }

            // Create backup
            // (commented out because that's what Git is for, Claude!)
            // const backupPath = filePath + '.backup';
            // fs.writeFileSync(backupPath, originalContent);
            // console.log(`Backup created: ${backupPath}`);

            // Write updated config
            fs.writeFileSync(filePath, transformedContent);
            console.log(`Updated config written to: ${filePath}`);

        } catch (error) {
            console.error('Error processing ESLint config:', error);
            
            if (error.code === 'MODULE_NOT_FOUND') {
                console.log('\nMissing dependency. Please install:');
                console.log('npm install jscodeshift');
            }
        }
    }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
    const filePath = process.argv[2] || './eslint.config.js';
    
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        console.log('Usage: node eslint-merger.js [path-to-eslint-config]');
        console.log('\nDependency required:');
        console.log('npm install jscodeshift');
        process.exit(1);
    }

    const merger = new ESLintConfigMerger();
    merger.mergeConfig(filePath);
}

export default ESLintConfigMerger;