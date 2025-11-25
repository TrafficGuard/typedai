import * as fs from 'node:fs';
import * as path from 'node:path';
import pino from 'pino';
import type { ContextualizedChunk, RawChunk } from './interfaces';

const logger = pino({ name: 'ChunkLogger' });

/**
 * Log chunks to disk for debugging and inspection
 * Saves to .typedai/vector/chunks/ with mirrored file path structure
 *
 * @param chunks - Chunks to log (can be raw or contextualized)
 * @param filePath - Original source file path (e.g., "src/swe/vector/cli.ts")
 * @param repoRoot - Repository root path
 */
export async function logChunksToDisk(chunks: Array<RawChunk | ContextualizedChunk>, filePath: string, repoRoot: string): Promise<void> {
	if (chunks.length === 0) {
		return;
	}

	try {
		// Create output path: .typedai/vector/chunks/src/swe/vector/cli.xml
		const relativePath = path.relative(repoRoot, filePath);
		const outputPath = path.join(repoRoot, '.typedai', 'vector', 'chunks', relativePath);
		const outputFile = outputPath.replace(path.extname(outputPath), '.xml');

		// Ensure directory exists
		const outputDir = path.dirname(outputFile);
		fs.mkdirSync(outputDir, { recursive: true });

		// Generate XML content
		const xml = generateChunkXml(chunks, relativePath, new Date().toISOString());

		// Write to file
		fs.writeFileSync(outputFile, xml, 'utf-8');

		logger.info({ file: relativePath, chunks: chunks.length, output: outputFile }, 'Chunks logged to disk');
	} catch (error) {
		logger.error({ error, filePath }, 'Failed to log chunks to disk');
	}
}

/**
 * Generate XML representation of chunks
 */
function generateChunkXml(chunks: Array<RawChunk | ContextualizedChunk>, filePath: string, timestamp: string): string {
	const escapeXml = (str: string): string => {
		return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
	};

	let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
	xml += `<chunks file="${escapeXml(filePath)}" timestamp="${timestamp}" count="${chunks.length}">\n`;

	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i];
		xml += `  <chunk index="${i}">\n`;

		// Basic chunk info
		xml += '    <metadata>\n';
		if (chunk.sourceLocation) {
			xml += `      <startLine>${chunk.sourceLocation.startLine}</startLine>\n`;
			xml += `      <endLine>${chunk.sourceLocation.endLine}</endLine>\n`;
			if (chunk.sourceLocation.startCharOffset !== undefined) {
				xml += `      <startCharOffset>${chunk.sourceLocation.startCharOffset}</startCharOffset>\n`;
			}
			if (chunk.sourceLocation.endCharOffset !== undefined) {
				xml += `      <endCharOffset>${chunk.sourceLocation.endCharOffset}</endCharOffset>\n`;
			}
		}
		if (chunk.chunkType) {
			xml += `      <chunkType>${escapeXml(chunk.chunkType)}</chunkType>\n`;
		}
		if (chunk.metadata?.name) {
			xml += `      <name>${escapeXml(chunk.metadata.name)}</name>\n`;
		}
		xml += '    </metadata>\n';

		// Original content
		xml += `    <content><![CDATA[${chunk.content}]]></content>\n`;

		// Contextualized content if available
		if ('contextualizedContent' in chunk && chunk.contextualizedContent) {
			xml += `    <contextualizedContent><![CDATA[${chunk.contextualizedContent}]]></contextualizedContent>\n`;
		}

		xml += '  </chunk>\n';
	}

	xml += '</chunks>\n';
	return xml;
}

/**
 * Get the output path for a given source file
 * Useful for finding where chunks would be logged
 */
export function getChunkLogPath(filePath: string, repoRoot: string): string {
	const relativePath = path.relative(repoRoot, filePath);
	const outputPath = path.join(repoRoot, '.typedai', 'vector', 'chunks', relativePath);
	return outputPath.replace(path.extname(outputPath), '.xml');
}
