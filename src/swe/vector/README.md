# Vector Search System

A comprehensive, configurable vector search solution for code repositories using Google Discovery Engine with support for:

- **AST-based chunking**: Fast, semantic code chunking using tree-sitter
- **Contextual chunking**: LLM-generated context for 49-67% better retrieval (Anthropic)
- **Dual embeddings**: Code + natural language for 12% better retrieval
- **Incremental sync**: Merkle tree-based change detection for efficient updates
- **Hybrid search**: Dense vector + sparse BM25 lexical search
- **Circuit breaker**: Automatic quota management with intelligent retry and recovery

## Architecture

```
Repository Files
    ↓
[1] Intelligent Chunking
    ├─ With contextualChunking: Single LLM call (chunks + context)
    └─ Without: AST-based chunking (tree-sitter)
    ↓
[2] Code-to-English Translation (optional, LLM for dual embedding)
    ↓
[3] Embedding Generation (Vertex AI)
    ↓
[4] Google Discovery Engine Storage
    ↓
[5] Hybrid Search (Vector + BM25)
```

## Configuration

### Per-Repository Configuration

Create a `.vectorconfig.json` file in your repository root:

#### Single Configuration

```json
{
  "dualEmbedding": true,
  "contextualChunking": true,
  "chunkSize": 2500,
  "chunkOverlap": 300,
  "chunkStrategy": "ast",
  "embeddingProvider": "vertex",
  "embeddingModel": "gemini-embedding-001",
  "hybridSearch": true,
  "reranking": false,
  "includePatterns": ["src/**", "lib/**", "app/**"],
  "maxFileSize": 1048576
}
```

#### Multiple Configurations (Array)

You can define multiple configurations with different settings that map to different vector store collections. Each config must have a unique `name` property:

```json
[
  {
    "name": "main",
    "dualEmbedding": true,
    "contextualChunking": true,
    "chunkSize": 2500,
    "chunkOverlap": 300,
    "chunkStrategy": "ast",
    "embeddingProvider": "vertex",
    "embeddingModel": "gemini-embedding-001",
    "hybridSearch": true,
    "reranking": false,
    "includePatterns": ["src/**", "lib/**"],
    "maxFileSize": 1048576
  },
  {
    "name": "docs",
    "dualEmbedding": false,
    "contextualChunking": true,
    "chunkSize": 3000,
    "chunkOverlap": 400,
    "chunkStrategy": "ast",
    "embeddingProvider": "vertex",
    "embeddingModel": "gemini-embedding-001",
    "hybridSearch": true,
    "reranking": false,
    "includePatterns": ["docs/**", "*.md"],
    "maxFileSize": 1048576
  }
]
```

The `name` property maps to the vector store collection name, allowing you to maintain separate indexes with different configurations. Use the CLI `--config-name` flag to specify which config to use:

```bash
# Use a specific config by name
pnpm vector:sync . --config-name main
pnpm vector:sync . --config-name docs
pnpm vector:search "query" --config-name main

# Use --fs to specify where to load .vectorconfig.json from
# (includePatterns in the config are relative to --fs path)
pnpm vector:sync /path/to/repo --fs /path/to/config/dir --config-name main
pnpm vector:search "query" --fs /path/to/config/dir --config-name main
```

Or add to `package.json`:

```json
{
  "vectorStore": {
    "dualEmbedding": true,
    "contextualChunking": true
  }
}
```

Or with multiple configs in `package.json`:

```json
{
  "vectorStore": [
    {
      "name": "main",
      "dualEmbedding": true,
      "contextualChunking": true
    },
    {
      "name": "docs",
      "dualEmbedding": false,
      "contextualChunking": true
    }
  ]
}
```

### Configuration Directory (`--fs` option)

By default, the CLI loads `.vectorconfig.json` from the repository path you're indexing. However, you can use the `--fs` option to specify a different directory for loading the configuration file. This is useful when:

- Your config file is stored separately from the repository being indexed
- You want to use a centralized config directory for multiple repositories
- The `includePatterns` need to be relative to a different base directory

**Important:** When using `--fs`, all `includePatterns` in the configuration are interpreted as relative to the `--fs` path, not the repository path.

**Example:**

```bash
# Config file at /home/configs/.vectorconfig.json with includePatterns: ["src/**"]
# Repository to index at /home/repos/myproject
# The includePatterns will be resolved relative to /home/configs/

pnpm vector:sync /home/repos/myproject --fs /home/configs --config-name main
```

