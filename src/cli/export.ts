import * as path from 'path';
import * as fs from 'fs/promises'; // Use fs.promises for async operations
import micromatch from 'micromatch';

import { FileSystemService } from '#functions/storage/fileSystemService'; // Assuming this path alias works

/**
 * Recursively finds all file paths within a directory.
 * @param dir - The directory to start searching from.
 * @returns A promise that resolves to an array of file paths.
 */
async function getAllFiles(dir: string): Promise<string[]> {
	let files: string[] = [];
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.resolve(dir, entry.name); // Get absolute path
			if (entry.isDirectory()) {
				// Important: Handle potential errors during recursion (e.g., permission denied)
				try {
					files = files.concat(await getAllFiles(fullPath));
				} catch (recursiveError) {
					console.warn(`⚠️  Skipping directory due to error: ${fullPath} (${recursiveError.message})`);
				}
			} else if (entry.isFile()) {
				// Store paths relative to the initial CWD for better matching
				files.push(path.relative(process.cwd(), fullPath));
				//  files.push(fullPath); // Use absolute if preferred, but relative often matches user input better
			}
		}
	} catch (readdirError) {
		// Handle errors reading the directory itself (e.g., doesn't exist, permissions)
		console.error(`❌ Error reading directory ${dir}: ${readdirError.message}`);
		// Decide if you want to throw, return empty, or just log
		// For a CLI tool, logging and continuing might be better than halting completely
	}
	return files;
}

async function main() {
	// 1. Get glob patterns from command line arguments
	const patterns = process.argv.slice(2); // Exclude 'node' and script path

	if (patterns.length === 0) {
		console.error('Error: No glob patterns provided.');
		console.error('\nUsage:');
		console.error('  npm run export <pattern1> [pattern2] ...');
		console.error('  node dist/export-cli-micromatch.js <pattern1> [pattern2] ...'); // If compiled
		console.error('\nExample:');
		console.error("  npm run export 'docs/**/*.md' 'src/agent/*.ts' package.json");
		process.exit(1);
	}

	console.log(`🔍 Using patterns: ${patterns.join(', ')}`);

	try {
		// 2. Get ALL files recursively from the current working directory
		// NOTE: This is the inefficient part compared to using 'glob'. It reads
		// potentially many files before filtering.
		console.log(`📂 Reading all files recursively from: ${process.cwd()}`);
		const allFiles = await getAllFiles(process.cwd());
		console.log(`   Found ${allFiles.length} total files/symlinks initially.`);
		if (allFiles.length > 5000) {
			// Add a warning for large directories
			console.warn(`   ⚠️ Reading a large number of files (${allFiles.length}), this might be slow.`);
		}

		// 3. Use micromatch to filter the list of all files
		console.log('🛡️ Applying micromatch filtering...');
		const matchedFiles = micromatch(allFiles, patterns, {
			dot: true, // Match dotfiles (like .env)
			// matchBase: true, // Use if you want `*.ts` to match `src/index.ts` (like minimatch `matchBase`)
			// nocase: true, // For case-insensitive matching if needed
			// posix: true, // Enforces posix path separators for matching consistency might be safer
			// cwd: process.cwd(), // Often used with micromatch patterns, may help if patterns assume CWD
		});

		if (matchedFiles.length === 0) {
			console.log('❓ No files matched the provided patterns after filtering.');
			process.exit(0);
		}

		console.log(`🎯 Matched ${matchedFiles.length} file(s):`);
		// Optionally list files
		matchedFiles.slice(0, 20).forEach((f) => console.log(`   - ${f}`));
		if (matchedFiles.length > 20) {
			console.log(`   ... and ${matchedFiles.length - 20} more`);
		}
		console.log('---'); // Separator

		// 4. Ensure paths are absolute before passing to FileSystemService if it requires them
		// (Our getAllFiles returns relative, adjust if needed)
		const absoluteMatchedFiles = matchedFiles.map((f) => path.resolve(process.cwd(), f));

		// 5. Pass the filtered file paths to your service
		const fileSystemService = new FileSystemService();
		console.log('⚙️ Reading matched files and converting to XML...');
		const content = await fileSystemService.readFilesAsXml(absoluteMatchedFiles); // Use absolute paths

		// 6. Print the final XML output
		// console.log("\n--- XML Output ---");
		// console.log(content);
		// console.log("--- End XML Output ---");
		await fs.writeFile('export.xml', content);
	} catch (error) {
		console.error('\n❌ An error occurred during processing:');
		console.error(error);
		process.exit(1);
	}
}

// Execute the main function
main().catch((error) => {
	console.error('\n💥 An unexpected critical error occurred:');
	console.error(error);
	process.exit(1);
});
