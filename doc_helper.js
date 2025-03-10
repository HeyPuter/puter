import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function extractEventsFromFile(filePath, seenEvents) {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Use a more general regex to capture all event emissions
    // This captures the event name and whatever is passed as the second argument
    const regex = /svc_event\.emit\(['"]([^'"]+)['"]\s*,\s*([^)]+)\)/g;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
        const eventName = match[1];
        const eventId = `core.${eventName}`;
        const eventArg = match[2].trim();
        
        // Check if this file contains code that might affect event.allow
        const hasAllowEffect = content.includes('event.allow') || 
                              content.includes('.allow =') || 
                              content.includes('.allow=');
        
        // Skip if we've already seen this event
        if (seenEvents.has(eventId)) continue;
        
        // Generate description based on event name
        let description = generateDescription(eventName);
        let propertyDetails = {};
        
        // Case 1: Inline object - extract properties directly
        if (eventArg.startsWith('{')) {
            // Extract properties from inline object
            const propertiesMatch = eventArg.match(/{([^}]*)}/);
            if (propertiesMatch) {
                const propertiesText = propertiesMatch[1];
                extractProperties(propertiesText, propertyDetails, hasAllowEffect, eventName);
            }
        } 
        // Case 2: Variable reference - find variable definition
        else {
            const varName = eventArg.trim();
            // Look for variable definition patterns like: const event = { prop1: value1 };
            const varDefRegex = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*{([^}]*)}`, 'g');
            let varMatch;
            
            if ((varMatch = varDefRegex.exec(content)) !== null) {
                const propertiesText = varMatch[1];
                extractProperties(propertiesText, propertyDetails, hasAllowEffect, eventName);
            }
        }
        
        // Add the event to our collection
        seenEvents.set(eventId, {
            id: eventId,
            event: eventName,
            filename: path.basename(filePath),
            description: description,
            properties: propertyDetails
        });
    }
}

// Helper function to extract properties from a properties text string
function extractProperties(propertiesText, propertyDetails, hasAllowEffect, eventName) {
    const properties = propertiesText
        .split(/\s*,\s*/)
        .map(prop => prop.split(':')[0].trim())
        .filter(prop => prop);
    
    // Generate property details
    properties.forEach(prop => {
        propertyDetails[prop] = {
            type: guessType(prop),
            mutability: hasAllowEffect ? 'effect' : 'no-effect',
            summary: guessSummary(prop, eventName)
        };
    });
}

function generateDescription(eventName) {
    const parts = eventName.split('.');
    
    if (parts.length >= 2) {
        const system = parts[0];
        const action = parts.slice(1).join('.');
        
        if (action.includes('create')) {
            return `This event is emitted when a ${parts[parts.length - 1]} is created.`;
        } else if (action.includes('update') || action.includes('write')) {
            return `This event is emitted when a ${parts[parts.length - 1]} is updated.`;
        } else if (action.includes('delete') || action.includes('remove')) {
            return `This event is emitted when a ${parts[parts.length - 1]} is deleted.`;
        } else if (action.includes('progress')) {
            return `This event reports progress of a ${parts[parts.length - 1]} operation.`;
        } else if (action.includes('validate')) {
            return `This event is emitted when a ${parts[parts.length - 1]} is being validated.\nThe event can be used to block certain ${parts[parts.length - 1]}s from being validated.`;
        } else {
            return `This event is emitted for ${system} ${action.replace(/[-\.]/g, ' ')} operations.`;
        }
    }
    
    return `This event is emitted for ${eventName} operations.`;
}

function guessType(propertyName) {
    // Guess the type based on property name
    if (propertyName === 'node') return 'FSNodeContext';
    if (propertyName === 'context') return 'Context';
    if (propertyName === 'user') return 'User';
    if (propertyName.includes('path')) return 'string';
    if (propertyName.includes('id')) return 'string';
    if (propertyName.includes('name')) return 'string';
    if (propertyName.includes('progress')) return 'number';
    if (propertyName.includes('tracker')) return 'ProgressTracker';
    if (propertyName.includes('meta')) return 'object';
    if (propertyName.includes('policy')) return 'Policy';
    if (propertyName.includes('allow')) return 'boolean';
    
    return 'any';
}

function guessSummary(propertyName, eventName) {
    // Generate summary based on property name and event context
    if (propertyName === 'node') {
        const entityType = eventName.split('.').pop();
        return `the ${entityType} that was affected`;
    }
    if (propertyName === 'context') return 'current context';
    if (propertyName === 'user') return 'user associated with the operation';
    if (propertyName.includes('path')) return 'path to the affected resource';
    if (propertyName.includes('tracker')) return 'tracks progress of the operation';
    if (propertyName.includes('meta')) return 'additional metadata for the operation';
    if (propertyName.includes('policy')) return 'policy information for the operation';
    if (propertyName.includes('allow')) return 'whether the operation is allowed';
    
    // Default summary based on property name
    return propertyName.replace(/_/g, ' ');
}

function scanDirectory(directory, seenEvents) {
    const files = fs.readdirSync(directory);
    
    for (const file of files) {
        const filePath = path.join(directory, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            scanDirectory(filePath, seenEvents);
        } else if (file.endsWith('.js')) {
            try {
                extractEventsFromFile(filePath, seenEvents);
            } catch (error) {
                console.error(`Error processing file ${filePath}: ${error.message}`);
            }
        }
    }
}

function generateTestExtension(events) {
    let code = `// Test extension for event listeners\n\n`;
    
    events.forEach(event => {
        code += `extension.on('${event.id}', event => {\n`;
        code += `    console.log('GOT ${event.event.toUpperCase()} EVENT', event);\n`;
        code += `});\n\n`;
    });
    
    return code;
}