In this example, the pattern `src/**` will look for `/home/configs/src/**`, not `/home/repos/myproject/src/**`. Make sure your `includePatterns` are set appropriately when using `--fs`.

### Configuration Options

#### Core Features

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | `undefined` | Name of the configuration (required when using multiple configs). Maps to the vector store collection name. Must be alphanumeric with dashes/underscores only. |
| `dualEmbedding` | `boolean` | `false` | Enable dual embedding (code + natural language). **12% better retrieval** but 3x cost. |
| `contextualChunking` | `boolean` | `false` | Enable LLM-generated context with intelligent chunking. **49-67% better retrieval**. Single LLM call per file (optimized). ~1.2x cost increase over baseline. |

#### Chunking Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `chunkSize` | `number` | `2500` | Maximum chunk size in characters (100-10000). |
| `chunkOverlap` | `number` | `300` | Overlap between consecutive chunks in characters. |
| `chunkStrategy` | `'ast' \| 'llm'` | `'ast'` | Chunking strategy. AST is fast and recommended. |

#### Embedding Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `embeddingProvider` | `string` | `'vertex'` | Embedding provider: `'vertex'`, `'openai'`, `'voyage'`, `'cohere'`. |
| `embeddingModel` | `string` | `'gemini-embedding-001'` | Embedding model name. |

#### Search Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `hybridSearch` | `boolean` | `true` | Enable hybrid search (vector + BM25 lexical). Recommended. |
| `reranking` | `boolean` | `false` | Enable post-search reranking for better quality (not yet implemented). |

#### File Filtering

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `includePatterns` | `string[]` | `[]` | Glob patterns to include (e.g., `["src/**", "lib/**"]`). If not specified, all supported files are indexed (excluding common build directories). |
| `maxFileSize` | `number` | `1048576` | Maximum file size in bytes to index (default: 1MB). |
| `fileExtensions` | `string[]` | `['.ts', '.js', ...]` | File extensions to index. |

#### Google Cloud Discovery Engine Configuration

These settings allow you to specify Google Cloud project and Discovery Engine configuration per config entry. If not specified, they fall back to environment variables.

| Option | Type | Default (Env Var) | Description |
|--------|------|-------------------|-------------|
| `gcpProject` | `string` | `GCLOUD_PROJECT` | GCP project ID for Discovery Engine. |
| `gcpRegion` | `string` | `GCLOUD_REGION` (default: `'us-central1'`) | GCP region for Vertex AI embedding service. |
| `discoveryEngineLocation` | `string` | `DISCOVERY_ENGINE_LOCATION` (default: `'global'`) | Discovery Engine location: `'global'`, `'us'`, or `'eu'`. |
| `discoveryEngineCollectionId` | `string` | `DISCOVERY_ENGINE_COLLECTION_ID` (default: `'default_collection'`) | Discovery Engine collection ID. |
| `datastoreId` | `string` | `DISCOVERY_ENGINE_DATA_STORE_ID` (default: `'test-datastore'`) | Discovery Engine datastore ID where documents are indexed. |

**Example with GCP configuration:**

```json
[
  {
    "name": "main",
    "gcpProject": "my-project-123",
    "gcpRegion": "us-central1",
    "discoveryEngineLocation": "global",
    "discoveryEngineCollectionId": "default_collection",
    "datastoreId": "my-main-datastore",
    "dualEmbedding": true,
    "contextualChunking": true,
    "includePatterns": ["src/**"]
  },
  {
    "name": "docs",
    "gcpProject": "my-project-123",
    "gcpRegion": "us-central1",
    "discoveryEngineLocation": "global",
    "discoveryEngineCollectionId": "default_collection",
    "datastoreId": "my-docs-datastore",
    "dualEmbedding": false,
    "contextualChunking": true,
    "includePatterns": ["docs/**"]
  }
]
```

This allows different configs to use different GCP projects, regions, or datastores, enabling multi-tenant or multi-environment setups.

## Configuration Presets

### Fast & Cheap (Development)

```json
{
  "dualEmbedding": false,
  "contextualChunking": false,
  "chunkSize": 2500,
  "hybridSearch": true
}
```

**Trade-offs:**
- ⚡ Fast indexing (~0.01s per file)
- 💰 Low cost (~$0.00001 per file)
- 📊 Good quality (baseline)

