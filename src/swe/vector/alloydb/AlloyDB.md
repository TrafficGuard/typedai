# AlloyDB Vector Search Implementation

## Overview

This directory contains the AlloyDB-based vector search implementation for code repository indexing and semantic search. It leverages AlloyDB's automated vector embedding and ScaNN indexing capabilities to provide a simplified, high-performance alternative to Google Discovery Engine.

## Key Features

- **Flexible Embedding Strategy**:
  - **Automated Embeddings** (preview feature, managed AlloyDB only): AlloyDB AI automatically generates embeddings
  - **Manual Embeddings** (AlloyDB Omni): Vertex AI generates embeddings before insert
- **ScaNN Index in AUTO Mode**: Self-tuning, self-maintaining vector index with optimal performance
- **Hybrid Search**: Combines vector similarity search with PostgreSQL full-text search using Reciprocal Rank Fusion (RRF)
- **Transactional Updates**: File chunks can be deleted and inserted in a single transaction for consistency
- **Columnar Engine Support**: Optional columnar engine for better filtered vector search performance
- **Multi-Config Support**: Single table per repository with filtering by config name

## Important: Automated Embeddings

**Automated embeddings (`ai.initialize_embeddings`) is a preview feature** and has the following availability:

- ✅ **Fully Managed AlloyDB on GCP**: Available if enabled for your instance
- ❌ **AlloyDB Omni (Docker)**: Not available (uses manual Vertex AI embeddings instead)

The implementation automatically detects availability and falls back to manual embedding via Vertex AI when automated embeddings are not available.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   AlloyDBOrchestrator                       │
│  (Manages indexing pipeline and search orchestration)       │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ├─► ASTChunker (code → chunks)
                        ├─► LLMContextualizer (adds context)
                        ├─► VertexEmbedderAdapter (dual embedding)
                        ├─► AlloyDBAdapter (vector store)
                        ├─► GoogleReranker (search reranking)
                        └─► MerkleSynchronizer (incremental sync)
                                    │
                                    ▼
                        ┌───────────────────────┐
                        │   AlloyDBAdapter      │
                        │  (IVectorStore impl)  │
                        └───────────┬───────────┘
                                    │
                                    ▼
                        ┌───────────────────────┐
                        │   AlloyDBClient       │
                        │ (Connection pooling)  │
                        └───────────┬───────────┘
                                    │
                                    ▼
                        ┌───────────────────────┐
                        │  AlloyDB PostgreSQL   │
                        │   (Vector database)   │
                        └───────────────────────┘
```

## Local Development with AlloyDB Omni

AlloyDB Omni is a containerized version of AlloyDB that runs on Docker, perfect for local development on Mac OSX.

### Quick Start (Mac OSX)

1. **Install Prerequisites**
   ```bash
   # Ensure Docker Desktop is installed and running
   docker --version
   docker compose version
   ```

2. **Set up AlloyDB Omni**
   ```bash
   cd src/swe/vector/alloydb
   ./scripts/setup-local.sh
   ```

   This script will:
   - Create `.env.local` from the example
   - Pull the latest AlloyDB Omni Docker image
   - Start the AlloyDB container
   - Initialize required extensions
   - Validate the setup

3. **Validate Setup**
   ```bash
   tsx scripts/validate-setup.ts
   ```

   This runs comprehensive validation checks including:
   - Database connection
   - Extension installation
   - Vector operations
   - Full-text search
   - Automated embeddings support

4. **Run Example**
   ```bash
   # Index current directory
   tsx scripts/example-index.ts

   # Index specific repository
   tsx scripts/example-index.ts /path/to/repo
   ```

### Docker Commands

```bash
# View logs
docker logs -f alloydb-vector

# Stop AlloyDB
docker compose down

# Restart AlloyDB
docker compose restart

# Reset data (WARNING: Destroys all data)
docker compose down -v && ./scripts/setup-local.sh

# Connect via psql
docker exec -it alloydb-vector psql -U postgres -d vector_db

# Check running containers
docker ps | grep alloydb
```

### Configuration

Edit `.env.local` to customize your setup:

```bash
# Database connection (default values work out of the box)
ALLOYDB_HOST=localhost
ALLOYDB_PORT=5432
ALLOYDB_DATABASE=vector_db
ALLOYDB_USER=postgres
ALLOYDB_PASSWORD=alloydb123

# Vector search settings
ALLOYDB_VECTOR_WEIGHT=0.7
ALLOYDB_ENABLE_COLUMNAR_ENGINE=false

