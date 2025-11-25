import Parser from '@keqingmoe/tree-sitter';
import { VectorStoreConfig } from '../core/config';
import { ChunkSourceLocation, FileInfo, IChunker, RawChunk } from '../core/interfaces';

// Language parsers
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const Python = require('tree-sitter-python');
const Java = require('tree-sitter-java');
const Cpp = require('tree-sitter-cpp');
const Go = require('tree-sitter-go');
const Rust = require('tree-sitter-rust');
const CSharp = require('tree-sitter-c-sharp');
const Scala = require('tree-sitter-scala');

// Node types that represent logical code units
const SPLITTABLE_NODE_TYPES = {
	javascript: ['function_declaration', 'arrow_function', 'class_declaration', 'method_definition', 'export_statement'],
	typescript: [
		'function_declaration',
		'arrow_function',
		'class_declaration',
		'method_definition',
		'export_statement',
		'interface_declaration',
		'type_alias_declaration',
	],
	python: ['function_definition', 'class_definition', 'decorated_definition', 'async_function_definition'],
	java: ['method_declaration', 'class_declaration', 'interface_declaration', 'constructor_declaration'],
	cpp: ['function_definition', 'class_specifier', 'namespace_definition', 'declaration'],
	go: ['function_declaration', 'method_declaration', 'type_declaration', 'var_declaration', 'const_declaration'],
	rust: ['function_item', 'impl_item', 'struct_item', 'enum_item', 'trait_item', 'mod_item'],
	csharp: ['method_declaration', 'class_declaration', 'interface_declaration', 'struct_declaration', 'enum_declaration'],
	scala: ['method_declaration', 'class_declaration', 'interface_declaration', 'constructor_declaration'],
};

/**
 * AST-based code chunker using tree-sitter
 * Fast, semantic, language-aware chunking without LLM overhead
 */
export class ASTChunker implements IChunker {
	private parser: Parser;
	private simpleFallback: SimpleFallbackChunker;

	constructor() {
		this.parser = new Parser();
		this.simpleFallback = new SimpleFallbackChunker();
	}

	async chunk(file: FileInfo, config: VectorStoreConfig): Promise<RawChunk[]> {
		const chunkSize = config.chunking?.size || 2500;
		const chunkOverlap = config.chunking?.overlap || 300;

		// Check if language is supported by AST splitter
		const langConfig = this.getLanguageConfig(file.language);
		if (!langConfig) {
			console.log(`AST chunker: Language ${file.language} not supported, using fallback for: ${file.relativePath}`);
			return this.simpleFallback.chunk(file, config);
		}

		try {
			this.parser.setLanguage(langConfig.parser);
			const tree = this.parser.parse(file.content);

			if (!tree.rootNode) {
				console.warn(`AST chunker: Failed to parse AST for ${file.language}, using fallback: ${file.relativePath}`);
				return this.simpleFallback.chunk(file, config);
			}

			// Extract chunks based on AST nodes
			const chunks = this.extractChunks(tree.rootNode, file.content, langConfig.nodeTypes, file);

			// If chunks are too large, split them further
			const refinedChunks = this.refineChunks(chunks, file.content, chunkSize, chunkOverlap);

			return refinedChunks;
		} catch (error) {
			console.warn(`AST chunker: Failed for ${file.language}, using fallback: ${error}`);
			return this.simpleFallback.chunk(file, config);
		}
	}

	getSupportedExtensions(): string[] {
		return ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.go', '.rs', '.cs', '.scala'];
	}

