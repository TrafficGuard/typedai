import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect } from 'chai';
import { buildBackendConfig, detectBackend } from './autoDetect';
import {
	type VectorStoreConfig,
	isVectorSearchAvailable,
	loadAllVectorConfigs,
	loadVectorConfig,
	resolveProductConfig,
	validateVectorConfig,
	validateVectorConfigs,
} from './config';
import { type RepositoryVectorConfig, getPreset, listPresets, loadPresetRegistry } from './presets';

describe('vector config', () => {
	let tempDir: string;
	const originalEnv: NodeJS.ProcessEnv = {};

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-config-test-'));
		// Save relevant env vars
		originalEnv.TYPEDAI_HOME = process.env.TYPEDAI_HOME;
		originalEnv.PGHOST = process.env.PGHOST;
		originalEnv.ALLOYDB_HOST = process.env.ALLOYDB_HOST;
		originalEnv.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT;
		originalEnv.PGPORT = process.env.PGPORT;
		originalEnv.PGDATABASE = process.env.PGDATABASE;
		originalEnv.GCLOUD_REGION = process.env.GCLOUD_REGION;
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		// Restore env vars (must use delete to actually remove, not set to undefined)
		restoreEnvVar('TYPEDAI_HOME', originalEnv.TYPEDAI_HOME);
		restoreEnvVar('PGHOST', originalEnv.PGHOST);
		restoreEnvVar('ALLOYDB_HOST', originalEnv.ALLOYDB_HOST);
		restoreEnvVar('GCLOUD_PROJECT', originalEnv.GCLOUD_PROJECT);
		restoreEnvVar('PGPORT', originalEnv.PGPORT);
		restoreEnvVar('PGDATABASE', originalEnv.PGDATABASE);
		restoreEnvVar('GCLOUD_REGION', originalEnv.GCLOUD_REGION);
	});

	function restoreEnvVar(key: string, originalValue: string | undefined): void {
		if (originalValue !== undefined) {
			process.env[key] = originalValue;
		} else {
			delete process.env[key];
		}
	}

	function clearEnvVar(key: string): void {
		delete process.env[key];
	}

	describe('isVectorSearchAvailable', () => {
		it('returns false when no .typedai.json exists', () => {
			const result = isVectorSearchAvailable(tempDir);
			expect(result).to.equal(false);
		});
	});

	describe('autoDetect', () => {
		it('detects AlloyDB from ALLOYDB_HOST', () => {
			process.env.ALLOYDB_HOST = 'localhost';
			const result = detectBackend();
			expect(result.backend).to.equal('alloydb');
			expect(result.reason).to.include('ALLOYDB_HOST');
		});

		it('detects AlloyDB from PGHOST', () => {
			clearEnvVar('ALLOYDB_HOST');
			process.env.PGHOST = 'localhost';
			const result = detectBackend();
			expect(result.backend).to.equal('alloydb');
			expect(result.reason).to.include('PGHOST');
		});

		it('detects Discovery Engine from GCLOUD_PROJECT', () => {
			clearEnvVar('ALLOYDB_HOST');
			clearEnvVar('PGHOST');
			process.env.GCLOUD_PROJECT = 'my-project';
			const result = detectBackend();
			expect(result.backend).to.equal('discovery-engine');
			expect(result.reason).to.include('GCLOUD_PROJECT');
		});

		it('returns null when no backend detected', () => {
			clearEnvVar('ALLOYDB_HOST');
			clearEnvVar('PGHOST');
			clearEnvVar('GCLOUD_PROJECT');
			const result = detectBackend();
			expect(result.backend).to.equal(null);
		});

		it('prefers AlloyDB over Discovery Engine', () => {
			process.env.PGHOST = 'localhost';
			process.env.GCLOUD_PROJECT = 'my-project';
			const result = detectBackend();
			expect(result.backend).to.equal('alloydb');
		});

		it('builds AlloyDB config correctly', () => {
			clearEnvVar('ALLOYDB_HOST');
			process.env.PGHOST = 'myhost';
			process.env.PGPORT = '5433';
			process.env.PGDATABASE = 'mydb';
			const config = buildBackendConfig('alloydb');
			expect(config.alloydb?.host).to.equal('myhost');
			expect(config.alloydb?.port).to.equal(5433);
			expect(config.alloydb?.database).to.equal('mydb');
		});

		it('builds Discovery Engine config correctly', () => {
			process.env.GCLOUD_PROJECT = 'my-project';
			process.env.GCLOUD_REGION = 'europe-west1';
			const config = buildBackendConfig('discovery-engine');
			expect(config.googleCloud?.projectId).to.equal('my-project');
			expect(config.googleCloud?.region).to.equal('europe-west1');
		});
	});

	describe('presets', () => {
		beforeEach(() => {
			// Point to test preset registry
			const presetRegistry: VectorStoreConfig[] = [
				{
					name: 'test-fast',
					embedding: { provider: 'vertex', model: 'gemini-embedding-001' },
					chunking: { dualEmbedding: false, contextualChunking: false },
					search: { hybridSearch: true },
				},
				{
					name: 'test-quality',
					default: true,
					embedding: { provider: 'vertex', model: 'gemini-embedding-001' },
					chunking: { dualEmbedding: true, contextualChunking: true },
					search: {
						hybridSearch: true,
						reranking: { provider: 'vertex', model: 'semantic-ranker-default@latest', topK: 50 },
					},
				},
			];
			fs.writeFileSync(path.join(tempDir, '.vectorconfig.json'), JSON.stringify(presetRegistry, null, 2));
			process.env.TYPEDAI_HOME = tempDir;
		});

		it('loads preset registry', () => {
			const presets = loadPresetRegistry();
			expect(presets).to.have.length(2);
			expect(presets[0]?.name).to.equal('test-fast');
		});

		it('lists preset names', () => {
			const names = listPresets();
			expect(names).to.deep.equal(['test-fast', 'test-quality']);
		});

		it('gets preset by name', () => {
			const preset = getPreset('test-fast');
			expect(preset.name).to.equal('test-fast');
			expect(preset.chunking?.dualEmbedding).to.equal(false);
		});

		it('throws for unknown preset', () => {
			expect(() => getPreset('nonexistent')).to.throw('Unknown preset');
		});
	});

	describe('resolveProductConfig', () => {
		beforeEach(() => {
			// Set up test preset registry
			const presetRegistry: VectorStoreConfig[] = [
				{
					name: 'test-preset',
					embedding: { provider: 'vertex', model: 'gemini-embedding-001' },
					chunking: { dualEmbedding: false, contextualChunking: false, size: 2500, overlap: 300 },
					search: { hybridSearch: true },
					maxFileSize: 1048576,
				},
			];
			fs.writeFileSync(path.join(tempDir, '.vectorconfig.json'), JSON.stringify(presetRegistry, null, 2));
			process.env.TYPEDAI_HOME = tempDir;
			process.env.PGHOST = 'localhost';
		});

		it('resolves product config with preset and auto-detected backend', () => {
			const productConfig: RepositoryVectorConfig = {
				preset: 'test-preset',
				includePatterns: ['src/**', 'lib/**'],
			};

			const resolved = resolveProductConfig(productConfig);
			expect(resolved.includePatterns).to.deep.equal(['src/**', 'lib/**']);
			expect(resolved.embedding?.provider).to.equal('vertex');
			expect(resolved.alloydb?.host).to.equal('localhost');
		});

		it('resolves product config with explicit backend', () => {
			process.env.GCLOUD_PROJECT = 'my-project';
			const productConfig: RepositoryVectorConfig = {
				preset: 'test-preset',
				includePatterns: ['src/**'],
				backend: 'discovery-engine',
			};

			const resolved = resolveProductConfig(productConfig);
			expect(resolved.googleCloud?.projectId).to.equal('my-project');
			expect(resolved.alloydb).to.be.undefined;
		});

		it('applies overrides to preset', () => {
			const productConfig: RepositoryVectorConfig = {
				preset: 'test-preset',
				includePatterns: ['src/**'],
				overrides: {
					chunking: { dualEmbedding: true, contextualChunking: true },
				},
			};

			const resolved = resolveProductConfig(productConfig);
			expect(resolved.chunking?.dualEmbedding).to.equal(true);
			expect(resolved.chunking?.contextualChunking).to.equal(true);
		});

		it('uses product config name if provided', () => {
			const productConfig: RepositoryVectorConfig = {
				name: 'my-custom-name',
				preset: 'test-preset',
				includePatterns: ['src/**'],
			};

			const resolved = resolveProductConfig(productConfig);
			expect(resolved.name).to.equal('my-custom-name');
		});
	});

	describe('loadVectorConfig from .typedai.json', () => {
		beforeEach(() => {
			// Set up test preset registry
			const presetRegistry: VectorStoreConfig[] = [
				{
					name: 'fast',
					embedding: { provider: 'vertex' },
					chunking: { dualEmbedding: false },
					search: { hybridSearch: true },
				},
				{
					name: 'quality',
					embedding: { provider: 'vertex' },
					chunking: { dualEmbedding: true, contextualChunking: true },
					search: { hybridSearch: true },
				},
			];
			fs.writeFileSync(path.join(tempDir, '.vectorconfig.json'), JSON.stringify(presetRegistry, null, 2));
			process.env.TYPEDAI_HOME = tempDir;
			process.env.PGHOST = 'localhost';
		});

		it('loads config from .typedai.json with single vector config', () => {
			const typedaiConfig = [
				{
					baseDir: './',
					primary: true,
					vector: {
						preset: 'fast',
						includePatterns: ['src/**'],
					},
				},
			];
			fs.writeFileSync(path.join(tempDir, '.typedai.json'), JSON.stringify(typedaiConfig, null, 2));

			const config = loadVectorConfig(tempDir);
			expect(config.chunking?.dualEmbedding).to.equal(false);
			expect(config.includePatterns).to.deep.equal(['src/**']);
		});

		it('loads config from .typedai.json with array of vector configs', () => {
			const typedaiConfig = [
				{
					baseDir: './',
					primary: true,
					vector: [
						{ name: 'main', preset: 'quality', includePatterns: ['src/**'], default: true },
						{ name: 'tests', preset: 'fast', includePatterns: ['tests/**'] },
					],
				},
			];
			fs.writeFileSync(path.join(tempDir, '.typedai.json'), JSON.stringify(typedaiConfig, null, 2));

			const config = loadVectorConfig(tempDir);
			expect(config.name).to.equal('main');
			expect(config.chunking?.dualEmbedding).to.equal(true);
		});

		it('loads named config from array', () => {
			const typedaiConfig = [
				{
					baseDir: './',
					primary: true,
					vector: [
						{ name: 'main', preset: 'quality', includePatterns: ['src/**'], default: true },
						{ name: 'tests', preset: 'fast', includePatterns: ['tests/**'] },
					],
				},
			];
			fs.writeFileSync(path.join(tempDir, '.typedai.json'), JSON.stringify(typedaiConfig, null, 2));

			const config = loadVectorConfig(tempDir, 'tests');
			expect(config.name).to.equal('tests');
			expect(config.chunking?.dualEmbedding).to.equal(false);
		});

		it('throws when .typedai.json is missing', () => {
			expect(() => loadVectorConfig(tempDir)).to.throw('No .typedai.json found');
		});

		it('throws when vector property is missing', () => {
			const typedaiConfig = [{ baseDir: './', primary: true }];
			fs.writeFileSync(path.join(tempDir, '.typedai.json'), JSON.stringify(typedaiConfig, null, 2));

			expect(() => loadVectorConfig(tempDir)).to.throw('No "vector" property found');
		});

		it('throws when preset is missing', () => {
			const typedaiConfig = [
				{
					baseDir: './',
					primary: true,
					vector: { includePatterns: ['src/**'] },
				},
			];
			fs.writeFileSync(path.join(tempDir, '.typedai.json'), JSON.stringify(typedaiConfig, null, 2));

			expect(() => loadVectorConfig(tempDir)).to.throw('Missing "preset"');
		});
	});

	describe('loadAllVectorConfigs', () => {
		beforeEach(() => {
			const presetRegistry: VectorStoreConfig[] = [
				{ name: 'fast', embedding: { provider: 'vertex' }, chunking: { dualEmbedding: false } },
				{ name: 'quality', embedding: { provider: 'vertex' }, chunking: { dualEmbedding: true } },
			];
			fs.writeFileSync(path.join(tempDir, '.vectorconfig.json'), JSON.stringify(presetRegistry, null, 2));
			process.env.TYPEDAI_HOME = tempDir;
			process.env.PGHOST = 'localhost';
		});

		it('loads all vector configs from array', () => {
			const typedaiConfig = [
				{
					baseDir: './',
					primary: true,
					vector: [
						{ name: 'main', preset: 'quality', includePatterns: ['src/**'] },
						{ name: 'tests', preset: 'fast', includePatterns: ['tests/**'] },
					],
				},
			];
			fs.writeFileSync(path.join(tempDir, '.typedai.json'), JSON.stringify(typedaiConfig, null, 2));

			const configs = loadAllVectorConfigs(tempDir);
			expect(configs).to.have.length(2);
			expect(configs[0]?.name).to.equal('main');
			expect(configs[1]?.name).to.equal('tests');
		});
	});

	describe('validateVectorConfig', () => {
		it('validates valid config with manual chunking', () => {
			const result = validateVectorConfig({
				name: 'test',
				embedding: { provider: 'vertex', model: 'gemini-embedding-001' },
				chunking: { contextualChunking: false, size: 2500, overlap: 300, strategy: 'ast' },
			});
			expect(result.valid).to.equal(true);
			expect(result.errors).to.have.length(0);
		});

		it('validates valid config with contextual chunking (no size/overlap/strategy needed)', () => {
			const result = validateVectorConfig({
				name: 'test',
				embedding: { provider: 'vertex' },
				chunking: { contextualChunking: true, dualEmbedding: true },
			});
			expect(result.valid).to.equal(true);
			expect(result.errors).to.have.length(0);
		});

		it('requires size when contextualChunking is false', () => {
			const result = validateVectorConfig({
				chunking: { contextualChunking: false, overlap: 300, strategy: 'ast' },
			});
			expect(result.valid).to.equal(false);
			expect(result.errors).to.include('chunking.size is required when contextualChunking is false/undefined');
		});

		it('requires overlap when contextualChunking is false', () => {
			const result = validateVectorConfig({
				chunking: { contextualChunking: false, size: 2500, strategy: 'ast' },
			});
			expect(result.valid).to.equal(false);
			expect(result.errors).to.include('chunking.overlap is required when contextualChunking is false/undefined');
		});

		it('requires strategy when contextualChunking is false', () => {
			const result = validateVectorConfig({
				chunking: { contextualChunking: false, size: 2500, overlap: 300 },
			});
			expect(result.valid).to.equal(false);
			expect(result.errors).to.include('chunking.strategy is required when contextualChunking is false/undefined');
		});

		it('requires size/overlap/strategy when contextualChunking is undefined', () => {
			const result = validateVectorConfig({
				chunking: { dualEmbedding: true },
			});
			expect(result.valid).to.equal(false);
			expect(result.errors).to.have.length(3);
		});

		it('rejects invalid name format', () => {
			const result = validateVectorConfig({ name: 'invalid name!' });
			expect(result.valid).to.equal(false);
			expect(result.errors[0]).to.include('alphanumeric');
		});

		it('rejects invalid embedding provider', () => {
			const result = validateVectorConfig({
				embedding: { provider: 'invalid' },
			});
			expect(result.valid).to.equal(false);
			expect(result.errors[0]).to.include('embedding.provider');
		});

		it('rejects invalid chunking size', () => {
			const result = validateVectorConfig({
				chunking: { contextualChunking: false, size: 50, overlap: 10, strategy: 'ast' },
			});
			expect(result.valid).to.equal(false);
			expect(result.errors).to.include('chunking.size must be at least 100 characters');
		});

		it('rejects overlap >= size', () => {
			const result = validateVectorConfig({
				chunking: { contextualChunking: false, size: 1000, overlap: 1000, strategy: 'ast' },
			});
			expect(result.valid).to.equal(false);
			expect(result.errors[0]).to.include('overlap must be less than');
		});

		it('validates reranking config', () => {
			const result = validateVectorConfig({
				search: {
					reranking: { provider: 'vertex', topK: 50 },
				},
			});
			expect(result.valid).to.equal(true);
		});

		it('rejects invalid reranking provider', () => {
			const result = validateVectorConfig({
				search: {
					reranking: { provider: 'invalid' as any },
				},
			});
			expect(result.valid).to.equal(false);
			expect(result.errors[0]).to.include('reranking.provider');
		});

		it('rejects reranking topK out of range', () => {
			const result = validateVectorConfig({
				search: {
					reranking: { provider: 'vertex', topK: 300 },
				},
			});
			expect(result.valid).to.equal(false);
			expect(result.errors[0]).to.include('topK must be between');
		});
	});

	describe('validateVectorConfigs', () => {
		it('allows single config with default: true', () => {
			const result = validateVectorConfigs([{ name: 'test', default: true }]);
			expect(result.valid).to.equal(true);
		});

		it('allows multiple configs with one default', () => {
			const result = validateVectorConfigs([{ name: 'first', default: true }, { name: 'second' }]);
			expect(result.valid).to.equal(true);
		});

		it('allows multiple configs with no default', () => {
			const result = validateVectorConfigs([{ name: 'first' }, { name: 'second' }]);
			expect(result.valid).to.equal(true);
		});

		it('rejects multiple configs with multiple defaults', () => {
			const result = validateVectorConfigs([
				{ name: 'first', default: true },
				{ name: 'second', default: true },
			]);
			expect(result.valid).to.equal(false);
			expect(result.errors).to.have.length(1);
			expect(result.errors[0]).to.include('Only one config can have "default: true"');
		});

		it('rejects duplicate names', () => {
			const result = validateVectorConfigs([{ name: 'same' }, { name: 'same' }]);
			expect(result.valid).to.equal(false);
			expect(result.errors[0]).to.include('Duplicate config name');
		});

		it('requires names when multiple configs exist', () => {
			const result = validateVectorConfigs([
				{ name: 'named' },
				{}, // unnamed
			]);
			expect(result.valid).to.equal(false);
			expect(result.errors[0]).to.include('must have a "name" property');
		});
	});
});