# GCP settings (required for Vertex AI features)
GCLOUD_PROJECT=your-gcp-project
GCLOUD_REGION=us-central1
```

### Troubleshooting Local Setup

#### Docker Issues

**Problem**: "Docker is not running"
```bash
# Solution: Start Docker Desktop
open -a Docker
```

**Problem**: "Port 5432 already in use"
```bash
# Solution: Stop existing PostgreSQL or change port in docker-compose.yml
lsof -i :5432
# Kill the process or change ALLOYDB_PORT in docker-compose.yml
```

**Problem**: "Platform mismatch" on Apple Silicon
```bash
# Solution: docker-compose.yml should have platform: linux/arm64
# This is set automatically by the setup script
```

#### Extension Issues

**Problem**: "Extension not found"
```bash
# Solution: Manually install extensions
docker exec -it alloydb-vector psql -U postgres -d vector_db

CREATE EXTENSION IF NOT EXISTS vector CASCADE;
CREATE EXTENSION IF NOT EXISTS alloydb_scann CASCADE;
```

**Problem**: "Automated embeddings not available"
```bash
# This is normal for AlloyDB Omni - it may not have full AI features
# The system will fall back to manual embedding via Vertex AI
# Make sure GCLOUD_PROJECT is set in .env.local
```

#### Performance Issues

**Problem**: Slow indexing or searches
```bash
# Solution: Increase Docker resource limits in Docker Desktop
# Recommended: 4 CPUs, 8GB RAM minimum
# Settings → Resources → Advanced
```

### Mac OSX Specific Notes

- **Platform**: AlloyDB Omni uses `linux/arm64` on Apple Silicon Macs
- **Performance**: First run may be slower due to image extraction
- **Resources**: Allocate at least 4GB RAM and 2 CPUs to Docker
- **Volume**: Data persists in Docker volume `alloydb_data`

## Production Usage on GCP

For production deployments, use fully managed AlloyDB on Google Cloud instead of AlloyDB Omni.

📘 **See [GCP_SETUP.md](./GCP_SETUP.md) for detailed setup instructions with your GCP instance**

### Quick GCP Setup

1. **Install AlloyDB Auth Proxy**:
   ```bash
   curl -o alloydb-auth-proxy https://storage.googleapis.com/alloydb-auth-proxy/v1.10.1/alloydb-auth-proxy.darwin.arm64
   chmod +x alloydb-auth-proxy
   sudo mv alloydb-auth-proxy /usr/local/bin/
   ```

2. **Start the proxy**:
   ```bash
   alloydb-auth-proxy 'projects/YOUR_PROJECT/locations/REGION/clusters/CLUSTER/instances/INSTANCE'
   ```

3. **Configure and test**:
   ```bash
   cp .env.gcp.example .env.gcp
   # Edit .env.gcp with your instance details
   npm run alloydb:validate
   ```

### Basic Setup (Production)

```typescript
import { createAlloyDBOrchestrator } from '#swe/vector/alloydb';

// Create orchestrator
const orchestrator = createAlloyDBOrchestrator('my-repo-url', {
  // AlloyDB connection
  alloydbDatabase: 'vector_db',
  alloydbInstance: 'projects/my-project/locations/us-central1/clusters/my-cluster/instances/my-primary',

  // Vector search features
  contextualChunking: true,
  hybridSearch: true,
  dualEmbedding: false,

  // Embedding model
  alloydbEmbeddingModel: 'gemini-embedding-001',
});

// Index a repository
await orchestrator.indexRepository('/path/to/repo', {
  incremental: false,
  onProgress: (progress) => {
    console.log(`Processing: ${progress.currentFile} (${progress.filesProcessed}/${progress.totalFiles})`);
  },
});

// Search
const results = await orchestrator.search('authentication middleware', {
  maxResults: 10,
});

console.log(results);
```

### Configuration via `.vectorconfig.json`

Create a `.vectorconfig.json` in your repository:

```json
{
  "name": "default",
  "contextualChunking": true,
  "hybridSearch": true,
  "dualEmbedding": false,
  "alloydbDatabase": "vector_db",
  "alloydbInstance": "projects/my-project/locations/us-central1/clusters/my-cluster/instances/my-primary",
  "alloydbEmbeddingModel": "gemini-embedding-001",
  "alloydbEnableColumnarEngine": true,
  "alloydbVectorWeight": 0.7,
  "reranking": true,
  "includePatterns": ["src/**", "lib/**"],
  "fileExtensions": [".ts", ".js", ".py"]
}
```

Then load it:

```typescript
import { createAlloyDBOrchestratorFromRepo } from '#swe/vector/alloydb';

