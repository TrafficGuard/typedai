import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { join } from 'node:path';
import micromatch from 'micromatch';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { countTokens } from '#llm/tokens';

/**
 * If there are no arguments then only write the exported contents to the console
 * If there is the -v arg then write the additional debug info
 * If there is the -f arg write it to a file. Default to export.xml. If a value is provided, e.g. -f=export2.xml then write to export2.xml
 */
async function main() {
	const fileSystemService = new FileSystemService();
	const basePath = fileSystemService.getBasePath();

	// ---------------------------------------------------------------------------
	// CLI flags
	//    -v / --verbose         → extra console output
	//    -f[=<name>]            → write output to file (default export.xml)
	//    positional args        → glob patterns or explicit file paths
	// ---------------------------------------------------------------------------
	const rawArgs = process.argv.slice(2);
	const verbose = rawArgs.includes('-v') || rawArgs.includes('--verbose');
	const fileFlag = rawArgs.find((a) => a === '-f' || a.startsWith('-f='));
	const outputFile = fileFlag
		? ((): string => {
				const [, val] = fileFlag.split('=');
				return (val?.trim() || 'export.xml').replace(/^\.?[\\/]/, '');
			})()
		: null;

	// build patterns list (strip control flags and optional --fs=… flag)
	const patterns = rawArgs.filter((a) => !a.startsWith('--fs=') && a !== '-v' && a !== '--verbose' && !(a === '-f') && !a.startsWith('-f='));

	const dbg = (...args: unknown[]) => {
		if (verbose) console.log(...args);
	};

	const noPatterns = patterns.length === 0;
	if (noPatterns) dbg('No patterns provided – exporting entire workspace.');

	let matchedFiles: string[] = [];

	try {
		if (!noPatterns) {
			// Determine if any pattern is a glob pattern. The shell will expand glob patterns before passing them to the CLI.
			const hasGlobPatterns = patterns.some((p) => micromatch.scan(p).isGlob);

			if (hasGlobPatterns) {
				dbg(`🔍  Using glob patterns: ${patterns.join(', ')}`);
				// 2. Get ALL files recursively from the current working directory
				// NOTE: This is the inefficient part compared to using 'glob'. It reads
				// potentially many files before filtering.
				dbg(`📂  Reading all files recursively from: ${basePath}`);
				const allFiles = await getAllFiles(basePath, basePath); // Pass basePath as root
				dbg(`   Found ${allFiles.length} total files/symlinks initially.`);
				if (allFiles.length > 5000) {
					// Add a warning for large directories
					console.warn(`   ⚠️  Reading a large number of files (${allFiles.length}), this might be slow.`);
				}

				// 3. Use micromatch to filter the list of all files
				dbg('🛡️ Applying micromatch filtering...');
				matchedFiles = micromatch(allFiles, patterns, {
					dot: true, // Match dotfiles (like .env)
					// matchBase: true, // Use if you want `*.ts` to match `src/index.ts` (like minimatch `matchBase`)
					// nocase: true, // For case-insensitive matching if needed
					// posix: true, // Enforces posix path separators for matching consistency might be safer
					cwd: basePath, // Use basePath as cwd for micromatch
				});
			} else {
				dbg(`ℹ️  No glob patterns detected. Processing as direct file paths: ${patterns.join(', ')}`);
				const validatedFilePaths: string[] = [];
				for (const p of patterns) {
					const absolutePath = path.resolve(basePath, p);
					try {
						const stats = await fs.stat(absolutePath);
						if (stats.isFile()) {
							// Store the original relative path 'p' as it's relative to basePath
							validatedFilePaths.push(p);
						} else {
							console.warn(`⚠️  Path matched but is not a file, skipping: ${p}`);
						}
					} catch (error: any) {
						if (error.code === 'ENOENT') {
							console.warn(`⚠️  File not found, skipping: ${p}`);
						} else {
							console.warn(`⚠️  Error accessing file ${p}, skipping: ${error.message}`);
						}
					}
				}
				matchedFiles = validatedFilePaths;
			}

			if (matchedFiles.length === 0) {
				if (hasGlobPatterns) {
					dbg('❓ No files matched the provided patterns after filtering.');
				} else {
					dbg('❓ No valid files found from the provided paths.');
				}
				process.exit(0);
			}
		} else {
			const allFiles = await getAllFiles(basePath, basePath);
			matchedFiles = allFiles;
		}

		dbg(`🎯 Matched ${matchedFiles.length} file(s):`);
		// Optionally list files
		matchedFiles.slice(0, 20).forEach((f) => dbg(`   - ${f}`));
		if (matchedFiles.length > 20) {
			dbg(`   ... and ${matchedFiles.length - 20} more`);
		}
		dbg('---'); // Separator

		// 4. Ensure paths are absolute before passing to FileSystemService if it requires them
		// (Our getAllFiles returns relative, adjust if needed)
		const absoluteMatchedFiles = matchedFiles.map((f) => path.resolve(basePath, f)); // Use basePath

		// 5. Pass the filtered file paths to your service
		dbg('⚙️  Reading matched files and converting to XML...');
		const content = await fileSystemService.readFilesAsXml(absoluteMatchedFiles); // Use the existing service instance
		dbg('⚙️  Counting tokens...');
		const tokens = await countTokens(content);
		// Add comma between 1000's
		const formattedTokens = tokens.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
		dbg(`export.xml token count: ${formattedTokens}`);

		const outputPath = join(basePath, outputFile);
		await fs.writeFile(outputPath, content);
		console.log(`Written to ${outputPath}`);
	} catch (error) {
		console.error('\n❌ An error occurred during processing:');
		console.error(error);
		process.exit(1);
	}
}

/**
 * Recursively finds all file paths within a directory.
 * @param dir - The directory to start searching from.
 * @returns A promise that resolves to an array of file paths.
 */
async function getAllFiles(dir: string, root: string = dir): Promise<string[]> {
	let files: string[] = [];
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.resolve(dir, entry.name); // Get absolute path
			if (entry.isDirectory()) {
				// Important: Handle potential errors during recursion (e.g., permission denied)
				try {
					files = files.concat(await getAllFiles(fullPath, root)); // Pass root
				} catch (recursiveError) {
					console.warn(`⚠️  Skipping directory due to error: ${fullPath} (${recursiveError.message})`);
				}
			} else if (entry.isFile()) {
				// Store paths relative to the initial CWD for better matching
				files.push(path.relative(root, fullPath)); // use supplied root instead of process.cwd()
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

main().catch((error) => {
	console.error('\n💥 An unexpected critical error occurred:');
	console.error(error);
	process.exit(1);
});
