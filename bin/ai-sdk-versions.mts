import * as fs from 'fs/promises'; // Use promises version for async/await
import * as path from 'path';

// Official provider packages are at https://github.com/vercel/ai/tree/main/packages

// Define a basic type for the structure of package.json we care about
interface PackageJson {
    dependencies?: {
        [key: string]: string;
    };
    // We don't need devDependencies, peerDependencies etc. for this task,
    // but you could add them here if needed.
}

/**
 * Analyzes package.json files under node_modules/@ai-sdk/
 * to find the versions of @ai-sdk/provider and @ai-sdk/provider-utils
 * in their dependencies.
 */
async function analyzeAiSdkDependencies(): Promise<void> {
    const nodeModulesPath = path.join(process.cwd(), 'node_modules');
    const aiSdkDir = path.join(nodeModulesPath, '@ai-sdk');

    console.log(`--- Analyzing dependencies under ${aiSdkDir} ---`);
    console.log(`(Ensure you are running this from your project's root directory)`);
    console.log('--------------------------------------------------\n');


    try {
        // Check if the base node_modules/@ai-sdk directory exists
        try {
            await fs.access(aiSdkDir);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                console.error(`Error: Directory not found: ${aiSdkDir}`);
                console.error("Please ensure you are running this script from your project's root directory and have installed your @ai-sdk packages.");
            } else {
                console.error(`An unexpected error occurred checking directory ${aiSdkDir}: ${error.message}`);
            }
            return; // Exit the function if the directory isn't found or accessible
        }

        // Read the list of entries (files/directories) within @ai-sdk
        const entries = await fs.readdir(aiSdkDir);

        let providerVersion;
        let providerUtilVersion;

        // Process each entry found in the @ai-sdk directory
        for (const entryName of entries) {
            if(entryName === 'ui-utils' || entryName === 'react') continue;
            const packageJsonPath = path.join(aiSdkDir, entryName, 'package.json');

            if (entryName === 'provider' || entryName === 'provider-utils') {
                const fileContent = await fs.readFile(packageJsonPath, 'utf8');
                const packageJson: any = JSON.parse(fileContent);
                if(entryName === 'provider-utils') {
                    providerUtilVersion = packageJson.version
                }
                if(entryName === 'provider') {
                    providerVersion = packageJson.version
                }
                continue;
            }

            console.log(`--- ${entryName} ---`);

            try {
                // Check if the entry is likely a directory by trying to access its package.json
                // This implicitly handles non-directories or directories without package.json
                await fs.access(packageJsonPath, fs.constants.R_OK); // Check if file exists and is readable

                // Read and parse the package.json file
                const fileContent = await fs.readFile(packageJsonPath, 'utf8');
                const packageJson: PackageJson = JSON.parse(fileContent);

                const dependencies = packageJson.dependencies;

                // Check if the dependencies block exists and is an object
                if (dependencies && typeof dependencies === 'object') {
                    const providerVersion = dependencies['@ai-sdk/provider'];
                    const providerUtilsVersion = dependencies['@ai-sdk/provider-utils'];

                    if (providerVersion !== undefined) {
                        console.log(`  @ai-sdk/provider: ${providerVersion}`);
                    } else {
                        console.log(`  @ai-sdk/provider: Not found in dependencies`);
                    }

                    if (providerUtilsVersion !== undefined) {
                        console.log(`  @ai-sdk/provider-utils: ${providerUtilsVersion}`);
                    } else {
                        console.log(`  @ai-sdk/provider-utils: Not found in dependencies`);
                    }
                } else {
                    console.log('  No "dependencies" block found in package.json');
                }

            } catch (error: any) {
                // Handle errors specific to processing one package.json file
                if (error.code === 'ENOENT') {
                    // File not found (most likely because entryName wasn't a directory with a package.json)
                    console.warn(`  Warning: No package.json found or accessible at ${packageJsonPath}`);
                } else if (error instanceof SyntaxError) {
                    // JSON parsing error
                    console.warn(`  Warning: Invalid JSON in ${packageJsonPath}: ${error.message}`);
                } else {
                    // Other potential errors like permissions issues
                    console.error(`  Error processing package.json for ${entryName}: ${error.message}`);
                }
            }
            console.log(''); // Add a blank line for separation between packages
        }

        console.log();
        console.log('Provider version: ', providerVersion);
        console.log('Provider util version: ', providerUtilVersion);
        console.log();

        console.log('--- Analysis Complete ---');

    } catch (error: any) {
        // Handle errors during the initial directory read or other unexpected issues
        console.error(`An unexpected error occurred during analysis: ${error.message}`);
    }
}

// Execute the function
analyzeAiSdkDependencies().catch(console.error);