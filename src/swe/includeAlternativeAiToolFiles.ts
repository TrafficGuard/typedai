import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import yaml from 'js-yaml';
import { getFileSystem } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';

const CURSOR_RULES_FILE = '.cursorrules';
const CURSOR_RULES_DIR = '.cursor';
const CURSOR_RULES_SUBDIR = 'rules';
const CURSOR_RULES_EXT = '.mdc';
const AIDER_CONVENTIONS_FILE = 'CONVENTIONS.md';
// Contains which files should be included in the 'read' property (string or list)
const AIDER_CONFIG_FILE = '.aider.conf.yml';
const WINDSURF_GLOBAL_RULES_FILE = 'global_rules.md';
const WINDSURF_LOCAL_RULES_FILE = '.windsurfrules';
// DOCS.md in the current and parent folders (upto the vcs root) are included
const TYPEDAI_DOCS_FILE = 'DOCS.md';
// For Google Gemini CLI tool
const GEMINI_DOCS_FILE = 'GEMINI.md';
// https://agents.md A simple, open format for guiding coding agents
const AGENTS_FILE = 'AGENTS.md';
// Any markdown files placed in the .clinerules/ folder are automatically aggregated and appended to your prompt,
// exactly like the single .clinerules file, but with the flexibility of multiple files.
const CLINE_RULES = '.clinerules';

type AddFileCallback = (absolutePath: string) => void;

/**
 * Finds AI tool rules/documentation files (Cursor, Aider, Windsurf, TypedAI, Roo, Cline)
 * in the hierarchy of selected files and adds them to the selection if not already present.
 * Searches directories containing selected files and their ancestors up to VCS root/filesystem root.
 * @see https://docs.cursor.com/context/rules
 * @see https://docs.windsurf.com/windsurf/memories#windsurfrules
 * @see https://aider.chat/docs/usage/conventions.html
 * @param fileSelection Paths relative to CWD of currently selected files.
 * @param options Optional: cwd (defaults to process.cwd()), vcsRoot (absolute path).
 * @returns Set of newly found AI tool file paths, relative to CWD.
 */
export async function includeAlternativeAiToolFiles(fileSelection: string[], options?: { cwd?: string; vcsRoot?: string }): Promise<Set<string>> {
	const fss = getFileSystem();
	const cwd = resolve(options?.cwd ?? fss.getWorkingDirectory());
	const absoluteVcsRoot = options?.vcsRoot ? resolve(options.vcsRoot) : fss.getVcsRoot();
	const originalSelectionRelative = new Set(fileSelection.map((f) => f?.trim()).filter((f): f is string => !!f));
	const foundFilesRelative = new Set<string>();

	// Callback to add found files relative to CWD, avoiding duplicates from original selection
	const addFileCallback: AddFileCallback = (absolutePath: string) => {
		const relativePath = relative(cwd, absolutePath);
		if (!originalSelectionRelative.has(relativePath)) foundFilesRelative.add(relativePath);
	};

	const foldersToCheck = _collectRelevantFolders(originalSelectionRelative, cwd, absoluteVcsRoot);

	// Check all identified folders concurrently
	await Promise.all(Array.from(foldersToCheck).map((folder) => _checkFolderForAiFiles(folder, absoluteVcsRoot, addFileCallback)));

	return foundFilesRelative;
}

// =======================================================================
// Internal Helper Functions
// =======================================================================

/**
 * Collects unique absolute paths of directories to check.
 */
function _collectRelevantFolders(fileSelectionSet: Set<string>, cwd: string, absoluteVcsRoot?: string): Set<string> {
	const folderSet = new Set<string>([cwd]); // Always check CWD
	if (absoluteVcsRoot && cwd !== absoluteVcsRoot) {
		folderSet.add(absoluteVcsRoot); // Add VCS root if different
	}

	for (const file of fileSelectionSet) {
		let currentFolder = resolve(cwd, dirname(file));
		const isStartDirInOrEqVcs = absoluteVcsRoot && currentFolder.startsWith(absoluteVcsRoot);

		// Traverse up directory tree from file location
		while (currentFolder && currentFolder !== '/' && currentFolder !== '.') {
			folderSet.add(currentFolder);

			const parentFolder = dirname(currentFolder);
			if (parentFolder === currentFolder) break; // Reached filesystem root
			if (absoluteVcsRoot && currentFolder === absoluteVcsRoot && isStartDirInOrEqVcs) break; // Reached VCS root from within

			currentFolder = parentFolder;
		}
	}
	return folderSet;
}

