// docgen/generate-docs.js
import { generateDocsForRegistry } from './DocumentationGenerator.js';

import commonRegistrants from '../common/definitions.js';
import anthropicRegistrants from '../anthropic/index.js';
import openaiRegistrants from '../openai/index.js';

// Generate documentation for all your registrants
const docs = generateDocsForRegistry(
    commonRegistrants,
    anthropicRegistrants, 
    openaiRegistrants
);

console.log(docs);

// Or write to file
import { writeFileSync } from 'fs';
writeFileSync('REGISTRY_DOCS.md', docs);

// You could also generate docs for specific subsets
const anthropicDocs = generateDocsForRegistry(anthropicRegistrants);
writeFileSync('ANTHROPIC_DOCS.md', anthropicDocs);

const openaiDocs = generateDocsForRegistry(openaiRegistrants);
writeFileSync('OPENAI_DOCS.md', openaiDocs);