	private getLanguageConfig(language: string): { parser: any; nodeTypes: string[] } | null {
		const langMap: Record<string, { parser: any; nodeTypes: string[] }> = {
			javascript: { parser: JavaScript, nodeTypes: SPLITTABLE_NODE_TYPES.javascript },
			js: { parser: JavaScript, nodeTypes: SPLITTABLE_NODE_TYPES.javascript },
			typescript: { parser: TypeScript, nodeTypes: SPLITTABLE_NODE_TYPES.typescript },
			ts: { parser: TypeScript, nodeTypes: SPLITTABLE_NODE_TYPES.typescript },
			python: { parser: Python, nodeTypes: SPLITTABLE_NODE_TYPES.python },
			py: { parser: Python, nodeTypes: SPLITTABLE_NODE_TYPES.python },
			java: { parser: Java, nodeTypes: SPLITTABLE_NODE_TYPES.java },
			cpp: { parser: Cpp, nodeTypes: SPLITTABLE_NODE_TYPES.cpp },
			'c++': { parser: Cpp, nodeTypes: SPLITTABLE_NODE_TYPES.cpp },
			c: { parser: Cpp, nodeTypes: SPLITTABLE_NODE_TYPES.cpp },
			go: { parser: Go, nodeTypes: SPLITTABLE_NODE_TYPES.go },
			rust: { parser: Rust, nodeTypes: SPLITTABLE_NODE_TYPES.rust },
			rs: { parser: Rust, nodeTypes: SPLITTABLE_NODE_TYPES.rust },
			cs: { parser: CSharp, nodeTypes: SPLITTABLE_NODE_TYPES.csharp },
			csharp: { parser: CSharp, nodeTypes: SPLITTABLE_NODE_TYPES.csharp },
			scala: { parser: Scala, nodeTypes: SPLITTABLE_NODE_TYPES.scala },
		};

		return langMap[language.toLowerCase()] || null;
	}

	private extractChunks(node: Parser.SyntaxNode, code: string, splittableTypes: string[], file: FileInfo): RawChunk[] {
		const chunks: RawChunk[] = [];

		const traverse = (currentNode: Parser.SyntaxNode) => {
			// Check if this node type should be split into a chunk
			if (splittableTypes.includes(currentNode.type)) {
				const startLine = currentNode.startPosition.row + 1;
				const endLine = currentNode.endPosition.row + 1;
				const nodeText = code.slice(currentNode.startIndex, currentNode.endIndex);

				// Only create chunk if it has meaningful content
				if (nodeText.trim().length > 0) {
					chunks.push({
						content: nodeText,
						sourceLocation: {
							startLine,
							endLine,
							startCharOffset: currentNode.startIndex,
							endCharOffset: currentNode.endIndex,
						},
						chunkType: currentNode.type,
						metadata: {
							language: file.language,
							filePath: file.filePath,
						},
					});
				}
			}

			// Continue traversing child nodes
			for (const child of currentNode.children) {
				traverse(child);
			}
		};

		traverse(node);

		// If no meaningful chunks found, create a single chunk with the entire code
		if (chunks.length === 0) {
			const codeLines = code.split('\n');
			chunks.push({
				content: code,
				sourceLocation: {
					startLine: 1,
					endLine: codeLines.length,
				},
				chunkType: 'file',
				metadata: {
					language: file.language,
					filePath: file.filePath,
				},
			});
		}

		return chunks;
	}

	private refineChunks(chunks: RawChunk[], originalCode: string, chunkSize: number, chunkOverlap: number): RawChunk[] {
		const refinedChunks: RawChunk[] = [];

		for (const chunk of chunks) {
			if (chunk.content.length <= chunkSize) {
				refinedChunks.push(chunk);
			} else {
				// Split large chunks using line-based splitting
				const subChunks = this.splitLargeChunk(chunk, chunkSize);
				refinedChunks.push(...subChunks);
			}
		}

		return this.addOverlap(refinedChunks, chunkOverlap);
	}

	private splitLargeChunk(chunk: RawChunk, chunkSize: number): RawChunk[] {
		const lines = chunk.content.split('\n');
		const subChunks: RawChunk[] = [];
		let currentChunk = '';
		let currentStartLine = chunk.sourceLocation.startLine;
		let currentLineCount = 0;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineWithNewline = i === lines.length - 1 ? line : `${line}\n`;

			if (currentChunk.length + lineWithNewline.length > chunkSize && currentChunk.length > 0) {
				// Create a sub-chunk
				subChunks.push({
					content: currentChunk.trim(),
					sourceLocation: {
						startLine: currentStartLine,
						endLine: currentStartLine + currentLineCount - 1,
					},
					chunkType: chunk.chunkType,
					metadata: chunk.metadata,
				});

				currentChunk = lineWithNewline;
				currentStartLine = currentStartLine + currentLineCount;
				currentLineCount = 1;
			} else {
				currentChunk += lineWithNewline;
				currentLineCount++;
			}
		}

