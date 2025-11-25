# PostgreSQL Setup Guide

This guide covers setting up PostgreSQL for the TypedAI application, both for local development and production deployment with Google Cloud SQL.

## 🚀 Quick Start (Zero Config!)

**The absolute easiest way to get started:**

1. Edit `variables/local.env`:
   ```bash
   DATABASE_TYPE=postgres
   DATABASE_HOST=localhost
   DATABASE_PORT=5432
   DATABASE_USER=postgres
   DATABASE_PASSWORD=postgres
   DATABASE_NAME=typedai_dev
   ```

2. Run any command:
   ```bash
   npm run start:local
   ```

**That's it!** The Postgres Docker container will automatically start, tables will be created, and everything just works. ✨

---

## Table of Contents

- [Local Development Setup](#local-development-setup)
- [Google Cloud SQL Setup](#google-cloud-sql-setup)
- [Environment Variables](#environment-variables)
- [Database Schema](#database-schema)
- [Migration from Firestore](#migration-from-firestore)
- [Troubleshooting](#troubleshooting)

---

## Local Development Setup

### Option 1: Automatic Docker Start (Recommended) ⭐

**Zero configuration required!** Just set `DATABASE_TYPE=postgres` in your `local.env` file and the Docker container will automatically start when you run any command.

**How it works:**
- When you run any npm command (tests, start, etc.)
- The Postgres application context checks if Docker Postgres is running
- If not, it automatically runs `docker compose up -d postgres`
- Waits for the container to be healthy
- Creates all tables automatically
- Your command proceeds normally

**Smart behavior:**
- ✅ Skips if already running (instant startup)
- ✅ Skips if running inside Docker
- ✅ Skips in CI environments
- ✅ Only runs when `DATABASE_HOST=localhost`

### Option 2: Manual Docker Compose

If you prefer manual control:

1. **Start the services:**
   ```bash
   docker compose up
   ```

2. **Access the services:**
   - **PostgreSQL**: `localhost:5432`
   - **pgAdmin**: http://localhost:5050
     - Email: `admin@typedai.dev`
     - Password: `admin`

3. **Configure pgAdmin** (first time only):
   - Open pgAdmin at http://localhost:5050
   - Right-click "Servers" → "Register" → "Server"
   - **General tab**: Name = `TypedAI Local`
   - **Connection tab**:
     - Host: `postgres` (Docker service name)
     - Port: `5432`
     - Database: `typedai_dev`
     - Username: `postgres`
     - Password: `postgres`

### Option 3: Local PostgreSQL Installation

1. **Install PostgreSQL:**
   ```bash
   # macOS
   brew install postgresql@16
   brew services start postgresql@16

   # Ubuntu/Debian
   sudo apt-get install postgresql-16
   sudo systemctl start postgresql

   # Windows
   # Download installer from https://www.postgresql.org/download/windows/
   ```

2. **Create database:**
   ```bash
   createdb typedai_dev
   ```

3. **Set environment variables:**
   ```bash
   export DATABASE_HOST=localhost
   export DATABASE_PORT=5432
   export DATABASE_USER=postgres
   export DATABASE_PASSWORD=postgres
   export DATABASE_NAME=typedai_dev
   ```

### Auto-Schema Initialization

The application automatically creates all required tables on startup. No manual schema migration is needed!

The schema initialization happens in `src/modules/postgres/schemaUtils.ts` and includes:

- ✅ `users` - User accounts and configuration
- ✅ `chats` - Chat conversations
- ✅ `agent_contexts` - Agent execution state
- ✅ `agent_iterations` - Agent iteration history
- ✅ `code_task_sessions` - Code task tracking
- ✅ `code_task_presets` - Saved code task configurations
- ✅ `llm_calls` - LLM API call logs
- ✅ `prompt_groups` - Prompt templates
- ✅ `prompt_revisions` - Prompt version history
- ✅ `function_cache` - Function result caching
- ✅ `code_review_configs` - Code review configurations
- ✅ `merge_request_review_cache` - MR review fingerprints
- ✅ `cicd_stats` - CI/CD job statistics

---

## Google Cloud SQL Setup

### Step 1: Create Cloud SQL Instance

1. **Create a Cloud SQL instance:**
   ```bash
   gcloud sql instances create typedai-db \
     --database-version=POSTGRES_16 \
     --tier=db-f1-micro \
     --region=us-central1 \
     --storage-type=SSD \
     --storage-size=10GB \
     --backup-start-time=03:00
   ```

   **For production, use a larger tier:**
   ```bash
   gcloud sql instances create typedai-db-prod \
     --database-version=POSTGRES_16 \
     --tier=db-n1-standard-1 \
     --region=us-central1 \
     --storage-type=SSD \
     --storage-size=50GB \
     --storage-auto-increase \
     --backup-start-time=03:00 \
     --maintenance-window-day=SUN \
     --maintenance-window-hour=03
   ```

2. **Create the database:**
   ```bash
   gcloud sql databases create typedai_prod \
     --instance=typedai-db-prod
   ```

3. **Set the postgres password:**
   ```bash
   gcloud sql users set-password postgres \
     --instance=typedai-db-prod \
     --password=YOUR_SECURE_PASSWORD
   ```

### Step 2: Configure Connectivity

#### Option A: Cloud SQL Proxy (Recommended for Cloud Run/GKE)

1. **Enable Cloud SQL Admin API:**
   ```bash
   gcloud services enable sqladmin.googleapis.com
   ```

2. **Get connection name:**
   ```bash
   gcloud sql instances describe typedai-db-prod \
     --format="value(connectionName)"
   # Output: PROJECT_ID:REGION:INSTANCE_NAME
   ```

3. **For Cloud Run, add connection:**
   ```bash
   gcloud run services update typedai-app \
     --add-cloudsql-instances=PROJECT_ID:REGION:INSTANCE_NAME
   ```

4. **Use Unix socket connection:**
   ```bash
   export DATABASE_HOST=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME
   export DATABASE_PORT=5432
   ```

#### Option B: Public IP with SSL (For external connections)

1. **Create SSL certificate:**
   ```bash
   gcloud sql ssl-certs create typedai-client \
     --instance=typedai-db-prod
   ```

2. **Download certificates:**
   ```bash
   gcloud sql ssl-certs describe typedai-client \
     --instance=typedai-db-prod \
     --format="get(cert)" > client-cert.pem
   ```

3. **Authorize your IP:**
   ```bash
   gcloud sql instances patch typedai-db-prod \
     --authorized-networks=YOUR_IP_ADDRESS/32
   ```

### Step 3: Configure Environment Variables

Create a `.env.production` file or set environment variables:

```bash
# Cloud SQL connection (via proxy)
DATABASE_HOST=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=YOUR_SECURE_PASSWORD
DATABASE_NAME=typedai_prod

# Or, for public IP connection:
# DATABASE_HOST=<CLOUD_SQL_PUBLIC_IP>
# DATABASE_PORT=5432
# DATABASE_USER=postgres
# DATABASE_PASSWORD=YOUR_SECURE_PASSWORD
# DATABASE_NAME=typedai_prod
# DATABASE_SSL=true
```

### Step 4: Deploy and Initialize

1. **Deploy your application** to Cloud Run/GKE with the environment variables

2. **Tables are auto-created** on first connection! 🎉

---

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_HOST` | Database host or Unix socket | `localhost` or `/cloudsql/...` |
| `DATABASE_PORT` | Database port | `5432` |
| `DATABASE_USER` | Database username | `postgres` |
| `DATABASE_PASSWORD` | Database password | `your_secure_password` |
| `DATABASE_NAME` | Database name | `typedai_dev` or `typedai_prod` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_SSL` | Enable SSL connection | `false` |
| `DATABASE_MAX_CONNECTIONS` | Max connection pool size | `10` |

### Variable Files

Create separate files for different environments:

- `.env.local` - Local development
- `.env.test` - Testing
- `.env.production` - Production

**Example `.env.local`:**
```bash
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres
DATABASE_NAME=typedai_dev
```

---

## Database Schema

### Key Features

1. **Auto-initialization**: All tables created automatically on startup
2. **Foreign key constraints**: Referential integrity enforced
3. **Cascade deletes**: Related records cleaned up automatically
4. **JSONB columns**: Efficient storage of complex objects
5. **Indexes**: Optimized for common query patterns

### Schema Highlights

- **No document size limits** (unlike Firestore's 1MB limit)
- **ACID transactions** for data consistency
- **Revision tracking** for prompts
- **Composite indexes** for performance
- **Timestamptz** for timezone-aware timestamps

### Manual Schema Inspection

```bash
# Connect to database
psql -h localhost -U postgres -d typedai_dev

# List tables
\dt

# Describe a table
\d users

# View indexes
\di

# View foreign keys
\d+ agent_iterations
```

---

## Migration from Firestore

### Overview

The Postgres implementation is **feature-complete** with Firestore and ready for migration. Key advantages:

- ✅ **No 1MB document size limit** - Store large LLM conversations
- ✅ **Transactional consistency** - ACID guarantees
- ✅ **Lower cost** - Standard Postgres pricing vs Firestore premium
- ✅ **Better performance** - Complex queries run faster
- ✅ **Familiar SQL** - Easier debugging and analysis

### Migration Script

A migration script is available at `scripts/migrate-firestore-to-postgres.ts` to copy data from Firestore to Postgres.

```bash
# Set environment variables for both databases
export GCLOUD_PROJECT=your-project
export FIRESTORE_EMULATOR_HOST=  # Leave empty for production Firestore

export DATABASE_HOST=localhost
export DATABASE_PORT=5432
export DATABASE_USER=postgres
export DATABASE_PASSWORD=postgres
export DATABASE_NAME=typedai_dev

# Run migration
npm run migrate:firestore-to-postgres
```

### Migration Steps

1. **Set up Postgres** (Cloud SQL or local)
2. **Run the application once** to create tables
3. **Run migration script** to copy data
4. **Verify data integrity** with test queries
5. **Update application config** to use Postgres
6. **Test thoroughly** in staging environment
7. **Deploy to production**
8. **Monitor for issues**

### Rollback Plan

Keep Firestore running in parallel for the first week:

1. **Dual-write mode**: Write to both databases
2. **Read from Postgres**: Use Postgres as primary
3. **Fallback to Firestore**: If issues arise
4. **Decommission Firestore**: After validation period

---

## Troubleshooting

### Connection Issues

**Problem**: Cannot connect to database

```bash
# Check if Postgres is running
docker compose ps  # For Docker
brew services list | grep postgres  # For Homebrew

# Test connection
psql -h localhost -U postgres -d typedai_dev -c "SELECT 1"

# Check logs
docker compose logs postgres  # For Docker
tail -f /usr/local/var/log/postgres.log  # For Homebrew
```

**Problem**: Connection refused on Cloud SQL

```bash
# Check instance status
gcloud sql instances describe typedai-db-prod

# Test connection via proxy
./cloud_sql_proxy -instances=PROJECT_ID:REGION:INSTANCE=tcp:5432

# Check authorized networks
gcloud sql instances describe typedai-db-prod \
  --format="value(settings.ipConfiguration.authorizedNetworks)"
```

### Performance Issues

**Problem**: Slow queries

```sql
-- Enable query logging
ALTER SYSTEM SET log_min_duration_statement = 1000;  -- Log queries > 1s
SELECT pg_reload_conf();

-- Check slow queries
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 10;

-- Analyze table statistics
ANALYZE users;
ANALYZE chats;
```

**Problem**: High memory usage

```bash
# Check connection count
SELECT count(*) FROM pg_stat_activity;

# Kill idle connections
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle'
  AND state_change < now() - interval '1 hour';
```

### Schema Issues

**Problem**: Table doesn't exist

The application should auto-create tables. If it doesn't:

```bash
# Check if ensureAllTablesExist is being called
# Look for logs on startup

# Manually trigger schema creation
npm run create-schema
```

**Problem**: Migration failed

```bash
# Check which tables exist
psql -h localhost -U postgres -d typedai_dev -c "\dt"

# Check for partial data
psql -h localhost -U postgres -d typedai_dev -c "SELECT count(*) FROM users"

# Drop and recreate (CAUTION: DATA LOSS)
dropdb typedai_dev && createdb typedai_dev
```

### Cloud SQL Specific

**Problem**: Cloud SQL quota exceeded

```bash
# Check current usage
gcloud sql operations list --instance=typedai-db-prod

# Increase storage (if auto-increase not enabled)
gcloud sql instances patch typedai-db-prod --storage-size=100GB

# Upgrade instance tier
gcloud sql instances patch typedai-db-prod --tier=db-n1-standard-2
```

**Problem**: Maintenance window causing downtime

```bash
# Change maintenance window
gcloud sql instances patch typedai-db-prod \
  --maintenance-window-day=SUN \
  --maintenance-window-hour=03

# Enable HA for zero-downtime maintenance
gcloud sql instances patch typedai-db-prod \
  --availability-type=REGIONAL
```

---

## Cost Optimization

### Cloud SQL Pricing (us-central1)

**db-f1-micro (Shared CPU, 0.6GB RAM):**
- ~$9/month (Development/Testing)

**db-g1-small (Shared CPU, 1.7GB RAM):**
- ~$25/month (Small production)

**db-n1-standard-1 (1 vCPU, 3.75GB RAM):**
- ~$50/month (Medium production)

### Tips to Reduce Costs

1. **Stop development instances** when not in use
   ```bash
   gcloud sql instances patch typedai-db --activation-policy=NEVER
   ```

2. **Use storage auto-increase** to avoid over-provisioning
   ```bash
   gcloud sql instances patch typedai-db --storage-auto-increase
   ```

3. **Enable automatic backups** but limit retention
   ```bash
   gcloud sql instances patch typedai-db --backup-start-time=03:00 --retained-backups-count=7
   ```

4. **Use Cloud SQL Proxy** instead of public IP (no egress charges)

5. **Monitor query performance** to avoid expensive operations
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
   ```

---

## Additional Resources

- [Cloud SQL Documentation](https://cloud.google.com/sql/docs/postgres)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/16/)
- [Kysely Query Builder](https://kysely.dev/)
- [Cloud SQL Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy)

---

## Support

For issues or questions:

1. Check the [troubleshooting section](#troubleshooting)
2. Review application logs for error messages
3. Check Postgres logs: `docker compose logs postgres`
4. Open an issue on GitHub with:
   - Error messages
   - Environment details
   - Steps to reproduce
