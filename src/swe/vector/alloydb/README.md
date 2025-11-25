# AlloyDB Vector Search

AlloyDB-based vector search implementation for code repository indexing with automated embedding and ScaNN indexing.

## Quick Start

### Local Development (AlloyDB Omni - Docker)

#### 1. Setup AlloyDB Omni (Docker)

```bash
npm run alloydb:setup
```

This will:
- Pull the AlloyDB Omni Docker image
- Start the container
- Initialize extensions (vector, alloydb_scann)
- Create `.env.local` configuration file

### 2. Validate Setup

```bash
npm run alloydb:validate
```

Runs comprehensive validation:
- ✅ Database connection
- ✅ Extensions installed
- ✅ Vector operations working
- ✅ Full-text search working

### 3. Run Example

```bash
# Index current directory
npm run alloydb:example

# Index specific repository
npm run alloydb:example -- /path/to/repo
```

### Production (GCP AlloyDB)

📘 **See [GCP_SETUP.md](./GCP_SETUP.md) for complete GCP setup guide**

#### Quick GCP Start

1. **Start AlloyDB Auth Proxy**:
   ```bash
   alloydb-auth-proxy 'projects/my-project-id/locations/us-central1/clusters/alloydb-trial/instances/alloydb-trial-instance'
   ```

2. **Configure**:
   ```bash
   cp .env.gcp.example .env.gcp
   # Edit with your credentials
   ```

3. **Validate**:
   ```bash
   npm run alloydb:validate
   ```

## NPM Scripts

```bash
npm run alloydb:setup       # Initial setup (run once)
npm run alloydb:validate    # Validate configuration
npm run alloydb:example     # Run indexing example
npm run alloydb:logs        # View container logs
npm run alloydb:psql        # Connect via psql
npm run alloydb:stop        # Stop container
npm run alloydb:restart     # Restart container
npm run alloydb:reset       # Reset (destroys data!)
```

## Configuration

Edit `src/swe/vector/alloydb/.env.local`:

```bash
# Database (defaults work out of the box)
ALLOYDB_HOST=localhost
ALLOYDB_PORT=5432
ALLOYDB_DATABASE=vector_db
ALLOYDB_USER=postgres
ALLOYDB_PASSWORD=alloydb123

# Vector search
ALLOYDB_VECTOR_WEIGHT=0.7  # 70% vector, 30% text

# GCP (for Vertex AI features)
GCLOUD_PROJECT=your-project
GCLOUD_REGION=us-central1
```

## Repository Configuration

Create `.vectorconfig.json` in your repository:

```json
{
  "name": "default",
  "contextualChunking": true,
  "hybridSearch": true,
  "dualEmbedding": false,
  "alloydbDatabase": "vector_db",
  "alloydbVectorWeight": 0.7,
  "includePatterns": ["src/**", "lib/**"],
  "fileExtensions": [".ts", ".js", ".py"]
}
```

## Programmatic Usage

```typescript
import { createAlloyDBOrchestrator } from '#swe/vector/alloydb';

const orchestrator = createAlloyDBOrchestrator('my-repo', {
  alloydbDatabase: 'vector_db',
  contextualChunking: true,
  hybridSearch: true,
});

// Index
await orchestrator.indexRepository('/path/to/repo');

// Search
const results = await orchestrator.search('authentication');
```

## Features

- ✅ **Automated Embeddings** - AlloyDB generates embeddings automatically
- ✅ **ScaNN AUTO Mode** - Self-tuning, self-maintaining vector index
- ✅ **Hybrid Search** - Vector + full-text search with RRF
- ✅ **Transactional Updates** - ACID guarantees for file updates
- ✅ **Columnar Engine** - Optional 2-10x faster filtered searches
- ✅ **Multi-Config** - Multiple vector configs per repository

## Architecture

```
Repository → AST Chunker → LLM Contextualizer → AlloyDB
                                                    ↓
                                            Auto Embedding
                                                    ↓
                                            ScaNN Index (AUTO)
                                                    ↓
Query → Hybrid Search (Vector + Text) → RRF → Results → Reranker
```

## Files

- `alloydbConfig.ts` - Configuration management
- `alloydbClient.ts` - PostgreSQL connection pooling
- `alloydbAdapter.ts` - IVectorStore implementation
- `alloydbOrchestrator.ts` - Pipeline orchestration
- `alloydbFactory.ts` - Factory functions
- `docker-compose.yml` - Local Docker setup
- `scripts/setup-local.sh` - Setup automation
- `scripts/validate-setup.ts` - Validation tool
- `scripts/example-index.ts` - Example usage

## Documentation

- `AlloyDB.md` - Complete documentation
- `IMPLEMENTATION_SUMMARY.md` - Design decisions and architecture

## Troubleshooting

### Docker not running
```bash
open -a Docker  # Start Docker Desktop
```

### Port 5432 in use
```bash
lsof -i :5432  # Find process
# Stop it or change port in docker-compose.yml
```

### Extensions missing
```bash
npm run alloydb:psql
# Then:
CREATE EXTENSION IF NOT EXISTS vector CASCADE;
CREATE EXTENSION IF NOT EXISTS alloydb_scann CASCADE;
```

### Slow performance
- Increase Docker resources: Settings → Resources → Advanced
- Recommended: 4 CPUs, 8GB RAM

## Production Deployment

For production, use fully managed AlloyDB on Google Cloud:

```typescript
const orchestrator = createAlloyDBOrchestrator('my-repo', {
  alloydbInstance: 'projects/my-project/locations/us-central1/clusters/my-cluster/instances/my-primary',
  alloydbDatabase: 'vector_db',
  // ... other config
});
```

## Cost Comparison vs Discovery Engine

| Feature | AlloyDB | Discovery Engine |
|---------|---------|------------------|
| Embedding API | Vertex AI (batched automatically) | Vertex AI (manual batching) |
| Storage | Standard PostgreSQL | Premium managed service |
| Search Queries | Included in instance cost | Per-query charges |
| Transactions | ACID | Eventual consistency |
| Maintenance | Automated | Manual purge/rebuild |

## Requirements

- Docker Desktop (for local development)
- Node.js 20.6+
- GCP Project (for Vertex AI features)

## Support

- Issues: GitHub Issues
- Docs: [AlloyDB.md](./AlloyDB.md)
- Implementation: [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)