const orchestrator = await createAlloyDBOrchestratorFromRepo(
  '/path/to/repo',
  'my-repo-url'
);

await orchestrator.indexRepository('/path/to/repo');
```

### Environment Variables

```bash
# AlloyDB connection
export ALLOYDB_DATABASE=vector_db
export ALLOYDB_INSTANCE=projects/my-project/locations/us-central1/clusters/my-cluster/instances/my-primary
export ALLOYDB_USER=postgres
export ALLOYDB_PASSWORD=secret

# Alternative: Connection string
export ALLOYDB_CONNECTION_STRING=postgresql://user:pass@host:5432/vector_db

# GCP for reranking and dual embedding
export GCLOUD_PROJECT=my-project
export GCLOUD_REGION=us-central1
```

### Incremental Indexing

```typescript
// First time: full index
await orchestrator.indexRepository('/path/to/repo', {
  incremental: false,
});

// Later: incremental updates
await orchestrator.indexRepository('/path/to/repo', {
  incremental: true, // Only processes changed files
});
```

### Advanced: Custom Adapter

```typescript
import { AlloyDBAdapter } from '#swe/vector/alloydb';

const adapter = new AlloyDBAdapter('my-repo', {
  database: 'vector_db',
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'secret',
  embeddingModel: 'gemini-embedding-001',
  vectorWeight: 0.7,
});

await adapter.initialize({
  contextualChunking: true,
  hybridSearch: true,
});

// Manual indexing
await adapter.indexChunks(embeddedChunks);

// Search
const results = await adapter.search('query', [], 10, config);
```

## Database Schema

Each repository gets its own table:

```sql
CREATE TABLE code_chunks_{sanitized_repo_name} (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'default',
  filename TEXT NOT NULL,
  line_from INTEGER NOT NULL,
  line_to INTEGER NOT NULL,
  original_text TEXT NOT NULL,
  contextualized_chunk TEXT NOT NULL,   -- Source text for embedding
  embedding VECTOR(768),                 -- Embeddings (auto or manual)
  code_embedding VECTOR(768),            -- Dual embedding (optional)
  language TEXT,
  chunk_type TEXT,
  function_name TEXT,
  class_name TEXT,
  metadata JSONB,
  full_text_search TSVECTOR,             -- For hybrid search
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ScaNN index (auto mode) on embedding column
CREATE INDEX idx_code_chunks_vector ON code_chunks_{repo}
  USING scann (embedding cosine)
  WITH (mode='AUTO', quantizer='AH');

-- Full-text search index
CREATE INDEX idx_code_chunks_fts ON code_chunks_{repo}
  USING GIN (full_text_search);
```

**Embedding Column Behavior**:
- **With automated embeddings** (managed AlloyDB): AlloyDB populates `embedding` from `contextualized_chunk` automatically
- **Without automated embeddings** (AlloyDB Omni): Vertex AI embeddings are stored in `embedding` column before insert

## Hybrid Search Algorithm

The hybrid search combines vector similarity and full-text search using **Reciprocal Rank Fusion (RRF)**:

```sql
-- Get top candidates from vector search
WITH vector_results AS (
  SELECT *, ROW_NUMBER() OVER (ORDER BY distance) AS vector_rank
  FROM table ORDER BY embedding <=> query_embedding LIMIT N
),
-- Get top candidates from text search
text_results AS (
  SELECT *, ROW_NUMBER() OVER (ORDER BY rank DESC) AS text_rank
  FROM table WHERE full_text_search @@ query LIMIT N
)
-- Combine using RRF scoring
SELECT *,
  (vector_weight / (60 + vector_rank)) +
  (text_weight / (60 + text_rank)) AS rrf_score
FROM combined_results
ORDER BY rrf_score DESC
```

## Performance Optimization

### 1. Enable Columnar Engine

```typescript
const config = {
  alloydbEnableColumnarEngine: true,
  // ... other config
};
```

This improves filtered vector search performance by 2-10x.

### 2. Adjust Hybrid Search Weights

```typescript
const config = {
  alloydbVectorWeight: 0.8,  // 80% vector, 20% text
  // ... other config
};
```

Higher values favor vector search, lower values favor keyword matching.

### 3. Use Batch Operations

The adapter automatically batches inserts (100 chunks per batch) for optimal performance.

## Prerequisites

### Required Extensions

```sql
CREATE EXTENSION IF NOT EXISTS vector CASCADE;
CREATE EXTENSION IF NOT EXISTS alloydb_scann CASCADE;
```

### Optional Extensions

```sql
-- For columnar engine support
CREATE EXTENSION IF NOT EXISTS google_columnar_engine CASCADE;
```

### Automated Embeddings

Ensure your AlloyDB instance supports automated embeddings:

```sql
-- Check if available
SELECT EXISTS (
  SELECT 1 FROM pg_proc
  WHERE proname = 'initialize_embeddings'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'ai')
);
```

## Validation

```typescript
import { validateAlloyDBPrerequisites } from '#swe/vector/alloydb';

