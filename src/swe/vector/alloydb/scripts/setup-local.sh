#!/bin/bash
set -e

# AlloyDB Omni Local Setup Script
# Sets up AlloyDB Omni Docker container for local development on Mac OSX

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALLOYDB_DIR="$(dirname "$SCRIPT_DIR")"

echo "🚀 Setting up AlloyDB Omni for local development..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running. Please start Docker Desktop."
    exit 1
fi

# Check Docker Compose version
if ! docker compose version > /dev/null 2>&1; then
    echo "❌ Error: Docker Compose is not installed or not available."
    echo "Please install Docker Desktop with Docker Compose support."
    exit 1
fi

# Create .env.local if it doesn't exist
if [ ! -f "$ALLOYDB_DIR/.env.local" ]; then
    echo "📝 Creating .env.local from example..."
    cp "$ALLOYDB_DIR/.env.local.example" "$ALLOYDB_DIR/.env.local"
    echo "✅ Created .env.local - please review and update with your settings"
fi

# Load environment variables
if [ -f "$ALLOYDB_DIR/.env.local" ]; then
    export $(cat "$ALLOYDB_DIR/.env.local" | grep -v '^#' | xargs)
fi

# Pull latest AlloyDB Omni image
echo "📦 Pulling latest AlloyDB Omni image..."
docker pull google/alloydbomni:latest

# Start AlloyDB container
echo "🐳 Starting AlloyDB Omni container..."
cd "$ALLOYDB_DIR"
docker compose up -d

# Wait for database to be ready
echo "⏳ Waiting for AlloyDB to be ready..."
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
    if docker exec alloydb-vector pg_isready -U "${ALLOYDB_USER:-postgres}" > /dev/null 2>&1; then
        echo "✅ AlloyDB is ready!"
        break
    fi
    attempt=$((attempt + 1))
    echo "   Attempt $attempt/$max_attempts..."
    sleep 2
done

if [ $attempt -eq $max_attempts ]; then
    echo "❌ Error: AlloyDB failed to start within expected time"
    echo "Check logs with: docker logs alloydb-vector"
    exit 1
fi

# Run validation script
echo "🔍 Validating AlloyDB setup..."
sleep 2  # Give extensions time to initialize

# Check extensions
echo "Checking installed extensions..."
docker exec -i alloydb-vector psql -U "${ALLOYDB_USER:-postgres}" -d "${ALLOYDB_DATABASE:-vector_db}" <<EOF
SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'alloydb_scann', 'google_columnar_engine');
EOF

echo ""
echo "✅ AlloyDB Omni setup complete!"
echo ""
echo "📊 Connection details:"
echo "   Host:     localhost"
echo "   Port:     5432"
echo "   Database: ${ALLOYDB_DATABASE:-vector_db}"
echo "   User:     ${ALLOYDB_USER:-postgres}"
echo ""
echo "🔗 Connection string:"
echo "   postgresql://${ALLOYDB_USER:-postgres}:${ALLOYDB_PASSWORD:-alloydb123}@localhost:5432/${ALLOYDB_DATABASE:-vector_db}"
echo ""
echo "📝 Next steps:"
echo "   1. Update .env.local with your GCP project settings (for Vertex AI)"
echo "   2. Run: npm run test:alloydb:validate"
echo "   3. Try indexing a repository"
echo ""
echo "🛠️  Useful commands:"
echo "   View logs:    docker logs -f alloydb-vector"
echo "   Stop:         docker compose down"
echo "   Restart:      docker compose restart"
echo "   Reset data:   docker compose down -v && ./setup-local.sh"
echo "   Connect:      docker exec -it alloydb-vector psql -U ${ALLOYDB_USER:-postgres} -d ${ALLOYDB_DATABASE:-vector_db}"
