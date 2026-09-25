// The complete set of tags a recipe may use. Keys are what goes in a recipe's
// `tags:` front matter; values are the labels shown in the UI. Key order here
// is the order the filter chips appear in.
//
// A recipe using a tag that isn't listed here fails the build — see
// loadRecipes() in ./recipes.js.
const recipeTags = {
    ai: 'AI',
    auth: 'Auth',
    fs: 'File System',
    kv: 'Key-Value',
    hosting: 'Hosting',
    workers: 'Workers',
    ui: 'UI',
    performance: 'Performance',
    'data-modeling': 'Data Modeling',
};

module.exports = recipeTags;
