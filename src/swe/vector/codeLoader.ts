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
 * @param excludeDirs Optional array of directory names to exclude.
 * @returns A promise that resolves to an array of CodeFile objects.
 */
export async function readFilesToIndex(sourceDir: string, excludeDirs: string[] = ['node_modules', '.git', 'dist', 'build']): Promise<CodeFile[]> {
	logger.info(`Scanning directory: ${sourceDir}`);
	const pattern = `**/*.{${SUPPORTED_EXTENSIONS.join(',')}}`;
	const ignorePatterns = excludeDirs.map((dir) => `**/${dir}/**`);

	const files = await fg(pattern, {
		cwd: sourceDir,
		absolute: true,
		ignore: ignorePatterns,
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
