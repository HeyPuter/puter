export class DocumentationGenerator {
    constructor() {
        this.providers = [];
    }

    /**
     * Apply definition functions to generate documentation
     * @param {...Function} definitionFns - Functions that take a define API and add definitions
     */
    applyDefinitions(...definitionFns) {
        const define = this.getDefineAPI();
        
        for (const definitionFn of definitionFns) {
            definitionFn(define);
        }
        
        return this;
    }
    
    /**
     * Get a human-readable name for a symbol
     */
    getSymbolName(symbol) {
        // Use symbol description if available
        const desc = symbol.description;
        if (desc) {
            return desc;
        }
        
        // Last resort: use toString
        return symbol.toString();
    }
    
    /**
     * Get the documentation API that mirrors Registry's getDefineAPI
     */
    getDefineAPI() {
        const docGen = this;
        
        const define = {
            howToGet(outputType) {
                const providerDoc = {
                    outputType,
                    inputTypes: [],
                    predicate: null,
                    description: null,
                    example: null
                };
                
                docGen.providers.push(providerDoc);
                
                const defineProviderAPI = {
                    from(...inputTypes) {
                        providerDoc.inputTypes = inputTypes;
                        return this;
                    },
                    provided(predicateDescription) {
                        // For documentation, we expect a string description instead of a function
                        if (typeof predicateDescription === 'string') {
                            providerDoc.predicate = predicateDescription;
                        } else {
                            providerDoc.predicate = 'Custom predicate function';
                        }
                        return this;
                    },
                    as(description) {
                        // For documentation, we expect a string description instead of a function
                        if (typeof description === 'string') {
                            providerDoc.description = description;
                        } else {
                            providerDoc.description = 'Custom provider function';
                        }
                        return this;
                    },
                    withExample(example) {
                        // Additional method for documentation
                        providerDoc.example = example;
                        return this;
                    }
                };
                
                return defineProviderAPI;
            }
        };
        
        return define;
    }
    
    /**
     * Generate markdown documentation
     */
    generateMarkdown() {
        const sections = [];
        
        // Group providers by output type
        const providersByOutput = new Map();
        for (const provider of this.providers) {
            const outputName = this.getSymbolName(provider.outputType);
            if (!providersByOutput.has(outputName)) {
                providersByOutput.set(outputName, []);
            }
            providersByOutput.get(outputName).push(provider);
        }
        
        // Generate header
        sections.push('# Provider Registry Documentation\n');
        sections.push('This document describes all the providers available in the registry and how to obtain different types of values.\n');
        
        // Generate table of contents
        sections.push('## Available Types\n');
        for (const outputName of providersByOutput.keys()) {
            sections.push(`- [${outputName}](#${outputName.toLowerCase().replace(/[^a-z0-9]/g, '-')})`);
        }
        sections.push('');
        
        // Generate sections for each output type
        for (const [outputName, providers] of providersByOutput.entries()) {
            sections.push(`## ${outputName}\n`);
            
            if (providers.length === 1) {
                const provider = providers[0];
                sections.push(this.generateProviderDoc(provider));
            } else {
                sections.push(`There are ${providers.length} ways to obtain **${outputName}**:\n`);
                providers.forEach((provider, index) => {
                    sections.push(`### Option ${index + 1}\n`);
                    sections.push(this.generateProviderDoc(provider));
                });
            }
        }
        
        return sections.join('\n');
    }
    
    /**
     * Generate documentation for a single provider
     */
    generateProviderDoc(provider) {
        const parts = [];
        
        // Requirements
        if (provider.inputTypes.length > 0) {
            const inputNames = provider.inputTypes.map(type => 
                `\`${this.getSymbolName(type)}\``
            ).join(', ');
            parts.push(`**Requires:** ${inputNames}\n`);
        } else {
            parts.push(`**Requires:** No inputs\n`);
        }
        
        // Predicate condition
        if (provider.predicate) {
            parts.push(`**When:** ${provider.predicate}\n`);
        }
        
        // Description
        if (provider.description) {
            parts.push(`**Produces:** ${provider.description}\n`);
        }
        
        // Example
        if (provider.example) {
            parts.push(`**Example:**\n\`\`\`javascript\n${provider.example}\n\`\`\`\n`);
        }
        
        return parts.join('\n') + '\n';
    }
    
    /**
     * Generate a simple tree view showing dependencies
     */
    generateDependencyTree() {
        const sections = [];
        sections.push('# Dependency Tree\n');
        
        const dependencies = new Map();
        
        // Build dependency map
        for (const provider of this.providers) {
            const outputName = this.getSymbolName(provider.outputType);
            const inputs = provider.inputTypes.map(type => this.getSymbolName(type));
            
            if (!dependencies.has(outputName)) {
                dependencies.set(outputName, new Set());
            }
            
            for (const input of inputs) {
                dependencies.get(outputName).add(input);
            }
        }
        
        // Find root nodes (types that don't depend on anything produced by other providers)
        const allOutputs = new Set(dependencies.keys());
        const allInputs = new Set();
        for (const inputSet of dependencies.values()) {
            for (const input of inputSet) {
                allInputs.add(input);
            }
        }
        
        const roots = [];
        for (const output of allOutputs) {
            if (!allInputs.has(output) || dependencies.get(output).size === 0) {
                roots.push(output);
            }
        }
        
        // Generate tree for each root
        const visited = new Set();
        for (const root of roots) {
            sections.push(this.generateTreeNode(root, dependencies, visited, 0));
        }
        
        return sections.join('\n');
    }
    
    generateTreeNode(nodeName, dependencies, visited, depth) {
        const indent = '  '.repeat(depth);
        const parts = [`${indent}- ${nodeName}`];
        
        if (visited.has(nodeName)) {
            parts[0] += ' (circular reference)';
            return parts.join('\n');
        }
        
        visited.add(nodeName);
        
        const deps = dependencies.get(nodeName);
        if (deps && deps.size > 0) {
            for (const dep of deps) {
                parts.push(this.generateTreeNode(dep, dependencies, new Set(visited), depth + 1));
            }
        }
        
        visited.delete(nodeName);
        return parts.join('\n');
    }
    
    /**
     * Generate comprehensive documentation including examples
     */
    generateFullDocumentation() {
        const sections = [];
        
        sections.push(this.generateMarkdown());
        sections.push('\n---\n');
        sections.push(this.generateDependencyTree());
        
        // Add usage examples
        sections.push('\n---\n');
        sections.push('# Usage Examples\n');
        sections.push(this.generateUsageExamples());
        
        return sections.join('\n');
    }
    
    generateUsageExamples() {
        const sections = [];
        
        sections.push('## Basic Usage\n');
        sections.push('```javascript\n');
        sections.push('const registry = new Registry();\n');
        sections.push('const obtain = registry.getObtainAPI();\n\n');
        sections.push('// Obtain a value with required inputs\n');
        sections.push('const result = await obtain(OUTPUT_TYPE, {\n');
        sections.push('  [INPUT_TYPE]: "input value"\n');
        sections.push('});\n');
        sections.push('```\n\n');
        
        sections.push('## Available Providers\n');
        sections.push('The following types can be obtained:\n\n');
        
        // List all output types
        const outputTypes = [...new Set(this.providers.map(p => this.getSymbolName(p.outputType)))];
        for (const outputType of outputTypes) {
            sections.push(`- **${outputType}**\n`);
        }
        
        return sections.join('\n');
    }
}

// Example usage with your Registry
export function generateDocsForRegistry(...definitionFns) {
    const docGen = new DocumentationGenerator();
    
    // Apply all the definition functions
    docGen.applyDefinitions(...definitionFns);
    
    return docGen.generateFullDocumentation();
}