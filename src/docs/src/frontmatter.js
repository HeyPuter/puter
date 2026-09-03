const yaml = require('js-yaml');

// Splits a markdown file into its YAML front matter and the body that follows.
// Files without front matter come back with an empty object and untouched content.
function parseFrontMatter (fileContent) {
    const frontMatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = fileContent.match(frontMatterRegex);

    if ( match ) {
        const [, frontMatterYaml, content] = match;
        const frontMatter = yaml.load(frontMatterYaml);
        return { frontMatter, content };
    }

    return { frontMatter: {}, content: fileContent };
}

module.exports = { parseFrontMatter };