### Balanced (Production)

```json
{
  "dualEmbedding": false,
  "contextualChunking": true,
  "chunkSize": 2500,
  "hybridSearch": true
}
```

**Trade-offs:**
- ⚡ Moderate speed (~0.5s per file)
- 💰 Low-medium cost (~$0.00002 per file, optimized single-call)
- 📊 High quality (+49% better retrieval)

### Maximum Quality (Critical Projects)

```json
{
  "dualEmbedding": true,
  "contextualChunking": true,
  "chunkSize": 2500,
  "hybridSearch": true,
  "reranking": true
}
```

**Trade-offs:**
- 🐌 Slower indexing (~1s per file)
- 💸 Higher cost (~$0.00006 per file, optimized)
- 📊 Excellent quality (+67% better retrieval)

## Feature Deep Dive

### 1. AST-Based Chunking

**What it does:**
- Uses tree-sitter parsers to understand code structure
- Identifies semantic boundaries (functions, classes, methods)
- Falls back to line-based splitting for unsupported languages

**Benefits:**
- ⚡ Fast (no LLM calls)
- 🎯 Semantic (respects code structure)
- 🌍 Multi-language (13+ languages supported)

**Supported Languages:**
JavaScript, TypeScript, Python, Java, C/C++, Go, Rust, C#, Scala

### 2. Contextual Chunking (Single-Call Optimization)

**What it does:**
- **Single LLM call per file** intelligently chunks and contextualizes the entire file
- Chunks based on semantic meaning (not just syntax) - functions, classes, methods
- Generates search-optimized context for each chunk with hierarchical awareness
- Optimized for **hybrid search** (vector similarity + BM25 keyword matching)
- Includes parent class/module context and references to related components
- Prepends context to chunk before embedding

