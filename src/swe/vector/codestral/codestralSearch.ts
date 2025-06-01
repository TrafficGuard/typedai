import { promises as fs } from 'node:fs'; // Using async fs as per project DOCS.md
import * as path from 'node:path';
import { Mistral } from '@mistralai/mistralai';
import { MistralTokenizer } from 'mistral-tokenizer-ts';
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
let tokenizerInstance: MistralTokenizer | undefined;

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

/**
 * Retrieves a singleton instance of the MistralTokenizer.
 * Initializes the tokenizer if it hasn't been already.
 * @returns The MistralTokenizer instance.
 */
export function getMistralTokenizer(): MistralTokenizer {
	if (!tokenizerInstance) {
		tokenizerInstance = new MistralTokenizer();
	}
	return tokenizerInstance;
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
 * Splits a text into chunks based on character count with overlap.
 * @param text The text to split.
 * @param chunkSize The maximum size of each chunk.
 * @param chunkOverlap The number of characters to overlap between chunks.
 * @returns An array of text chunks.
 */
function simpleCharacterTextSplitter(text: string, chunkSize: number, chunkOverlap: number): string[] {
	if (chunkSize <= 0) {
		// console.warn('simpleCharacterTextSplitter: chunkSize must be positive. Returning original text as a single chunk.');
		return [text];
	}
	if (chunkOverlap >= chunkSize) {
		// console.warn('simpleCharacterTextSplitter: chunkOverlap is greater than or equal to chunkSize. This might lead to non-advancing chunks or excessive repetition.');
		return text.length <= chunkSize ? [text] : [text.substring(0, chunkSize)];
	}
	if (text.length <= chunkSize) {
		return [text];
	}

	const chunks: string[] = [];
	let startIndex = 0;
	while (startIndex < text.length) {
		const endIndex = Math.min(startIndex + chunkSize, text.length);
		chunks.push(text.substring(startIndex, endIndex));

		if (endIndex === text.length) {
			break; // Reached the end of the text
		}
		startIndex += chunkSize - chunkOverlap;
		// Ensure we don't create an empty chunk or go out of bounds if overlap makes startIndex jump to/past end
		// This check is mostly a safeguard; primary loop condition `startIndex < text.length` and `endIndex` handling should manage this.
		// However, if chunkSize - chunkOverlap is 0 or negative (guarded by chunkOverlap >= chunkSize), this prevents infinite loops.
		if (startIndex >= text.length || (chunkSize - chunkOverlap <= 0 && startIndex < text.length)) {
			break;
		}
	}
	return chunks;
}

/**
 * Chunks the documents in a corpus.
 * If DO_CHUNKING is false, returns the original corpus.
 * @param corpus The input corpus.
 * @param effectiveChunkSize The target size for each chunk (uses constant CHUNK_SIZE by default).
 * @param effectiveChunkOverlap The overlap between chunks (uses constant CHUNK_OVERLAP by default).
 * @returns A new corpus with chunked documents.
 */
export function chunkCorpus(corpus: Corpus, effectiveChunkSize: number = CHUNK_SIZE, effectiveChunkOverlap: number = CHUNK_OVERLAP): Corpus {
	if (!DO_CHUNKING) {
		return { ...corpus }; // Return a shallow copy
	}

	const newCorpus: Corpus = {};
	for (const originalId in corpus) {
		// eslint-disable-next-line no-prototype-builtins
		if (corpus.hasOwnProperty(originalId)) {
			const doc = corpus[originalId];
			const title = doc.title?.trim() || '';
			const text = doc.text?.trim() || '';

			if (!text) {
				continue;
			}

			const chunks = simpleCharacterTextSplitter(text, effectiveChunkSize, effectiveChunkOverlap);

			if (!chunks || chunks.length === 0) {
				continue;
			}

			if (chunks.length === 1 && chunks[0] === text) {
				newCorpus[originalId] = { title, text: chunks[0] };
			} else {
				chunks.forEach((chunkText, i) => {
					const chunkId = `${originalId}_<chunk>_${i}`;
					newCorpus[chunkId] = {
						title: title,
						text: chunkText,
					};
				});
			}
		}
	}
	return newCorpus;
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
export async function indexRepository(repositoryId: string, dir = './'): Promise<void> {}

/**
 * Generates embeddings for a batch of texts using the Mistral API.
 * Handles tokenization, truncation, batching according to API limits, and API calls.
 * @param texts An array of strings to embed.
 * @returns A Promise resolving to an array of number arrays (embeddings), in the same order as the input texts.
 *          Empty arrays are returned for texts that could not be processed or resulted in errors.
 */
export async function getEmbeddingsBatch(texts: string[]): Promise<number[][]> {
	if (!texts || texts.length === 0) {
		return [];
	}

	const tokenizer = getMistralTokenizer();
	const client = getMistralClient(); // Ensure getMistralClient is called to get the initialized client

	const processedTextData: { textForApi: string; originalIndex: number }[] = [];

	for (let i = 0; i < texts.length; i++) {
		const originalText = texts[i];
		if (typeof originalText !== 'string' || originalText.trim() === '') {
			// Handle non-strings or effectively empty strings early
			processedTextData.push({ textForApi: '', originalIndex: i }); // Mark for potential empty embedding later
			continue;
		}

		const tokens = tokenizer.encode(originalText);
		const tokenCount = tokens.length;

		if (tokenCount === 0) {
			processedTextData.push({ textForApi: '', originalIndex: i }); // Mark for potential empty embedding
			continue;
		}

		if (tokenCount > MAX_SEQUENCE_LENGTH) {
			const truncatedTokens = tokens.slice(0, MAX_SEQUENCE_LENGTH);
			const textForApi = tokenizer.decode(truncatedTokens);
			processedTextData.push({ textForApi, originalIndex: i });
			console.warn(`Truncated text at index ${i} from ${tokenCount} to ${MAX_SEQUENCE_LENGTH} tokens (actual truncated tokens: ${truncatedTokens.length})`);
		} else {
			processedTextData.push({ textForApi: originalText, originalIndex: i });
		}
	}

	if (processedTextData.length === 0) {
		// Should not happen if input texts is not empty, but as a safeguard
		return new Array(texts.length).fill([]);
	}

	const embeddingsMap: Map<number, number[]> = new Map();
	let currentBatchData: { textForApi: string; originalIndex: number; tokenCount: number }[] = [];
	let currentBatchTotalTokens = 0;

	for (const item of processedTextData) {
		// If textForApi was marked as empty earlier (e.g. original was empty, or tokenized to nothing)
		if (item.textForApi === '') {
			embeddingsMap.set(item.originalIndex, []);
			continue;
		}

		const itemTokens = tokenizer.encode(item.textForApi); // Re-tokenize, as textForApi might be a decoded truncated version
		const itemTokenCount = itemTokens.length;

		if (itemTokenCount === 0) {
			// If even the (potentially truncated) text tokenizes to nothing
			embeddingsMap.set(item.originalIndex, []);
			continue;
		}
		// A single item cannot exceed MAX_SEQUENCE_LENGTH due to prior truncation.
		// MAX_TOTAL_TOKENS is for the batch. If a single item is larger than MAX_TOTAL_TOKENS,
		// it will be processed in its own batch. The API might reject it then.

		if (currentBatchData.length > 0 && (currentBatchData.length >= MAX_BATCH_SIZE || currentBatchTotalTokens + itemTokenCount > MAX_TOTAL_TOKENS)) {
			// Process currentBatchData
			console.log(`Processing batch of ${currentBatchData.length} texts, total tokens: ${currentBatchTotalTokens}...`);
			const textsInBatchForApi = currentBatchData.map((d) => d.textForApi);
			try {
				const response = await client.embeddings.create({ model: EMBED_MODEL, input: textsInBatchForApi });
				response.data.forEach((embeddingData, batchIndex) => {
					const dataItem = currentBatchData[batchIndex];
					embeddingsMap.set(dataItem.originalIndex, embeddingData.embedding);
				});
			} catch (e) {
				console.error(`Error processing batch: ${e instanceof Error ? e.message : String(e)}`);
				currentBatchData.forEach((dataItem) => {
					embeddingsMap.set(dataItem.originalIndex, []); // Store empty array for failed items
				});
			}
			currentBatchData = [];
			currentBatchTotalTokens = 0;
		}

		currentBatchData.push({ textForApi: item.textForApi, originalIndex: item.originalIndex, tokenCount: itemTokenCount });
		currentBatchTotalTokens += itemTokenCount;
	}

	// Process the last remaining batch
	if (currentBatchData.length > 0) {
		console.log(`Processing final batch of ${currentBatchData.length} texts, total tokens: ${currentBatchTotalTokens}...`);
		const textsInBatchForApi = currentBatchData.map((d) => d.textForApi);
		try {
			const response = await client.embeddings.create({ model: EMBED_MODEL, input: textsInBatchForApi });
			response.data.forEach((embeddingData, batchIndex) => {
				const dataItem = currentBatchData[batchIndex];
				embeddingsMap.set(dataItem.originalIndex, embeddingData.embedding);
			});
		} catch (e) {
			console.error(`Error processing final batch: ${e instanceof Error ? e.message : String(e)}`);
			currentBatchData.forEach((dataItem) => {
				embeddingsMap.set(dataItem.originalIndex, []);
			});
		}
	}

	const allEmbeddings: number[][] = new Array(texts.length);
	for (let i = 0; i < texts.length; i++) {
		allEmbeddings[i] = embeddingsMap.get(i) ?? [];
	}

	return allEmbeddings;
}

/**
 *
 * @param repositoryId
 */
export async function queryRepository(repositoryId: string): Promise<void> {}
