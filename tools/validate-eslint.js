// This script does not validate that eslint rules are followed; it only
// ensures that the eslint configuration is valid. When there are errors
// present in the eslint configuration, vscode pretends everything is
// fine and that there are no linter errors in any files.

import { ESLint } from 'eslint';

async function validateConfig() {
    let exitWithError = false;

    try {
        const eslint = new ESLint();
        await eslint.lintText('', { filePath: 'src/gui/**/*.js' });
    } catch (error) {
        console.error('❌ ESLint configuration error (general):', error.message);
        exitWithError = true;
    }

    try {
        const eslint = new ESLint();
        await eslint.lintText('', { filePath: 'src/backend/**/*.js' });
    } catch (error) {
        console.error('❌ ESLint configuration error (backend):', error.message);
        exitWithError = true;
    }

    try {
        const eslint = new ESLint();
        await eslint.lintText('', { filePath: 'extensions/**/*.js' });
    } catch (error) {
        console.error('❌ ESLint configuration error (extensions):', error.message);
        exitWithError = true;
    }
    
    if ( exitWithError ) {
        console.log('\x1B[36;1mYou should edit eslint.config.js to resolve this issue.\x1B[0m');
        console.log('\x1B[31;1mIf this is an emergency, use `git commit --no-verify`.\x1B[0m');
        process.exit(1);
    }

    console.log('✅ ESLint configuration is valid');
}

validateConfig();
