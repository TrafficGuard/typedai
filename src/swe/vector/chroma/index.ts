export { ChromaAdapter } from './chromaAdapter';
export { ChromaOrchestrator } from './chromaOrchestrator';
export {
	buildChromaConfig,
	getCollectionNameForRepo,
	sanitizeRepoNameForCollection,
	validateChromaConfig,
	DEFAULT_CHROMA_CONFIG,
	type ChromaConfig,
} from './chromaConfig';

// CLI is exported separately and can be run with:
// npx ts-node src/swe/vector/chroma/cli.ts
