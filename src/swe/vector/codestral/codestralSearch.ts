import { promises as fs } from 'node:fs'; // Using async fs as per project DOCS.md
import * as path from 'node:path';
import { Mistral } from '@mistralai/mistralai';
import type { CodeDoc, Corpus } from './types';

/** The number of top-k most similar documents to retrieve in a search. */
export const TOP_K = 5;
/** The specific Codestral model to use for generating embeddings. */
export const EMBED_MODEL = 'codestral-embed-2505';
/** The maximum number of documents that can be processed in a single batch for embedding. */
export const MAX_BATCH_SIZE = 128;
/** The maximum total number of tokens allowed across all documents in a single embedding request. */
export const MAX_TOTAL_TOKENS = 16384;
/** The maximum number of tokens allowed for a single sequence (document text) when embedding. */
export const MAX_SEQUENCE_LENGTH = 8192;
/** Flag indicating whether document chunking should be performed before embedding. */
export const DO_CHUNKING = true;
/** The target size for each chunk when chunking documents (in characters or tokens, context-dependent). */
export const CHUNK_SIZE = 3000;
/** The number of characters or tokens that chunks should overlap to maintain context. */
export const CHUNK_OVERLAP = 1000;

let client: Mistral | undefined;

/**
 * Retrieves a singleton instance of the MistralClient.
 * Initializes the client if it hasn't been already.
 * @throws Error if MISTRAL_API_KEY environment variable is not set.
 * @returns The Mistral instance.
 */
export function getMistralClient(): Mistral {
	if (!client) {
		const apiKey = process.env.MISTRAL_API_KEY;
		if (!apiKey) {
			throw new Error('MISTRAL_API_KEY environment variable is not set.');
		}
		client = new Mistral({ apiKey });
	}
	return client;
}

/** Enum representing supported programming/markup languages for code processing. */
export enum Language {
	PYTHON = 'python',
	JAVASCRIPT = 'javascript',
	TYPESCRIPT = 'typescript',
	JAVA = 'java',
	CPP = 'cpp',
	CSHARP = 'csharp',
	GO = 'go',
	RUST = 'rust',
	MARKDOWN = 'markdown',
	HTML = 'html',
	JSON = 'json',
	KOTLIN = 'kotlin',
	PHP = 'php',
	PROTO = 'proto',
	RUBY = 'ruby',
	SCALA = 'scala',
	SWIFT = 'swift',
	LATEX = 'latex',
	SOL = 'sol', // Solidity
	COBOL = 'cobol',
	C = 'c',
	LUA = 'lua',
	PERL = 'perl',
	HASKELL = 'haskell',
	ELIXIR = 'elixir',
	POWERSHELL = 'powershell',
	TEXT = 'text', // Fallback for unknown or text-based files
}

const extensionToLanguageMap: Record<string, Language> = {
	'.py': Language.PYTHON,
	'.js': Language.JAVASCRIPT,
	'.ts': Language.TYPESCRIPT,
	'.java': Language.JAVA,
	'.cpp': Language.CPP,
	'.hpp': Language.CPP,
	'.cc': Language.CPP,
	'.hh': Language.CPP,
	'.cxx': Language.CPP,
	'.hxx': Language.CPP,
	'.cs': Language.CSHARP,
	'.go': Language.GO,
	'.rs': Language.RUST,
	'.md': Language.MARKDOWN,
	'.markdown': Language.MARKDOWN,
	'.html': Language.HTML,
	'.htm': Language.HTML,
	'.json': Language.JSON,
	'.kt': Language.KOTLIN,
	'.kts': Language.KOTLIN,
	'.php': Language.PHP,
	'.proto': Language.PROTO,
	'.rb': Language.RUBY,
	'.scala': Language.SCALA,
	'.sc': Language.SCALA,
	'.swift': Language.SWIFT,
	'.tex': Language.LATEX,
	'.sol': Language.SOL,
	'.cob': Language.COBOL,
	'.cbl': Language.COBOL,
	'.c': Language.C,
	'.h': Language.C, // Often C, but could be C++. Sticking to C for simplicity as per common examples.
	'.lua': Language.LUA,
	'.pl': Language.PERL,
	'.pm': Language.PERL,
	'.hs': Language.HASKELL,
	'.ex': Language.ELIXIR,
	'.exs': Language.ELIXIR,
	'.ps1': Language.POWERSHELL,
	// Language.TEXT is a fallback, not mapped directly from an extension here.
};

/**
 * Determines the programming language of a file based on its extension.
 * @param filePath The path to the file.
 * @returns The corresponding Language enum member, or undefined if the extension is not recognized.
 */
export function getLanguageFromPath(filePath: string): Language | undefined {
	if (!filePath) return undefined;
	const extension = path.extname(filePath).toLowerCase();
	return extensionToLanguageMap[extension];
}

/**
 * Formats a CodeDoc object into a single string.
 * The format is "title\ntext" if the title is present, otherwise just "text".
 * @param doc The CodeDoc object to format.
 * @returns A string representation of the document.
 */
export function formatDoc(doc: CodeDoc): string {
	if (doc.title && doc.title.trim() !== '') {
		return `${doc.title}\n${doc.text}`;
	}
	return doc.text;
}

/**
 * Recursively reads files from a directory, filters them by specified extensions,
 * and returns a Corpus object.
 * File paths in the Corpus are relative to the initial dirPath.
 * @param dirPath The absolute path to the directory to scan.
 * @param targetExtensions An array of target file extensions (e.g., ['.ts', '.js']). Extensions should be lowercase.
 * @param baseDir The initial directory path, used to make file paths relative. Internal use for recursion.
 * @returns A Promise resolving to a Corpus object.
 */
export async function getLocalFileCorpus(dirPath: string, targetExtensions: string[], baseDir?: string): Promise<Corpus> {
	const corpus: Corpus = {};
	const currentBaseDir = baseDir || dirPath; // All paths will be relative to the initial dirPath

	try {
		const entries = await fs.readdir(dirPath, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dirPath, entry.name);
			if (entry.isDirectory()) {
				// For subdirectories, pass along the original currentBaseDir
				const subCorpus = await getLocalFileCorpus(fullPath, targetExtensions, currentBaseDir);
				Object.assign(corpus, subCorpus);
			} else if (entry.isFile()) {
				const ext = path.extname(entry.name).toLowerCase();
				if (targetExtensions.map((e) => e.toLowerCase()).includes(ext)) {
					try {
						const content = await fs.readFile(fullPath, 'utf-8');
						const relativePath = path.relative(currentBaseDir, fullPath);
						corpus[relativePath] = {
							title: relativePath,
							text: content,
						};
					} catch (readError) {
						console.error(`Error reading file ${fullPath}:`, readError);
						// Optionally skip this file or handle error differently
					}
				}
			}
		}
	} catch (err) {
		console.error(`Error reading directory ${dirPath}:`, err);
		// If dirPath itself is problematic, an empty corpus is returned, which is reasonable.
	}
	return corpus;
}

/**
 *
 * @param repositoryId
 * @param dir
 */
export async function indexRepository(repositoryId: string, dir = './'): Promise<void> {}

/**
 *
 * @param repositoryId
 */
export async function queryRepository(repositoryId: string): Promise<void> {}