function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error('Usage: node doc_helper.js <directory> [output_file] [--generate-test] [--test-dir=<directory>]');
        process.exit(1);
    }
    
    const directory = args[0];
    let outputFile = null;
    let generateTest = false;
    let testOutputDir = "./extensions/";
    
    // Parse arguments
    for (let i = 1; i < args.length; i++) {
        if (args[i] === '--generate-test') {
            generateTest = true;
        } else if (args[i].startsWith('--test-dir=')) {
            testOutputDir = args[i].substring('--test-dir='.length);
        } else {
            outputFile = args[i];
        }
    }
    
    const seenEvents = new Map();
    
    scanDirectory(directory, seenEvents);
    
    const result = Array.from(seenEvents.values());
    
    // Sort events alphabetically
    result.sort((a, b) => a.event.localeCompare(b.event));
    
    // Format the output to match events.json.js
    const formattedOutput = formatEventsOutput(result);
    
    // Output the result
    if (outputFile) {
        fs.writeFileSync(outputFile, formattedOutput);
        console.log(`Event metadata written to ${outputFile}`);
    } else {
        console.log(formattedOutput);
    }
    
    // Generate test extension file if requested
    if (generateTest) {
        const testCode = generateTestExtension(result);
        
        // Ensure the output directory exists
        if (!fs.existsSync(testOutputDir)) {
            fs.mkdirSync(testOutputDir, { recursive: true });
        }
        
        const testFilePath = path.join(testOutputDir, 'testex.js');
        fs.writeFileSync(testFilePath, testCode);
        console.log(`Test extension file generated: ${testFilePath}`);
    }
}

/**
 * Format the events data to match the events.json.js format
 */
function formatEventsOutput(events) {
    let output = 'export default [\n';
    
    events.forEach((event, index) => {
        output += '    {\n';
        output += `        id: 'core.${event.event}',\n`;
        output += `        description: \`\n`;
        
        // Format the description with proper indentation
        const descriptionLines = event.description.split('\n');
        descriptionLines.forEach(line => {
            output += `            ${line}\n`;
        });
        
        output += `        \`,\n`;
        
        // Add properties if they exist
        if (Object.keys(event.properties).length > 0) {
            output += '        properties: {\n';
            
            Object.entries(event.properties).forEach(([propName, propDetails], propIndex) => {
                output += `            ${propName}: {\n`;
                output += `                type: '${propDetails.type}',\n`;
                output += `                mutability: '${propDetails.mutability === 'effect' ? 'mutable' : 'no-effect'}',\n`;
                output += `                summary: '${propDetails.summary}',\n`;
                
                // Add notes array with appropriate content
                if (propName === 'allow' && event.event.includes('validate')) {
                    output += `                notes: [\n`;
                    output += `                    'If set to false, the ${event.event.split('.')[0]} will be considered invalid.',\n`;
                    output += `                ],\n`;
                } else if (propName === 'email' && event.event.includes('validate')) {
                    output += `                notes: [\n`;
                    output += `                    'The email may have already been cleaned.',\n`;
                    output += `                ],\n`;
                } else {
                    output += `                notes: [],\n`;
                }
                
                output += '            }';
                
                // Add comma if not the last property
                if (propIndex < Object.keys(event.properties).length - 1) {
                    output += ',';
                }
                
                output += '\n';
            });
            
            output += '        },\n';
        }
        
        output += '    }';
        
        // Add comma if not the last event
        if (index < events.length - 1) {
            output += ',';
        }
        
        output += '\n';
    });
    
    output += '];\n';
    
    return output;
}

main();