const result = await validateAlloyDBPrerequisites(alloydbConfig);

if (!result.valid) {
  console.error('Errors:', result.errors);
}

if (result.warnings.length > 0) {
  console.warn('Warnings:', result.warnings);
}
```

## Cost Comparison

| Feature | AlloyDB | Discovery Engine |
|---------|---------|-----------------|
| Embedding Generation | Automated (free) | Manual (API costs) |
| Index Maintenance | Automated | Manual purge/rebuild |
| Storage Cost | Standard PostgreSQL | Premium managed service |
| Query Cost | Per vCPU-hour | Per 1000 queries |
| Transactional Updates | Yes | No |
| Best For | Large datasets, frequent updates | Managed service, less control |

## Troubleshooting

### Connection Issues

```typescript
// Test connection
import { AlloyDBClient } from '#swe/vector/alloydb';

const client = new AlloyDBClient(config);
await client.connect();
const stats = await client.getStats();
console.log(stats);
await client.disconnect();
```

### Extension Not Found

```bash
# Connect to AlloyDB
psql -h <host> -U postgres -d vector_db

# Install extensions manually
CREATE EXTENSION IF NOT EXISTS vector CASCADE;
CREATE EXTENSION IF NOT EXISTS alloydb_scann CASCADE;
```

### Slow Searches

- Enable columnar engine
- Increase `alloydbVectorWeight` for vector-heavy queries
- Ensure ScaNN index is created (check with `\di`)

## API Reference

See the [interfaces](../core/interfaces.ts) for detailed API documentation.

---

AlloyDB accelerates AI with automated vector indexing and embedding

Modern applications store their most valuable data such as product catalogs or user profiles in operational databases. These data stores are excellent for applications that need to handle real-time transactions — and with their support for vector operations, they’ve also become an excellent foundation for modern search or gen AI application serving.
AlloyDB AI provides powerful, high-performance vector capabilities enabling you to generate embeddings inline and manually tune powerful vector indexes. While you can generate embeddings out of the box for in line search use cases, we also wanted AlloyDB to address the complexity of creating and maintaining huge numbers of vector embeddings. 
To make this possible, we’re introducing two new features for AlloyDB AI, available in preview, that will empower you to transform your existing operational database into a powerful, AI-native database with just a few lines of SQL:
Auto vector embeddings
Auto vector index
Auto vector embeddings transform operational data into vector search ready data by vectorizing data stored inside of AlloyDB at scale. The auto vector index self-configures vector indexes optimized for customer’s workloads, ensuring high quality and performance.
Compare this to the traditional approach of creating the vectors and loading them into your database. The basic steps are familiar to any AI developer: generate vector embeddings using specialized AI models, import the vectors into the database alongside the underlying text, and tune vector indexes. In other words, build an ETL (Extract, Transform, Load) pipeline, extract the data from your database, apply transformations, run it through the AI model, reload and reformat it, then reinsert it into your database and then tune the vector indexes. This approach not only involves significant engineering complexity but also introduces latency, making it difficult to keep your application in sync with your live data despite it being stored alongside it.
An additional challenge is to keep the vector index up to date, which is hard to do manually. While manually tuned indexes are performant and provide excellent results, they can be sensitive to updates in the underlying data and require performance and quality testing before they’re ready to hit the road.
Let's walk through an example journey of an operational workload and see how AlloyDB AI’s new features remove friction from building enterprise-grade AI, and enable users to modernize applications from their database.
AlloyDB as a vector database

Imagine you run a large e-commerce platform with a products table in AlloyDB, containing structured data like product_id, color, price, and inventory_count, alongside unstructured data such as product_description.
You want to build a gen AI search feature to improve the quality of search in your application and make it more dynamic and personalized for users. You want to evolve from solely supporting simple lexical searches such as  "jacket", which perform exact matches, to searches such as "warm coat for winter" that can find semantically similar items like jackets, coats or vests. To refine the quality, you also want to combine this semantic matching with structured filters such as color = 'maroon' or price < 100. Some of these filters may even live in a different table, such as an orders table which stores information about the user's order history.

Before you can get started on application logic, you need to generate embeddings on your data so you can perform a vector search. For this you would typically need to:
Build an ETL pipeline to extract products data from AlloyDB
Write custom code to batch the data and send it to an embedding model API on Vertex AI
Carefully manage rate limits, token limits, and failures
Write the resulting vectors back into your database
Build another process to watch for UPDATE commands so you can do it again and again, just to keep your data fresh
AlloyDB AI’s new feature, auto vector embeddings, eliminates this entire workflow.
It provides a fully managed, scalable solution to create and maintain embeddings directly from the database. The system batches API calls to Vertex AI, maximizing throughput, and can operate as a background process to ensure that your critical transactions aren't blocked.
To generate vector embeddings from your product_description column, you just run one SQL command:

CALL ai.initialize_embeddings(
    model_id => 'gemini-embedding-001',
    table_name => 'products',
    content_column => 'product_description',
    embedding_column => 'product_embedding',
    incremental_refresh_mode => 'transactional'  -- Automatically updates on data changes
);
Now AlloyDB can handle embedding generation for you. Your products table is AI-enabled and  embeddings are automatically updated as your data changes. 
If you prefer to manually refresh embeddings, you can run the following SQL command:

CALL ai.refresh_embeddings(
    table_name => 'products',
    embedding_column => 'product_embedding',          -- embedding vector column
    batch_size => 50                                  -- optional override
);
Turbocharging search with AlloyDB AI 

Now that you have embeddings, you face the second hurdle: performance and quality of search. Say a user searches for "warm winter coat." Your query may look like this:

SELECT * FROM products
WHERE color = 'maroon'
ORDER BY product_embedding <-> google_ml.embedding('gemini-embedding-001', 'warm coat for winter')
LIMIT 10;
To make this vector search query performant, you need a vector index. But traditional vector indexes require deep expertise: you have to manually configure parameters, rebuild the index periodically as data changes, and hope your tuning is correct. This complexity slows development and adds operational complexity.

-- Optimal `num_leaves` and `max_num_levels` are based on number of vectors in the
-- products table, which means the user will have to figure that out beforehand to
-- properly tune the index.
​
CREATE INDEX idx_products_embedding ON products
USING scann (product_embedding)
WITH (num_leaves=100000, max_num_levels=2);
The new auto vector index feature abstracts all this away and delivers a fully automated and integrated vector search experience that is self-configuring, self-maintaining, and self-tuning. To create a fully optimized index, you just run:

-- AlloyDB will automatically figure out index configuration underneath the hood.
CREATE INDEX idx_products_embedding ON products
USING scann (product_embedding)
WITH (mode = 'AUTO');
With mode='AUTO', AlloyDB handles everything:
Automatic configuration: It analyzes your data and automatically configures the index parameters at creation time to meet your performance and quality goals.
Automatic maintenance: The index updates incrementally and automatically as your data changes, ensuring it remains optimized without any manual intervention. It automatically splits as the index grows in size and automatically updates centroids when data distribution drifts.
Automatic query plan optimization: This is where the real magic happens. The ScaNN index leverages real-time workload statistics to self-tune and optimize te execution plan. For a deeper dive, read our previous blog, A deep dive into AlloyDB’s vector search enhancements.
Two new ways to become AI-native

With AlloyDB’s new capabilities, making your operational workload AI-native no longer requires complex ETL pipelines and infrastructure code.
Auto vector embeddings transforms your data by handling the entire embedding generation and management lifecycle inside the database.
Auto vector index simplifies retrieval by providing a self-tuning, self-maintaining index that automatically optimizes complex filtered vector searches.
By removing this complexity, AlloyDB empowers you to use your existing SQL skills to build and scale world-class AI experiences with speed and confidence, moving projects from proof-of-concept to production faster than ever before. Get started with auto vector embeddings and the auto vector index today.

----

Create a ScaNN index

bookmark_border
This page describes how to use stored embeddings to generate indexes and query embeddings using ScaNN index with AlloyDB for PostgreSQL. For more information about storing embedding, see Store vector embeddings.

AlloyDB alloydb_scann, a PostgreSQL extension developed by Google that implements a highly efficient nearest-neighbor index powered by the ScaNN algorithm.

The ScaNN index is a tree-based quantization index for approximate nearest neighbor search. It provides lower index building time and smaller memory footprint as compared to HNSW. In addition, it provides faster QPS in comparison to HNSW based on the workload.

Note: Before you create an index, verify that you add embedding vectors to a table in your AlloyDB database. If you try to generate a ScaNN index on an empty or partitioned table, then you might encounter some issues. For more information about the errors generated, see Troubleshoot ScaNN index errors.
Before you begin

Before you can start creating indexes, you must complete the following prerequisites.

Embedding vectors are added to a table in your AlloyDB database.
The vector extension that is based on pgvector, extended by Google for AlloyDB, and the alloydb_scann extension is installed:



CREATE EXTENSION IF NOT EXISTS alloydb_scann CASCADE;
Note: You can use the alloydb_scann extension with PostgreSQL 14, 15, 16, and 17 compatible databases.
If you want to create automatically tuned ScaNN indexes, make sure that the scann.enable_preview_features flag is enabled. If you don't want to enable preview features, or for production instances, you can create a ScaNN index with specific parameters instead.

Note: We don't recommend enabling preview features on production instances.
Create an automatically tuned ScaNN index

Preview — Auto index creation

This feature is subject to the "Pre-GA Offerings Terms" in the General Service Terms section of the Service Specific Terms. Pre-GA features are available "as is" and might have limited support. For more information, see the launch stage descriptions.
With the auto index feature, you can simplify index creation to automatically create indexes that are optimized for search performance or balanced index build times and search performance.

When you use the AUTO mode, you only need to specify the table name and embedding column along with the distance function that you want to use. You can optimize the index for search performance or balance between index build times and search performance.

There is also an option to use the MANUAL mode to create indexes with granular control over other index tuning parameters.

Create a ScaNN index in AUTO mode

Some points to note before creating indexes in AUTO mode are as follows:

AlloyDB can't create a ScaNN index for tables with insufficient data.
You can't set index creation parameters, such as num_leaves, when you create indexes in AUTO mode.
Auto maintenance is enabled by default for all indexes created in AUTO mode.
To create an index in AUTO mode, enable the feature flag scann.enable_zero_knob_index_creation. This enables auto maintenance. After you enable the flag, run the following command:



  CREATE INDEX INDEX_NAME ON TABLE
  USING scann (EMBEDDING_COLUMN DISTANCE_FUNCTION)
  WITH (mode='AUTO');
Replace the following:

INDEX_NAME: the name of the index that you want to create—for example, my-scann-index. The index names are shared across your database. Verify that each index name is unique to each table in your database.
TABLE: the table to add the index to.
EMBEDDING_COLUMN: the column that stores vector data.
DISTANCE_FUNCTION: the distance function to use with this index. Choose one of the following:

L2 distance: l2
Dot product: dot_product
Cosine distance: cosine
OPTIMIZATION (Optional): By default, a search optimized index is created. Set to one of the following:

SEARCH_OPTIMIZED (Default): to optimize both vector search recall and vector search latency at a cost of longer index build time.
BALANCED: to create an index that balances index build time and search performance.
Create a ScaNN index in MANUAL mode

If you enabled the scann.enable_preview_features flag and you want granular control over the tuning parameters, you can create the index in MANUAL mode.

Note: You can't set optimization parameters such as SEARCH_OPTIMIZED or BALANCED when you create indexes in MANUAL mode.
To create a ScaNN index in MANUAL mode, run the following command:



  CREATE INDEX INDEX_NAME ON TABLE
  USING scann (EMBEDDING_COLUMN DISTANCE_FUNCTION)
  WITH (mode='MANUAL', num_leaves=NUM_LEAVES_VALUE, quantizer =QUANTIZER, max_num_levels=MAX_NUM_LEVELS);
Replace the following:

INDEX_NAME: the name of the index you want to create—for example, my-scann-index. The index names are shared across your database. Verify that each index name is unique to each table in your database.
TABLE: the table to add the index to.
EMBEDDING_COLUMN: the column that stores vector data.
DISTANCE_FUNCTION: the distance function to use with this index. Choose one of the following:

L2 distance: l2
Dot product: dot_product
Cosine distance: cosine
NUM_LEAVES_VALUE: the number of partitions to apply to this index. Set to any value between 1 to 1048576.
QUANTIZER: the type of quantizer to use. Available options are as follows:

SQ8: provides a balance of query performance with minimal recall loss, typically less than 1-2%. This is the default value.
AH: consider this for potentially better query performance when the columnar engine is enabled and your index and table data are populated into the columnar engine, subject to its configured size. Note that AH is up to 4x compressed when compared with SQ8. For more information, see Best practices for tuning ScaNN.
FLAT: provides the highest recall of 99% or higher at the cost of search performance.
MAX_NUM_LEVELS: the maximum number of levels of the K-means clustering tree. Set to 1(default) for two-level tree-based quantization, and set to 2 for three-level tree-based quantization.
You can add other index creation or query runtime parameters to tune your index. For more information, see Tune a ScaNN index.

Create a ScaNN index with specific parameters

If your application has specific requirements for recall and index build times, then you can manually create the index. You can create a two-level or three-level tree index based on your workload. For more information about tuning parameters, see Tune a ScaNN index.

Two-level tree index
Three-level tree index
To apply a two-level tree index using the ScaNN algorithm to a column containing stored vector embeddings, run the following DDL query:



CREATE INDEX INDEX_NAME ON TABLE
USING scann (EMBEDDING_COLUMN DISTANCE_FUNCTION)
WITH (num_leaves=NUM_LEAVES_VALUE, quantizer =QUANTIZER);
Replace the following:

INDEX_NAME: the name of the index you want to create—for example, my-scann-index. The index names are shared across your database. Ensure that each index name is unique to each table in your database.
TABLE: the table to add the index to.
EMBEDDING_COLUMN: a column that stores vector data.
DISTANCE_FUNCTION: the distance function to use with this index. Choose one of the following:

L2 distance: l2
Dot product: dot_product
Cosine distance: cosine
NUM_LEAVES_VALUE: the number of partitions to apply to this index. Set to any value between 1 to 1048576. For more information about how to decide this value, see Tune a ScaNN index.
QUANTIZER: the type of quantizer to use. Available options are as follows:

SQ8: provides a balance of query performance with minimal recall loss, typically less than 1-2%. This is the default value.
AH: consider this for potentially better query performance when the columnar engine is enabled and your index and table data are populated into the columnar engine, subject to its configured size. Note that AH is up to 4x compressed when compared with SQ8. For more information, see Best practices for tuning ScaNN.
FLAT: provides the highest recall of 99% or higher at the cost of search performance.
Build indexes in parallel

To build your index faster, AlloyDB might automatically spawn multiple parallel workers, depending on your dataset and the type of index that you choose.

The parallel index build is often triggered if you're creating a 3-level ScaNN index or if your dataset exceeds 100M rows.

Though AlloyDB automatically optimizes the number of parallel workers, you can tune the parallel workers using the max_parallel_maintenance_workers, max_parallel_workers, and the min_parallel_table_scan_size PostgreSQL query planning parameters.

Note: To avoid out-of-memory issues when you generate the index, make sure that the maintenance_work_mem database flag (GUC) is set to a value less than total machine memory.
Run a query

After you store and index the embeddings in your database, you can start querying your data. You cannot run bulk search queries using the alloydb_scann extension.

To find the nearest semantic neighbors for an embedding vector, you can run the following example query, where you set the same distance function that you used during the index creation.



  SELECT * FROM TABLE
  ORDER BY EMBEDDING_COLUMN DISTANCE_FUNCTION_QUERY 'EMBEDDING'
  LIMIT ROW_COUNT
Replace the following:

TABLE: the table containing the embedding to compare the text to.
INDEX_NAME: the name of the index you want to use—for example, my-scann-index.
EMBEDDING_COLUMN: the column containing the stored embeddings.
DISTANCE_FUNCTION_QUERY: the distance function to use with this query. Choose one of the following based on the distance function used while creating the index:

L2 distance: <->
Inner product: <#>
Cosine distance: <=>
EMBEDDING: the embedding vector you want to find the nearest stored semantic neighbors of.
ROW_COUNT: the number of rows to return.

Specify 1 if you want only the single best match.
You can also use the embedding() function to translate the text into a vector. Since embedding() returns a real array, you must explicitly cast the embedding() call to vector before applying it to one of the nearest-neighbor operators (e.g., <-> for L2 distance). These operators can then use the ScaNN index to find the database rows with the most semantically similar embeddings.


---

Create a ScaNN index on products table

Important: The examples in this tutorial are intended for demonstration purposes only. We recommend that you only create ScaNN indexes on tables that are larger than 10K.
Run the following query to create a product_index ScaNN index on the product table:



  CREATE INDEX product_index ON product
  USING scann (embedding cosine)
  WITH (num_leaves=5);
The num_leaves parameter indicates the number of leaf nodes that the tree-based index builds the index with. For more information on how to tune this parameter, see Tune vector query performance.

Perform a vector search

Run the following vector search query that tries to find products that are similar to the natural language query music. Even though the word music isn't included in the product description, the result shows products that are relevant to the query:



SET LOCAL scann.num_leaves_to_search = 2;

SELECT * FROM product
ORDER BY embedding <=> embedding('text-embedding-005', 'music')::vector
  LIMIT 3;
The query results are as follows: Vector search query result

The scann.num_leaves_to_search query parameter controls the number of leaf nodes that are searched during a similarity search. The num_leaves and scann.num_leaves_to_search parameter values help to achieve a balance of performance and recall.

Perform a vector search that uses a filter and a join

You can run filtered vector search queries efficiently even when you use the ScaNN index. Run the following complex vector search query, which returns relevant results that satisfy the query conditions, even with filters:



SET LOCAL scann.num_leaves_to_search = 2;

SELECT * FROM product p
JOIN product_inventory pi ON p.id = pi.product_id
WHERE pi.price < 80.00
ORDER BY embedding <=> embedding('text-embedding-005', 'music')::vector
LIMIT 3;
Accelerate your filtered vector search

You can use the columnar engine content store to improve the performance of vector similarity searches, specifically K-Nearest Neighbor (KNN) searches, when combined with highly selective predicate filtering —for example, using LIKE— in databases. In this section, you use the vector extension and the AlloyDB google_columnar_engine extension. For more information on how the columnar engine works, see About the AlloyDB columnar engine.

Performance improvements come from the columnar engine's built-in efficiency in scanning large datasets and applying filters —such as LIKE predicates— coupled with its ability, using vector support, to pre-filter rows. This functionality reduces the number of data subsets required for subsequent KNN vector distance calculations, and it helps to optimize complex analytical queries involving standard filtering and vector search.

The columnar store offers two options to manage its content:

Automatically manage the column store content: new AlloyDB instances use auto-columnarization by default. Alternatively, you can manually run the auto columnarization functionality.
Manage column store content manually: if you need to manually manage the columns in the column store for your workload, you can disable auto columnarization.
To compare the execution time of a KNN vector search filtered by a LIKE predicate before and after you enable the columnar engine, follow these steps:

Enable the vector extension to support vector data types and operations. Run the following statements to create an example table (items) with an ID, a text description, and a 512-dimension vector embedding column.



CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE items (
    id SERIAL PRIMARY KEY,
    description TEXT,
    embedding VECTOR(512)
);
Populate the data by running the following statements to insert 1 million rows into the example items table.



-- Simplified example of inserting matching (~0.1%) and non-matching data
INSERT INTO items (description, embedding)
SELECT
    CASE WHEN g % 1000 = 0 THEN 'product_' || md5(random()::text) || '_common' -- ~0.1% match
    ELSE 'generic_item_' || g || '_' || md5(random()::text)    -- ~99.9% don't match
    END,
    random_vector(512) -- Assumes random_vector function exists
FROM generate_series(1, 999999) g;
Measure the baseline performance of the vector similarity search without the columnar engine.



SELECT id, description, embedding <-> '[...]' AS distance
FROM items
WHERE description LIKE '%product_%_common%'
ORDER BY embedding <-> '[...]'
LIMIT 100;
Enable columnar engine and vector support by running the following command in the Google Cloud CLI. To use the gcloud CLI, you can install and initialize the gcloud CLI.



gcloud beta alloydb instances update INSTANCE_ID \
    --cluster=CLUSTER_ID \
    --region=REGION_ID \
    --project=PROJECT_ID \
    --database-flags=google_columnar_engine.enabled=on,google_columnar_engine.enable_vector_support=on
Add the items table to the columnar engine:



SELECT google_columnar_engine_add('items');
Measure the performance of the vector similarity search using the columnar engine. You re-run the query that you previously ran to measure baseline performance.



SELECT id, description, embedding <-> '[...]' AS distance
FROM items
WHERE description LIKE '%product_%_common%'
ORDER BY embedding <-> '[...]'
LIMIT 100;
To check whether the query ran with the columnar engine, run the following command:



explain (analyze) SELECT id, description, embedding <-> '[...]' AS distance
FROM items
WHERE description LIKE '%product_%_common%'
ORDER BY embedding <-> '[...]'
LIMIT 100;

----

https://docs.cloud.google.com/alloydb/omni/containers/current/docs/quickstart