		// Add the last sub-chunk
		if (currentChunk.trim().length > 0) {
			subChunks.push({
				content: currentChunk.trim(),
				sourceLocation: {
					startLine: currentStartLine,
					endLine: currentStartLine + currentLineCount - 1,
				},
				chunkType: chunk.chunkType,
				metadata: chunk.metadata,
			});
		}

		return subChunks;
	}

	private addOverlap(chunks: RawChunk[], chunkOverlap: number): RawChunk[] {
		if (chunks.length <= 1 || chunkOverlap <= 0) {
			return chunks;
		}

		const overlappedChunks: RawChunk[] = [];

		for (let i = 0; i < chunks.length; i++) {
			let content = chunks[i].content;
			const sourceLocation = { ...chunks[i].sourceLocation };

			// Add overlap from previous chunk
			if (i > 0 && chunkOverlap > 0) {
				const prevChunk = chunks[i - 1];
				const overlapText = prevChunk.content.slice(-chunkOverlap);
				content = `${overlapText}\n${content}`;
				sourceLocation.startLine = Math.max(1, sourceLocation.startLine - this.getLineCount(overlapText));
			}

			overlappedChunks.push({
				content,
				sourceLocation,
				chunkType: chunks[i].chunkType,
				metadata: chunks[i].metadata,
			});
		}

		return overlappedChunks;
	}

	private getLineCount(text: string): number {
		return text.split('\n').length;
	}

	static isLanguageSupported(language: string): boolean {
		const supportedLanguages = ['javascript', 'js', 'typescript', 'ts', 'python', 'py', 'java', 'cpp', 'c++', 'c', 'go', 'rust', 'rs', 'cs', 'csharp', 'scala'];
		return supportedLanguages.includes(language.toLowerCase());
	}
}

/**
 * Simple fallback chunker for unsupported languages
 * Uses line-based splitting with overlap
 */
class SimpleFallbackChunker implements IChunker {
	async chunk(file: FileInfo, config: VectorStoreConfig): Promise<RawChunk[]> {
		const chunkSize = config.chunking?.size || 2500;
		const chunkOverlap = config.chunking?.overlap || 300;

		const lines = file.content.split('\n');
		const chunks: RawChunk[] = [];
		let currentChunk = '';
		let currentStartLine = 1;
		let currentLineCount = 0;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineWithNewline = i === lines.length - 1 ? line : `${line}\n`;

			if (currentChunk.length + lineWithNewline.length > chunkSize && currentChunk.length > 0) {
				// Create a chunk
				chunks.push({
					content: currentChunk.trim(),
					sourceLocation: {
						startLine: currentStartLine,
						endLine: currentStartLine + currentLineCount - 1,
					},
					chunkType: 'block',
					metadata: {
						language: file.language,
						filePath: file.filePath,
					},
				});

				// Start new chunk with overlap
				const overlapLines = Math.floor(chunkOverlap / 50); // rough estimate: 50 chars per line
				const overlapStart = Math.max(0, i - overlapLines);
				currentChunk = `${lines.slice(overlapStart, i + 1).join('\n')}\n`;
				currentStartLine = currentStartLine + currentLineCount - overlapLines;
				currentLineCount = i - overlapStart + 1;
			} else {
				currentChunk += lineWithNewline;
				currentLineCount++;
			}
		}

		// Add the last chunk
		if (currentChunk.trim().length > 0) {
			chunks.push({
				content: currentChunk.trim(),
				sourceLocation: {
					startLine: currentStartLine,
					endLine: currentStartLine + currentLineCount - 1,
				},
				chunkType: 'block',
				metadata: {
					language: file.language,
					filePath: file.filePath,
				},
			});
		}

		// If no chunks created, return entire file as single chunk
		if (chunks.length === 0) {
			chunks.push({
				content: file.content,
				sourceLocation: {
					startLine: 1,
					endLine: lines.length,
				},
				chunkType: 'file',
				metadata: {
					language: file.language,
					filePath: file.filePath,
				},
			});
		}

		return chunks;
	}

	getSupportedExtensions(): string[] {
		return ['*']; // Supports all extensions
	}
}
