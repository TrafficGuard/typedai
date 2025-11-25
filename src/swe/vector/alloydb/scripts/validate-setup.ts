#!/usr/bin/env tsx

/**
 * AlloyDB Setup Validation Script
 * Validates that AlloyDB Omni is properly configured and ready for vector search
 */

import path from 'node:path';
import { config } from 'dotenv';
import { DEFAULT_VECTOR_CONFIG } from '../../core/config';
import { AlloyDBClient } from '../alloydbClient';
import { buildAlloyDBConfig } from '../alloydbConfig';
import type { AlloyDBConfig } from '../alloydbConfig';
import { validateAlloyDBPrerequisites } from '../alloydbFactory';

// Load environment variables
const envPath = path.join(__dirname, '../.env.local');
config({ path: envPath });

interface ValidationResult {
	step: string;
	status: 'success' | 'warning' | 'error';
	message: string;
	details?: any;
}

const results: ValidationResult[] = [];

function addResult(step: string, status: 'success' | 'warning' | 'error', message: string, details?: any) {
	results.push({ step, status, message, details });
	const icon = status === 'success' ? '✅' : status === 'warning' ? '⚠️' : '❌';
	console.log(`${icon} ${step}: ${message}`);
	if (details) {
		console.log('   Details:', details);
	}
}

async function validateSetup() {
	console.log('🔍 Validating AlloyDB Omni setup...\n');

	// Step 1: Check environment variables
	console.log('Step 1: Environment Variables');
	const requiredEnvVars = ['ALLOYDB_DATABASE', 'ALLOYDB_USER', 'ALLOYDB_PASSWORD'];
	const missingVars = requiredEnvVars.filter((v) => !process.env[v]);

	if (missingVars.length > 0) {
		addResult('Environment', 'error', `Missing required environment variables: ${missingVars.join(', ')}`);
	} else {
		addResult('Environment', 'success', 'All required environment variables are set', {
			database: process.env.ALLOYDB_DATABASE,
			host: process.env.ALLOYDB_HOST || 'localhost',
			port: process.env.ALLOYDB_PORT || 5432,
			user: process.env.ALLOYDB_USER,
		});
	}

	// Step 2: Build configuration
	console.log('\nStep 2: Configuration');
	let alloydbConfig: AlloyDBConfig;
	try {
		alloydbConfig = buildAlloyDBConfig({
			...DEFAULT_VECTOR_CONFIG,
			alloydb: { database: process.env.ALLOYDB_DATABASE },
		});
		addResult('Configuration', 'success', 'Configuration built successfully', {
			database: alloydbConfig.database,
			host: alloydbConfig.host,
			port: alloydbConfig.port,
			embeddingModel: alloydbConfig.embeddingModel,
		});
	} catch (error) {
		addResult('Configuration', 'error', `Failed to build configuration: ${error}`);
		return printSummary();
	}

	// Step 3: Test connection
	console.log('\nStep 3: Database Connection');
	let client: AlloyDBClient;
	try {
		client = new AlloyDBClient(alloydbConfig);
		await client.connect();
		addResult('Connection', 'success', 'Successfully connected to AlloyDB');
	} catch (error) {
		addResult('Connection', 'error', `Failed to connect: ${error instanceof Error ? error.message : String(error)}`);
		return printSummary();
	}

	// Step 4: Check PostgreSQL version
	console.log('\nStep 4: PostgreSQL Version');
	try {
		const versionResult = await client.query('SELECT version()');
		const version = versionResult.rows[0].version;
		addResult('PostgreSQL', 'success', 'Version check passed', { version });
	} catch (error) {
		addResult('PostgreSQL', 'error', `Version check failed: ${error}`);
	}

	// Step 5: Check extensions
	console.log('\nStep 5: Required Extensions');
	try {
		const extensions = await client.checkExtensions();

		if (extensions.vector) {
			addResult('Vector Extension', 'success', 'Vector extension is installed');
		} else {
			addResult('Vector Extension', 'error', 'Vector extension is NOT installed');
		}

		if (extensions.scann) {
			addResult('ScaNN Extension', 'success', 'AlloyDB ScaNN extension is installed');
		} else {
			addResult('ScaNN Extension', 'error', 'AlloyDB ScaNN extension is NOT installed');
		}

		if (extensions.columnarEngine) {
			addResult('Columnar Engine', 'success', 'Columnar engine extension is installed');
		} else {
			addResult('Columnar Engine', 'warning', 'Columnar engine extension is not available (optional)');
		}
	} catch (error) {
		addResult('Extensions', 'error', `Extension check failed: ${error}`);
	}

	// Step 6: Check automated embeddings
	console.log('\nStep 6: Automated Embeddings');
	try {
		const hasAI = await client.checkAutomatedEmbeddings();
		if (hasAI) {
			addResult('AI Embeddings', 'success', 'Automated embeddings (ai.initialize_embeddings) available');
		} else {
			addResult('AI Embeddings', 'warning', 'Automated embeddings not available - will need manual embedding via Vertex AI');
		}
	} catch (error) {
		addResult('AI Embeddings', 'warning', `Could not check automated embeddings: ${error}`);
	}

	// Step 7: Test vector operations
	console.log('\nStep 7: Vector Operations');
	try {
		// Create a temporary table for testing
		await client.query(`
			CREATE TEMP TABLE IF NOT EXISTS test_vectors (
				id SERIAL PRIMARY KEY,
				embedding VECTOR(3)
			)
		`);

		// Insert test vectors
		await client.query(`
			INSERT INTO test_vectors (embedding) VALUES
				('[1,2,3]'),
				('[4,5,6]'),
				('[7,8,9]')
		`);

		// Test vector similarity search
		const searchResult = await client.query(`
			SELECT id, embedding <-> '[2,3,4]' AS distance
			FROM test_vectors
			ORDER BY distance
			LIMIT 1
		`);

		if (searchResult.rows.length > 0) {
			addResult('Vector Search', 'success', 'Vector similarity search works', {
				closestVector: searchResult.rows[0].id,
				distance: searchResult.rows[0].distance,
			});
		} else {
			addResult('Vector Search', 'warning', 'Vector search returned no results');
		}

		// Clean up
		await client.query('DROP TABLE IF EXISTS test_vectors');
	} catch (error) {
		addResult('Vector Operations', 'error', `Vector operations failed: ${error instanceof Error ? error.message : String(error)}`);
	}

	// Step 8: Test full-text search
	console.log('\nStep 8: Full-Text Search');
	try {
		await client.query(`
			CREATE TEMP TABLE IF NOT EXISTS test_fts (
				id SERIAL PRIMARY KEY,
				content TEXT,
				search_vector TSVECTOR
			)
		`);

		await client.query(`
			INSERT INTO test_fts (content, search_vector) VALUES
				('hello world', to_tsvector('english', 'hello world')),
				('goodbye world', to_tsvector('english', 'goodbye world'))
		`);

		const ftsResult = await client.query(`
			SELECT id, content
			FROM test_fts
			WHERE search_vector @@ plainto_tsquery('english', 'hello')
		`);

		if (ftsResult.rows.length > 0) {
			addResult('Full-Text Search', 'success', 'Full-text search works');
		} else {
			addResult('Full-Text Search', 'warning', 'Full-text search returned no results');
		}

		await client.query('DROP TABLE IF EXISTS test_fts');
	} catch (error) {
		addResult('Full-Text Search', 'error', `Full-text search failed: ${error}`);
	}

	// Step 9: Database statistics
	console.log('\nStep 9: Database Statistics');
	try {
		const stats = await client.getStats();
		addResult('Database Stats', 'success', 'Retrieved database statistics', stats);
	} catch (error) {
		addResult('Database Stats', 'warning', `Could not retrieve stats: ${error}`);
	}

	// Step 10: Run comprehensive validation
	console.log('\nStep 10: Comprehensive Validation');
	try {
		const validation = await validateAlloyDBPrerequisites(alloydbConfig);

		if (validation.valid) {
			addResult('Prerequisites', 'success', 'All prerequisites validated');
		} else {
			addResult('Prerequisites', 'error', 'Prerequisite validation failed', {
				errors: validation.errors,
			});
		}

		if (validation.warnings.length > 0) {
			addResult('Prerequisites Warnings', 'warning', 'Some warnings found', {
				warnings: validation.warnings,
			});
		}
	} catch (error) {
		addResult('Prerequisites', 'error', `Validation failed: ${error}`);
	}

	// Cleanup
	await client.disconnect();

	printSummary();
}

