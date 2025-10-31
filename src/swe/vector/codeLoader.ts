import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import fg from 'fast-glob';
import pino from 'pino';

const logger = pino({ name: 'CodeLoader' });

const SUPPORTED_EXTENSIONS = [
	'ts',
	'js',
	'py',
	'java',
	'go',
	'rb',
	'cs',
	// Add more extensions as needed
];

export interface CodeFile {
	filePath: string;
	content: string;
	language: string;
}

/**
 * Recursively scans a directory for source code files with supported extensions.
 * @param sourceDir The root directory to scan.
 * @param subFolder Only include files under this folder
 * @param includePatterns Optional array of glob patterns to include (e.g., ['src/**', 'lib/**']).
 *                        If not provided, defaults to scanning all files with supported extensions,
 *                        excluding common build/dependency directories.
 * @returns A promise that resolves to an array of CodeFile objects.
 */
export async function readFilesToIndex(sourceDir: string, subFolder = './', includePatterns?: string[]): Promise<CodeFile[]> {
	logger.info(`Scanning directory: ${sourceDir}`);

	// If no include patterns specified, use default pattern that scans all supported extensions
	// but excludes common build/dependency directories
	let patterns: string[];
	const defaultIgnores = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache'];

	if (includePatterns && includePatterns.length > 0) {
		// User specified include patterns - respect them exactly
		patterns = includePatterns;
		logger.info(`Using include patterns: ${patterns.join(', ')}`);
	} else {
		// No include patterns - use default: all supported extensions
		patterns = [`**/*.{${SUPPORTED_EXTENSIONS.join(',')}}`];
		logger.info('Using default pattern with common exclusions');
	}

	const files = await fg(patterns, {
		cwd: path.join(sourceDir, subFolder),
		absolute: true,
		ignore: includePatterns && includePatterns.length > 0 ? [] : defaultIgnores.map((dir) => `**/${dir}/**`),
		dot: false, // Ignore dotfiles/dotfolders like .git
	});

	logger.info(`Found ${files.length} code files.`);

	const codeFiles: CodeFile[] = [];
	for (const filePath of files) {
		try {
			const content = await fs.readFile(filePath, 'utf-8');
			const language = path.extname(filePath).substring(1);
			codeFiles.push({
				filePath: path.relative(sourceDir, filePath),
				content,
				language,
			});
		} catch (error) {
			logger.error(`Error reading file ${filePath}: ${error}`);
		}
	}

	return codeFiles;
}
