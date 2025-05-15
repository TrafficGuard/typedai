import pino from 'pino';
// Placeholder for potential future AST parsing libraries
// import * as Parser from 'tree-sitter';
// import * as JavaScript from 'tree-sitter-javascript';
// import * as Python from 'tree-sitter-python';

const logger = pino({ name: 'Chunker' });

export interface CodeChunk {
	filePath: string;
	functionName?: string; // Optional, as not all code is in functions
	startLine: number;
	endLine: number;
	content: string;
	language: string;
}

/**
 * Chunks code content based on function boundaries (simple regex-based approach).
 * This is a basic implementation and may need refinement with AST parsing for accuracy.
 * @param codeFile The code file object containing content and metadata.
 * @returns An array of CodeChunk objects.
 */
export function chunkCodeByFunction(filePath: string, codeContent: string, language: string): CodeChunk[] {
	logger.debug(`Chunking file: ${filePath} (language: ${language})`);
	const chunks: CodeChunk[] = [];
	const lines = codeContent.split('\n');

	// Basic Regex examples (highly simplified, needs improvement for robustness)
	// These will miss many cases (nested functions, complex signatures, comments, etc.)
	let functionRegex: RegExp | null = null;
	if (language === 'ts' || language === 'js') {
		// Very basic JS/TS function detection (async, function keyword, arrow functions)
		functionRegex = /^(?:async\s+)?function\s+([a-zA-Z0-9_]+)\s*\(|^const\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\(/;
	} else if (language === 'py') {
		// Basic Python function detection
		functionRegex = /^def\s+([a-zA-Z0-9_]+)\s*\(/;
	}
	// Add more language patterns here

	if (!functionRegex) {
		logger.warn(`No basic chunking pattern for language: ${language}. Treating file as single chunk.`);
		// Fallback: treat the whole file as one chunk if no pattern
		chunks.push({
			filePath,
			content: codeContent,
			startLine: 1,
			endLine: lines.length,
			language,
		});
		return chunks;
	}

	let currentChunk: Partial<CodeChunk> = {};
	let currentContent: string[] = [];
	let inFunction = false;
	let functionIndentLevel = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNumber = i + 1;
		const match = functionRegex.exec(line.trimStart()); // Use trimStart to handle indentation

		if (match) {
			// Found a potential function start
			if (inFunction && currentChunk.startLine) {
				// Finalize the previous chunk
				chunks.push({
					...(currentChunk as CodeChunk), // Assume properties are set
					content: currentContent.join('\n'),
					endLine: lineNumber - 1,
				});
			}

			// Start a new chunk
			const functionName = match[1] || match[2]; // Get name from appropriate capture group
			const indentMatch = line.match(/^\s*/);
			functionIndentLevel = indentMatch ? indentMatch[0].length : 0;
			currentChunk = {
				filePath,
				functionName,
				startLine: lineNumber,
				language,
			};
			currentContent = [line];
			inFunction = true;
		} else if (inFunction) {
			// Add line to the current function chunk
			currentContent.push(line);

			// Rudimentary check for end of function based on indentation decreasing
			// This is very fragile and needs proper parsing
			const currentIndentMatch = line.match(/^\s*/);
			const currentIndent = currentIndentMatch && line.trim() !== '' ? currentIndentMatch[0].length : functionIndentLevel + 1; // Assume lines inside are indented more

			if (currentIndent < functionIndentLevel && line.trim() !== '' && currentChunk.startLine) {
				// Likely end of function block due to dedent
				chunks.push({
					...(currentChunk as CodeChunk),
					content: currentContent.join('\n'),
					endLine: lineNumber,
				});
				inFunction = false;
				currentChunk = {};
				currentContent = [];
				functionIndentLevel = -1;
				// Add the current line to a potential next (non-function) chunk? Or handle top-level code separately.
				// For simplicity now, we just end the function chunk.
			}
		} else {
			// Handle code outside functions (e.g., imports, top-level script)
			// For now, we might ignore it or collect it into a separate chunk
			// logger.trace(`Line ${lineNumber} outside function: ${line.substring(0, 50)}...`);
		}
	}

	// Add the last chunk if still in a function
	if (inFunction && currentChunk.startLine) {
		chunks.push({
			...(currentChunk as CodeChunk),
			content: currentContent.join('\n'),
			endLine: lines.length,
		});
	}

	// If no functions were found by the basic regex, treat as one chunk
	if (chunks.length === 0 && codeContent.trim() !== '') {
		logger.debug(`No functions detected via regex in ${filePath}, treating as single chunk.`);
		chunks.push({
			filePath,
			content: codeContent,
			startLine: 1,
			endLine: lines.length,
			language,
		});
	}

	logger.debug(`Generated ${chunks.length} chunks for ${filePath}`);
	return chunks;
}

// --- Future AST-based implementation ---
// async function chunkWithTreeSitter(filePath: string, codeContent: string, language: string): Promise<CodeChunk[]> {
//     await Parser.init();
//     const parser = new Parser();
//     let langParser;
//     if (language === 'ts' || language === 'js') {
//         langParser = JavaScript;
//     } else if (language === 'py') {
//         langParser = Python;
//     } else {
//         logger.warn(`Tree-sitter parser not available for language: ${language}`);
//         return chunkCodeByFunction(filePath, codeContent, language); // Fallback
//     }
//     parser.setLanguage(langParser);
//     const tree = parser.parse(codeContent);
//     // TODO: Traverse the tree, identify function nodes, extract content and metadata
//     // This requires knowledge of the specific language grammar nodes
//     logger.info(`Parsed ${filePath} with tree-sitter`);
//     // Placeholder: return basic chunking for now
//     return chunkCodeByFunction(filePath, codeContent, language);
// }