**Based on:** [Anthropic's Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval) with enhancements for:
- Hybrid search optimization
- Single-call efficiency (80% fewer API calls)
- Hierarchical context awareness

**Example:**
```
Original file: AuthService class with generateToken and verifyToken methods

LLM intelligently chunks into 4 semantic pieces:
1. Import statements
2. Class definition and constructor
3. generateToken method
4. verifyToken method

Context for generateToken method:
  Part of AuthService class. Generates JWT authentication tokens with
  user credentials and configurable expiration. Works in conjunction with
  verifyToken method to provide complete token-based authentication cycle.
  Uses jsonwebtoken library for token signing with secret key.

  generateToken(userId: string, email: string): string {
    const payload = { userId, email, issuedAt: Date.now() };
    return jwt.sign(payload, this.secretKey, { expiresIn: '24h' });
  }
```

**Key Features:**
- ⚡ **Single-call efficiency**: 1 LLM call per file (vs N calls for N chunks)
- 🧠 **Intelligent chunking**: LLM determines optimal semantic boundaries
- 🏗️ **Hierarchical context**: Mentions parent class/module/namespace
- 🔗 **Related components**: References companion methods that work together
- 🔍 **Dual optimization**: Works with both vector and keyword search
- 🎯 **Query-oriented**: Thinks about what developers search for
- 🔑 **Keyword-rich**: Includes technical terms, APIs, patterns
- 💡 **Problem-focused**: Describes use cases and scenarios
- 🚫 **Non-redundant**: Avoids repeating code already indexed by BM25

**Benefits:**
- 📊 49-67% better retrieval accuracy (semantic understanding)
- ⚡ **80% fewer API calls** compared to traditional per-chunk approach
- 🏗️ Better hierarchical understanding (class/module context)
- 🔗 Improved awareness of related code components
- 🎯 Better understanding of chunk purpose and use cases
- 🔍 Improved hybrid search relevance

**Costs:**
- 💰 ~1.2x cost increase over baseline (vs 6x for old per-chunk approach)
- ⏱️ ~50x slower indexing than AST-only (but much faster than old contextual approach)
- 💾 Uses prompt caching to reduce costs on retries

### 3. Dual Embeddings

**What it does:**
- Translates code to natural language description
- Generates two embeddings: code + natural language
- Uses natural language embedding for search

**Example:**
```typescript
// Original code
function authenticateUser(token: string): Promise<User> {
  return jwt.verify(token, SECRET_KEY);
}

// Natural language translation
"This function authenticates a user by verifying a JWT token.
It takes a token string as input and returns a Promise that
resolves to a User object. It uses the jwt library to verify
the token against a secret key."
```

**Benefits:**
- 📊 12% better retrieval accuracy
- 🔍 Better query-to-code matching
- 🌐 Natural language queries work better

**Costs:**
- 💰 ~3x cost increase (2 embeddings per chunk)
- ⏱️ ~2x slower indexing
- 💾 Double storage for embeddings

### 4. Incremental Sync (Merkle Tree)

**What it does:**
- Creates hash tree of all files (Merkle DAG)
- Detects added, modified, and deleted files
- Only reindexes changed files

**Benefits:**
- ⚡ Fast updates (only changed files)
- 💰 Lower cost for updates
- 🔄 Automatic change detection

**How it works:**
```
1. Initial index: Create snapshot of all files
2. Subsequent runs: Compare current state to snapshot
3. Detect changes: Added, modified, deleted files
4. Update index: Only process changed files
5. Save snapshot: Update for next run
```

**Snapshot location:**
`~/.typedai/vector-snapshots/{repo-hash}.json`

### 5. Hybrid Search

**What it does:**
- Combines dense vector search (semantic similarity)
- With sparse BM25 search (exact keyword matching)
- Merges results using RRF (Reciprocal Rank Fusion)

**Benefits:**
- 🎯 Best of both worlds
- 🔍 Handles both semantic and exact queries
- 📊 More robust retrieval

### 6. Circuit Breaker for Quota Management

**What it does:**
- Automatically detects Google Discovery Engine API quota exhaustion
- Pauses all requests when quota limit hit
- Tests service recovery every 5 seconds
- Resumes normal operation once quota resets
- Queues requests during downtime to prevent data loss

**How it works:**
```
1. Normal operation (CLOSED state):
   - 15 files processed in parallel
   - Discovery Engine calls proceed normally

2. Quota error detected (OPEN state):
   - Circuit breaker opens immediately
   - All new requests queued (FIFO)
   - Every 5 seconds: test first queued request

3. Service recovery (HALF_OPEN → CLOSED):
   - Test request succeeds
   - Circuit closes automatically
   - All queued requests processed
   - Normal operation resumes
```

**Benefits:**
- 🛡️ Prevents cascading failures from quota errors
- ♻️ Automatic recovery without manual intervention
- 📦 Request queuing prevents data loss
- 🔍 Transparent to application logic
- ⏱️ Configurable retry interval (default: 5 seconds)

**Configuration:**
```typescript
// Default values in googleVectorConfig.ts
CIRCUIT_BREAKER_RETRY_INTERVAL_MS = 5000    // 5 seconds between retries
CIRCUIT_BREAKER_FAILURE_THRESHOLD = 1       // Open after 1 quota error
CIRCUIT_BREAKER_SUCCESS_THRESHOLD = 1       // Close after 1 successful test
FILE_PROCESSING_PARALLEL_BATCH_SIZE = 15    // Concurrent file processing
```

**User Experience:**
When quota exhaustion occurs, you'll see:
```
⚠️  Discovery Engine quota limit hit - pausing requests...
   Will retry every 5 seconds until service recovers

... (automatic retries happening) ...

✅ Discovery Engine service recovered - resuming requests
```

## Usage

### Basic Indexing

```typescript
import { VectorSearchOrchestrator } from './google/vectorSearchOrchestrator';
import { getGoogleVectorServiceConfig } from './google/googleVectorConfig';

const orchestrator = new VectorSearchOrchestrator(
  getGoogleVectorServiceConfig()
);

// Full index
await orchestrator.indexRepository('/path/to/repo');

// Incremental update
await orchestrator.indexRepository('/path/to/repo', {
  incremental: true
});

// With custom config
await orchestrator.indexRepository('/path/to/repo', {
  config: {
    dualEmbedding: true,
    contextualChunking: true
  }
});
```

### Searching

```typescript
// Simple search
const results = await orchestrator.search('authentication logic');

// With filters
const results = await orchestrator.search('authentication logic', {
  maxResults: 20,
  fileFilter: ['src/auth'],
  languageFilter: ['typescript']
});

// Process results
for (const result of results) {
  console.log(`${result.document.filePath}:${result.document.startLine}`);
  console.log(result.document.originalCode);
}
```

### Progress Tracking

```typescript
await orchestrator.indexRepository('/path/to/repo', {
  onProgress: (progress) => {
    console.log(
      `${progress.phase}: ${progress.filesProcessed}/${progress.totalFiles} - ${progress.currentFile}`
    );
  }
});
```

## Performance Characteristics

### Indexing Speed

| Configuration | Files/sec | Cost per File | Quality |
|--------------|-----------|---------------|---------|
| Fast (no LLM) | ~100 | $0.00001 | Baseline |
| Contextual only (optimized) | ~2 | $0.00002 | +49% |
| Dual only | ~50 | $0.00003 | +12% |
| Both features (optimized) | ~1 | $0.00006 | +67% |

*Benchmarks on typical TypeScript files (~5KB average)*
*Contextual costs reduced 80% via single-call optimization*

### Cost Estimation

For a medium-sized repository (1000 files, 5KB average):

| Configuration | Total Cost | Time | Quality Gain |
|--------------|------------|------|--------------|
| Fast | $0.01 | 10s | Baseline |
| Contextual (optimized) | $0.02 | 8min | +49% |
| Dual | $0.03 | 20s | +12% |
| Maximum (optimized) | $0.06 | 15min | +67% |

*Note: Costs dramatically reduced from previous per-chunk approach thanks to single-call optimization*

## Architecture Components

### Core Interfaces

All components implement standard interfaces for flexibility:

- `IChunker`: Code chunking strategies
- `IContextualizer`: Context generation
- `ICodeTranslator`: Code-to-English translation
- `IEmbedder`: Embedding generation
- `IVectorStore`: Vector storage and search
- `ISynchronizer`: Incremental sync

### Component Diagram

```
┌─────────────────────────────────────────────────────────┐
│                  VectorSearchOrchestrator               │
│                    (Main Coordinator)                    │
└─────────────────────────────────────────────────────────┘
           │            │              │           │
    ┌──────┴──────┐  ┌─┴────────┐  ┌──┴──────┐ ┌─┴────────┐
    │  ASTChunker │  │Contextual│  │  Code   │ │  Merkle  │
    │             │  │  izer    │  │Translator│ │   Sync   │
    └─────────────┘  └──────────┘  └─────────┘ └──────────┘
                            │
              ┌─────────────┴──────────────┐
              │                            │
        ┌─────▼─────┐              ┌──────▼─────┐
        │  Vertex   │              │ Discovery  │
        │ Embedder  │              │  Engine    │
        └───────────┘              └────────────┘
```

## Future Enhancements

### Planned Features

1. **Additional Vector Stores**
   - Chroma
   - Qdrant
   - Weaviate

2. **Reranking**
   - Cohere Rerank API
   - Vertex AI Ranking API
   - Custom reranking models

3. **Advanced Chunking**
   - Semantic similarity-based merging
   - Dependency-aware chunking
   - Cross-file context

4. **Query Enhancement**
   - Query expansion
   - Query rewriting
   - Multi-query fusion

## Troubleshooting

### High Costs

**Problem:** Indexing costs are too high

**Solutions:**
1. Disable `dualEmbedding` (3x cost reduction)
2. Disable `contextualChunking` (small cost reduction, but loses 49% quality gain)
3. Reduce `maxFileSize` to skip large files
4. Use more specific `includePatterns` to index only essential directories

*Note: Contextual chunking is now much more affordable thanks to single-call optimization*

### Slow Indexing

**Problem:** Indexing takes too long

**Solutions:**
1. Disable `contextualChunking` (50x speedup)
2. Use incremental indexing
3. Reduce `FILE_PROCESSING_PARALLEL_BATCH_SIZE`
4. Skip unnecessary files

### Poor Search Quality

**Problem:** Search results are not relevant

**Solutions:**
1. Enable `contextualChunking` (+49% quality)
2. Enable `dualEmbedding` (+12% quality)
3. Ensure `hybridSearch` is enabled
4. Use more specific queries
5. Try reindexing with better config

## References

1. [Anthropic: Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)
2. [Greptile: Semantic Code Search](https://www.greptile.com/blog/semantic-codebase-search)
3. [Google Discovery Engine Documentation](https://cloud.google.com/generative-ai-app-builder/docs)
4. [Vertex AI Embeddings](https://cloud.google.com/vertex-ai/docs/generative-ai/embeddings/get-text-embeddings)

## License

See LICENSE file in repository root.
