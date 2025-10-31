// /**
//  * Generate a report showing contextual chunks for sample files
//  * Usage: pnpm tsx src/swe/vector/contextual-report.ts
//  */

// import * as fs from 'node:fs/promises';
// import * as path from 'node:path';
// import { ASTChunker } from './chunking/astChunker';
// import { VectorStoreConfig } from './core/config';
// import { LLMContextualizer } from './core/contextualizer';

// interface ChunkReport {
// 	file: string;
// 	chunkIndex: number;
// 	functionName?: string;
// 	className?: string;
// 	startLine: number;
// 	endLine: number;
// 	originalCode: string;
// 	generatedContext: string;
// 	contextualizedContent: string;
// }

// async function generateContextualReport() {
// 	console.log(`\n${'='.repeat(80)}`);
// 	console.log('CONTEXTUAL CHUNKING REPORT');
// 	console.log(`${'='.repeat(80)}\n`);

// 	// Sample files to process from this repo
// 	const sampleFiles = ['src/swe/vector/core/contextualizer.ts', 'src/swe/vector/chunking/astChunker.ts', 'src/swe/vector/codeLoader.ts'];

// 	const config: VectorStoreConfig = {
// 		contextualChunking: true,
// 		chunkSize: 1500, // Smaller chunks for better examples
// 		chunkOverlap: 200,
// 		dualEmbedding: true,
// 	};

// 	const chunker = new ASTChunker();
// 	const contextualizer = new LLMContextualizer();
// 	const reports: ChunkReport[] = [];

// 	console.log('📝 Processing sample files with contextual chunking enabled...\n');
// 	console.log(`Sample files (${sampleFiles.length}):`);
// 	for (const file of sampleFiles) {
// 		console.log(`  - ${file}`);
// 	}
// 	console.log();

// 	for (const filePath of sampleFiles) {
// 		const fullPath = path.join(process.cwd(), filePath);

// 		try {
// 			const content = await fs.readFile(fullPath, 'utf-8');
// 			const language = path.extname(filePath).substring(1);

// 			console.log(`\n${'─'.repeat(80)}`);
// 			console.log(`Processing: ${filePath}`);
// 			console.log(`${'─'.repeat(80)}\n`);

// 			// Step 1: Chunk the file
// 			const rawChunks = await chunker.chunk(
// 				{
// 					filePath,
// 					content,
// 					language,
// 				},
// 				config,
// 			);

// 			console.log(`  ✓ Created ${rawChunks.length} chunks`);

// 			// Step 2: Generate contexts for chunks
// 			const contextualizedChunks = await contextualizer.contextualize(
// 				rawChunks,
// 				{
// 					filePath,
// 					content,
// 					language,
// 				},
// 				config,
// 			);

// 			console.log('  ✓ Generated contexts for all chunks\n');

// 			// Collect report data (limit to first 2 chunks per file for brevity)
// 			const chunksToReport = contextualizedChunks.slice(0, 2);
// 			for (let i = 0; i < chunksToReport.length; i++) {
// 				const chunk = chunksToReport[i];
// 				reports.push({
// 					file: filePath,
// 					chunkIndex: i,
// 					functionName: chunk.functionName,
// 					className: chunk.className,
// 					startLine: chunk.startLine,
// 					endLine: chunk.endLine,
// 					originalCode: chunk.content,
// 					generatedContext: chunk.context || '',
// 					contextualizedContent: chunk.contextualizedContent,
// 				});
// 			}
// 		} catch (error: any) {
// 			console.error(`  ❌ Error processing ${filePath}: ${error.message}`);
// 		}
// 	}

// 	// Generate formatted report - organize by file
// 	console.log(`\n\n${'='.repeat(80)}`);
// 	console.log('CONTEXTUAL CHUNKS REPORT');
// 	console.log(`${'='.repeat(80)}\n`);

// 	// Group reports by file
// 	interface FileReport {
// 		filePath: string;
// 		fullContent: string;
// 		chunks: ChunkReport[];
// 	}

// 	const fileReportsMap = new Map<string, FileReport>();

// 	for (const report of reports) {
// 		if (!fileReportsMap.has(report.file)) {
// 			// Read full file content
// 			const fullPath = path.join(process.cwd(), report.file);
// 			const fullContent = await fs.readFile(fullPath, 'utf-8');

// 			fileReportsMap.set(report.file, {
// 				filePath: report.file,
// 				fullContent,
// 				chunks: [],
// 			});
// 		}

// 		fileReportsMap.get(report.file)!.chunks.push(report);
// 	}

// 	// Print report for each file
// 	for (const fileReport of fileReportsMap.values()) {
// 		console.log(`\n${'='.repeat(80)}`);
// 		console.log(`FILE: ${fileReport.filePath}`);
// 		console.log(`${'='.repeat(80)}\n`);

// 		console.log('<content>');
// 		console.log(fileReport.fullContent);
// 		console.log('</content>\n');

// 		for (const chunk of fileReport.chunks) {
// 			console.log('<chunk>');
// 			console.log(chunk.contextualizedContent);
// 			console.log('</chunk>\n');
// 		}
// 	}

// 	console.log(`\n${'='.repeat(80)}`);
// 	console.log('SUMMARY');
// 	console.log('='.repeat(80));
// 	console.log(`\nTotal files processed: ${sampleFiles.length}`);
// 	console.log(`Total chunks generated: ${reports.length}`);
// 	console.log('\nLLM used: Vertex AI Gemini 2.5 Flash (summaryLLM)');

// 	console.log('\n✅ Report generation complete!\n');
// }

// generateContextualReport().catch((error) => {
// 	console.error('\n❌ Error generating report:', error);
// 	process.exit(1);
// });