function printSummary() {
	console.log(`\n${'='.repeat(80)}`);
	console.log('VALIDATION SUMMARY');
	console.log(`${'='.repeat(80)}\n`);

	const successCount = results.filter((r) => r.status === 'success').length;
	const warningCount = results.filter((r) => r.status === 'warning').length;
	const errorCount = results.filter((r) => r.status === 'error').length;

	console.log(`Total Checks: ${results.length}`);
	console.log(`✅ Success: ${successCount}`);
	console.log(`⚠️  Warnings: ${warningCount}`);
	console.log(`❌ Errors: ${errorCount}\n`);

	if (errorCount > 0) {
		console.log('❌ VALIDATION FAILED');
		console.log('\nErrors:');
		results
			.filter((r) => r.status === 'error')
			.forEach((r) => {
				console.log(`  • ${r.step}: ${r.message}`);
			});
		process.exit(1);
	} else if (warningCount > 0) {
		console.log('⚠️  VALIDATION PASSED WITH WARNINGS');
		console.log('\nWarnings:');
		results
			.filter((r) => r.status === 'warning')
			.forEach((r) => {
				console.log(`  • ${r.step}: ${r.message}`);
			});
		console.log('\n✅ Your setup is functional but has some optional features missing.');
		process.exit(0);
	} else {
		console.log('✅ VALIDATION PASSED');
		console.log('\n🎉 Your AlloyDB Omni setup is fully configured and ready to use!');
		process.exit(0);
	}
}

// Run validation
validateSetup().catch((error) => {
	console.error('❌ Validation failed with error:', error);
	process.exit(1);
});
