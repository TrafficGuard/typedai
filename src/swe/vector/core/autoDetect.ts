import type { AlloyDBNestedConfig, DiscoveryEngineConfig, GoogleCloudConfig, VectorStoreConfig } from './config';

export type VectorBackend = 'alloydb' | 'discovery-engine';

export interface BackendDetection {
	backend: VectorBackend | null;
	reason: string;
	config: Partial<VectorStoreConfig>;
}

/**
 * Auto-detect available vector backend from environment variables
 *
 * Detection Priority:
 * 1. AlloyDB - ALLOYDB_HOST or PGHOST
 * 2. Discovery Engine - GCLOUD_PROJECT
 * 3. null - No backend detected
 */
export function detectBackend(): BackendDetection {
	// 1. Check for AlloyDB/Postgres
	const pgHost = process.env.ALLOYDB_HOST || process.env.PGHOST;
	if (pgHost) {
		const alloydb: AlloyDBNestedConfig = {
			host: pgHost,
			port: Number.parseInt(process.env.ALLOYDB_PORT || process.env.PGPORT || '5432', 10),
			database: process.env.ALLOYDB_DATABASE || process.env.PGDATABASE || 'vectors',
			user: process.env.ALLOYDB_USER || process.env.PGUSER || 'postgres',
			password: process.env.ALLOYDB_PASSWORD || process.env.PGPASSWORD,
		};

		return {
			backend: 'alloydb',
			reason: `AlloyDB detected via ${process.env.ALLOYDB_HOST ? 'ALLOYDB_HOST' : 'PGHOST'}`,
			config: { alloydb },
		};
	}

	// 2. Check for Discovery Engine
	const gcpProject = process.env.GCLOUD_PROJECT;
	if (gcpProject) {
		const googleCloud: GoogleCloudConfig = {
			projectId: gcpProject,
			region: process.env.GCLOUD_REGION || 'us-central1',
		};

		const discoveryEngine: DiscoveryEngineConfig = {
			location: process.env.DISCOVERY_ENGINE_LOCATION || 'global',
			collectionId: process.env.DISCOVERY_ENGINE_COLLECTION_ID || 'default_collection',
			datastoreId: process.env.DISCOVERY_ENGINE_DATA_STORE_ID,
		};

		return {
			backend: 'discovery-engine',
			reason: 'Discovery Engine detected via GCLOUD_PROJECT',
			config: { googleCloud, discoveryEngine },
		};
	}

	// 3. No backend detected
	return {
		backend: null,
		reason: 'No backend detected',
		config: {},
	};
}

/**
 * Require a backend to be detected, throw error if not
 */
export function requireBackend(): BackendDetection {
	const detection = detectBackend();
	if (!detection.backend) {
		throw new Error(
			'No vector backend detected. Set one of:\n' + '  - ALLOYDB_HOST or PGHOST (for AlloyDB/Postgres)\n' + '  - GCLOUD_PROJECT (for Discovery Engine)',
		);
	}
	return detection;
}

/**
 * Build backend-specific config based on explicit backend choice
 */
export function buildBackendConfig(backend: VectorBackend): Partial<VectorStoreConfig> {
	switch (backend) {
		case 'alloydb': {
			const alloydb: AlloyDBNestedConfig = {
				host: process.env.ALLOYDB_HOST || process.env.PGHOST,
				port: Number.parseInt(process.env.ALLOYDB_PORT || process.env.PGPORT || '5432', 10),
				database: process.env.ALLOYDB_DATABASE || process.env.PGDATABASE || 'vectors',
				user: process.env.ALLOYDB_USER || process.env.PGUSER || 'postgres',
				password: process.env.ALLOYDB_PASSWORD || process.env.PGPASSWORD,
			};
			return { alloydb };
		}
		case 'discovery-engine': {
			const googleCloud: GoogleCloudConfig = {
				projectId: process.env.GCLOUD_PROJECT,
				region: process.env.GCLOUD_REGION || 'us-central1',
			};
			const discoveryEngine: DiscoveryEngineConfig = {
				location: process.env.DISCOVERY_ENGINE_LOCATION || 'global',
				collectionId: process.env.DISCOVERY_ENGINE_COLLECTION_ID || 'default_collection',
				datastoreId: process.env.DISCOVERY_ENGINE_DATA_STORE_ID,
			};
			return { googleCloud, discoveryEngine };
		}
	}
}