/**
 * Checks a single folder for all relevant AI tool files.
 */
async function _checkFolderForAiFiles(folder: string, absoluteVcsRoot: string | undefined, addFileCallback: AddFileCallback): Promise<void> {
	const checks: Promise<void>[] = [
		_checkSimpleFilesExist(folder, addFileCallback),
		_checkCursorRulesDir(folder, addFileCallback),
		_checkAiderConfig(folder, addFileCallback),
	];

	// Check for Windsurf global rules only if in the VCS root
	if (absoluteVcsRoot && folder === absoluteVcsRoot) {
		checks.push(_checkFileExists(folder, WINDSURF_GLOBAL_RULES_FILE, addFileCallback));
	}

	await Promise.all(checks);
}

/**
 * Checks if a specific file exists in a folder and calls the callback if it does.
 */
async function _checkFileExists(folder: string, filename: string, addFileCallback: AddFileCallback): Promise<void> {
	const absolutePath = join(folder, filename);
	try {
		const stats = await lstat(absolutePath);
		if (stats.isFile()) addFileCallback(absolutePath);
	} catch {} // Ignore errors (file not found, permissions etc.)
}

/**
 * Checks for multiple simple, single AI tool files in the given folder.
 */
async function _checkSimpleFilesExist(folder: string, addFileCallback: AddFileCallback): Promise<void> {
	const filesToCheck = [CURSOR_RULES_FILE, AIDER_CONVENTIONS_FILE, WINDSURF_LOCAL_RULES_FILE, TYPEDAI_DOCS_FILE, GEMINI_DOCS_FILE, AGENTS_FILE];
	await Promise.all(filesToCheck.map((filename) => _checkFileExists(folder, filename, addFileCallback)));
}

/**
 * Checks for Cursor rules within the .cursor/rules/ directory.
 */
async function _checkCursorRulesDir(folder: string, addFileCallback: AddFileCallback): Promise<void> {
	const rulesDirPath = join(folder, CURSOR_RULES_DIR, CURSOR_RULES_SUBDIR);
	try {
		const entries = await readdir(rulesDirPath, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith(CURSOR_RULES_EXT)) {
				addFileCallback(join(rulesDirPath, entry.name));
			}
		}
	} catch {} // Ignore errors (dir not found, permissions etc.)
}

/**
 * Checks for Aider config, parses it, and checks files listed in its 'read' property.
 */
async function _checkAiderConfig(folder: string, addFileCallback: AddFileCallback): Promise<void> {
	const configPath = join(folder, AIDER_CONFIG_FILE);
	let configContent: string;

	// Check if config file exists and read it
	try {
		const stats = await lstat(configPath);
		if (!stats.isFile()) return; // Not a file
		configContent = await readFile(configPath, 'utf-8');
	} catch {
		return; // Config file doesn't exist or couldn't be read, stop processing it
	}

	// Parse the config content
	let config: any;
	try {
		config = yaml.load(configContent);
	} catch (error: any) {
		logger.warn(`Failed to parse YAML ${configPath}: ${error.message}`);
		return; // Stop if parsing fails
	}

	// Process the 'read' property
	if (!config?.read) return; // No 'read' property
	const filesToRead = Array.isArray(config.read) ? config.read : [config.read];

	// Check each file listed in 'read' concurrently
	await Promise.all(
		filesToRead.map(async (file) => {
			if (typeof file !== 'string') return; // Ignore non-string entries

			const filePath = join(folder, file); // Resolve path relative to config file's folder
			try {
				const fileStats = await lstat(filePath);
				if (fileStats.isFile()) addFileCallback(filePath);
				else logger.warn(`File '${file}' listed in ${configPath} not found or not a file.`);
			} catch {
				logger.warn(`File '${file}' listed in ${configPath} not found.`);
			}
		}),
	);
}
