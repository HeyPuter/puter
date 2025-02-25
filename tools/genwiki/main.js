const { walk, EXCLUDE_LISTS } = require('../file-walker/test');
const fs = require('fs').promises;
const path_ = require('node:path');

const FILE_EXCLUDES = [
    /(^|\/)\.git/,
    /^volatile\//,
    /^node_modules\//,
    /\/node_modules$/,
    /^submodules\//,
    /^node_modules$/,
    /package-lock\.json/,
    /^src\/dev-center\/js/,
    /src\/backend\/src\/public\/assets/,
    /^src\/gui\/src\/lib/,
    /^eslint\.config\.js$/,
    
    // translation readme copies
    /(^|\/)doc\/i18n/,
    
    // irrelevant documentation
    /(^|\/)doc\/graveyard/,
    
    // development logs
    /\/devlog\.md$/,
]

const ROOT_DIR = path_.join(__dirname, '../..');
const WIKI_DIR = path_.join(__dirname, '../../submodules/wiki');

const path_to_name = path => {
    // Remove src/ and doc/ components
    // path = path.replace(/src\//g, '')
    path = path.replace(/doc\//g, '')
    // Hyphenate components
    path = path.replace(/-/g, '_')
    path = path.replace(/\//g, '-')
    // Remove extension
    path = path.replace(/\.md$/, '')
    return path;
}

const fix_relative_links = (content, entry) => {
    const originalDir = path_.dirname(entry);
    
    // Markdown links: [text](path/to/file.md), [text](path/to/file#section), etc
    return content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, link) => {
        // Skip external links
        if (link.startsWith('http://') || link.startsWith('https://') || link.startsWith('/')) {
            return match;
        }
        
        // Anchor links within the same file aren't changed
        if (link.startsWith('#')) return match;
        
        // Split the link to separate the path from the anchor
        const [linkPath, anchor] = link.split('#');
        
        // Resolve the relative path
        let resolvedPath = path_.normalize(path_.join(originalDir, linkPath));
        
        // Find the matching wiki path
        const wikiPath = path_to_name(resolvedPath);
        const newLink = anchor ? `${wikiPath}#${anchor}` : wikiPath;
        return `[${text}](${newLink})`;
    });
};

const main = async () => {
    const walk_iter = walk({
        excludes: FILE_EXCLUDES,
    }, ROOT_DIR);
    
    const documents = [];
    
    for await ( const value of walk_iter ) {
        let path = value.path;
        path = path_.relative(ROOT_DIR, path);

        // File must be under a doc/ directory
        if ( ! path.match(/(^|\/)doc\//) ) continue;
        // File must be markdown
        if ( ! path.match(/\.md/) ) continue;
        
        let outputName = path_to_name(path);
        
        // Read file content
        let content = await fs.readFile(value.path, 'utf8');
        
        // Get the first heading from the file to use as title
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1] : outputName.replace(/-/g, ' ');
        
        // Fix internal links
        content = fix_relative_links(content, path);
        
        // Write the modified content to the wiki directory
        await fs.writeFile(path_.join(WIKI_DIR, outputName + '.md'), content);
        
        // Store information for sidebar
        const sidebarPath = outputName.split('-');
        
        // The original path structure (minus doc/) helps determine the hierarchy
        documents.push({
            sidebarPath,
            outputName,
            title: title
        });
    }

    // Generate _Sidebar.md
    const sidebarContent = generate_sidebar(documents);
    await fs.writeFile(path_.join(WIKI_DIR, '_Sidebar.md'), sidebarContent);
}

const format_name = name => {
    if ( name === 'api' ) return 'API';
    if ( name === 'contributors' ) return 'For Contributors';
    return name.charAt(0).toUpperCase() + name.slice(1);
}

const generate_sidebar = (documents) => {
    // Sort entries by path to group related files together
    documents.sort((a, b) => {
        const pathA = a.sidebarPath.slice(0, -1).join('/');
        const pathB = b.sidebarPath.slice(0, -1).join('/');

        if ( pathA !== pathB ) {
            return pathA.localeCompare(pathB);
        }
        
        // README.md always goes first
        const isReadmeA = a.outputName.toLowerCase().includes('readme');
        const isReadmeB = b.outputName.toLowerCase().includes('readme');
        if (isReadmeA) return -1;
        if (isReadmeB) return 1;
        
        return a.title.localeCompare(b.title);
    });
    
    // Format a document link the same way everywhere
    const formatDocumentLink = (document) => {
        let title = document.title;
        if ( document.outputName.split('-').slice(-1)[0].toLowerCase() === 'readme' ) {
            title = 'Index (README.md)';
        }
        return `* [${title}](${document.outputName.replace('.md', '')})\n`;
    };
    
    // Recursive function to build sidebar sections
    const buildSection = (docs, depth = 0, prefix = '') => {
        let result = '';
        const directDocs = [];
        const subSections = new Map();
        
        // Separate direct documents from those in subsections
        for (const doc of docs) {
            if (doc.sidebarPath.length <= depth + 1) {
                // Direct document at this level
                directDocs.push(doc);
            } else {
                // Document belongs in a subsection
                const sectionName = doc.sidebarPath[depth];
                if (!subSections.has(sectionName)) {
                    subSections.set(sectionName, []);
                }
                subSections.get(sectionName).push(doc);
            }
        }
        
        // Add direct documents
        for (const doc of directDocs) {
            result += formatDocumentLink(doc);
        }
        
        // Process subsections recursively
        for (const [sectionName, sectionDocs] of subSections.entries()) {
            // Generate heading with appropriate level
            const headingLevel = '#'.repeat(depth + 2);
            const formattedName = format_name(sectionName)
            
            result += `\n${headingLevel} ${formattedName}\n`;
            
            // Process the subsection documents
            result += buildSection(sectionDocs, depth + 1, `${prefix}${sectionName}/`);
        }
        
        return result;
    };
    
    // Start with the main heading
    let sidebar = "## General\n\n";
    
    // Split documents into top-level and those in sections
    const topLevelDocs = documents.filter(doc => doc.sidebarPath.length <= 1);
    const sectionDocs = documents.filter(doc => doc.sidebarPath.length > 1);
    
    // Add top-level documents
    for (const doc of topLevelDocs) {
        sidebar += formatDocumentLink(doc);
    }
    
    // Group the remaining documents by their top-level sections
    const topLevelSections = new Map();
    for (const doc of sectionDocs) {
        const sectionName = doc.sidebarPath[0];
        if (!topLevelSections.has(sectionName)) {
            topLevelSections.set(sectionName, []);
        }
        topLevelSections.get(sectionName).push(doc);
    }
    
    // Process each top-level section
    for (const [sectionName, sectionDocs] of topLevelSections.entries()) {
        const formattedName = format_name(sectionName);
        sidebar += `\n## ${formattedName}\n`;
        sidebar += buildSection(sectionDocs, 1, `${sectionName}/`);
    }
    
    return sidebar;
};

main();
