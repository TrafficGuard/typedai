import * as crypto from 'node:crypto';
import type { Dirent, Stats } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import pino from 'pino';
import { ISynchronizer } from '../core/interfaces';

const logger = pino({ name: 'MerkleSynchronizer' });

interface MerkleDAGNode {
	id: string;
	hash: string;
	data: string;
	parents: string[];
	children: string[];
}

/**
 * Merkle DAG for efficient change detection
 */
class MerkleDAG {
	nodes: Map<string, MerkleDAGNode>;
	rootIds: string[];

	constructor() {
		this.nodes = new Map();
		this.rootIds = [];
	}

	private hash(data: string): string {
		return crypto.createHash('sha256').update(data).digest('hex');
	}

	addNode(data: string, parentId?: string): string {
		const nodeId = this.hash(data);
		const node: MerkleDAGNode = {
			id: nodeId,
			hash: nodeId,
			data,
			parents: [],
			children: [],
		};

		if (parentId) {
			const parentNode = this.nodes.get(parentId);
			if (parentNode) {
				node.parents.push(parentId);
				parentNode.children.push(nodeId);
				this.nodes.set(parentId, parentNode);
			}
		} else {
			this.rootIds.push(nodeId);
		}

		this.nodes.set(nodeId, node);
		return nodeId;
	}

	getAllNodes(): MerkleDAGNode[] {
		return Array.from(this.nodes.values());
	}

	serialize(): any {
		return {
			nodes: Array.from(this.nodes.entries()),
			rootIds: this.rootIds,
		};
	}

	static deserialize(data: any): MerkleDAG {
		const dag = new MerkleDAG();
		dag.nodes = new Map(data.nodes);
		dag.rootIds = data.rootIds;
		return dag;
	}

	static compare(
		dag1: MerkleDAG,
		dag2: MerkleDAG,
	): {
		added: string[];
		removed: string[];
		modified: string[];
	} {
		const nodes1 = new Map(Array.from(dag1.getAllNodes()).map((n) => [n.id, n]));
		const nodes2 = new Map(Array.from(dag2.getAllNodes()).map((n) => [n.id, n]));

		const added = Array.from(nodes2.keys()).filter((k) => !nodes1.has(k));
		const removed = Array.from(nodes1.keys()).filter((k) => !nodes2.has(k));

		const modified: string[] = [];
		for (const [id, node1] of Array.from(nodes1.entries())) {
			const node2 = nodes2.get(id);
			if (node2 && node1.data !== node2.data) {
				modified.push(id);
			}
		}

		return { added, removed, modified };
	}
}

/**
 * Merkle-based file synchronizer for incremental updates
 * Detects added, modified, and deleted files efficiently
 */
export class MerkleSynchronizer implements ISynchronizer {
	private fileHashes: Map<string, string>;
	private merkleDAG: MerkleDAG;
	private rootDir: string;
	private snapshotPath: string;
	private includePatterns: string[];

	constructor(includePatterns: string[] = []) {
		this.fileHashes = new Map();
		this.merkleDAG = new MerkleDAG();
		this.rootDir = '';
		this.snapshotPath = '';
		this.includePatterns = includePatterns;
	}

	async detectChanges(repoRoot: string): Promise<{
		added: string[];
		modified: string[];
		deleted: string[];
	}> {
		this.rootDir = repoRoot;
		this.snapshotPath = this.getSnapshotPath(repoRoot);

		logger.info({ repoRoot }, 'Detecting file changes using Merkle sync');

		// Load previous snapshot
		await this.loadSnapshot(repoRoot);

		// Generate current file hashes
		const newFileHashes = await this.generateFileHashes(this.rootDir);
		const newMerkleDAG = this.buildMerkleDAG(newFileHashes);

		// Compare states
		const changes = MerkleDAG.compare(this.merkleDAG, newMerkleDAG);

		if (changes.added.length > 0 || changes.removed.length > 0 || changes.modified.length > 0) {
			logger.debug('Merkle DAG has changed, comparing file states');
			const fileChanges = this.compareStates(this.fileHashes, newFileHashes);

			// Update state
			this.fileHashes = newFileHashes;
			this.merkleDAG = newMerkleDAG;

			logger.info(
				{
					added: fileChanges.added.length,
					modified: fileChanges.modified.length,
					deleted: fileChanges.removed.length,
				},
				'File changes detected',
			);

			return {
				added: fileChanges.added,
				modified: fileChanges.modified,
				deleted: fileChanges.removed,
			};
		}

		logger.info('No changes detected');
		return { added: [], modified: [], deleted: [] };
	}

	async saveSnapshot(repoRoot: string, files: string[]): Promise<void> {
		this.rootDir = repoRoot;
		this.snapshotPath = this.getSnapshotPath(repoRoot);

		logger.info({ repoRoot, fileCount: files.length }, 'Saving snapshot');

		// Regenerate file hashes and Merkle DAG
		this.fileHashes = await this.generateFileHashes(this.rootDir);
		this.merkleDAG = this.buildMerkleDAG(this.fileHashes);

		await this.persistSnapshot();
	}

	async loadSnapshot(repoRoot: string): Promise<string[] | null> {
		this.rootDir = repoRoot;
		this.snapshotPath = this.getSnapshotPath(repoRoot);

		try {
			const data = await fs.readFile(this.snapshotPath, 'utf-8');
			const obj = JSON.parse(data);

			this.fileHashes = new Map();
			for (const [key, value] of obj.fileHashes) {
				this.fileHashes.set(key, value);
			}

			if (obj.merkleDAG) {
				this.merkleDAG = MerkleDAG.deserialize(obj.merkleDAG);
			}

			logger.info({ snapshotPath: this.snapshotPath, fileCount: this.fileHashes.size }, 'Loaded snapshot');
			return Array.from(this.fileHashes.keys());
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				logger.info({ snapshotPath: this.snapshotPath }, 'Snapshot not found, will create new one');
				return null;
			}
			logger.error({ error }, 'Failed to load snapshot');
			throw error;
		}
	}

	/**
	 * Delete snapshot for a repository
	 */
	async deleteSnapshot(repoRoot: string): Promise<void> {
		const snapshotPath = this.getSnapshotPath(repoRoot);

		try {
			await fs.unlink(snapshotPath);
			logger.info({ snapshotPath }, 'Deleted snapshot');
		} catch (error: any) {
			if (error.code !== 'ENOENT') {
				logger.error({ error, snapshotPath }, 'Failed to delete snapshot');
				throw error;
			}
		}
	}

	private getSnapshotPath(codebasePath: string): string {
		const homeDir = os.homedir();
		const merkleDir = path.join(homeDir, '.typedai', 'vector-snapshots');

		const normalizedPath = path.resolve(codebasePath);
		const hash = crypto.createHash('md5').update(normalizedPath).digest('hex');

		return path.join(merkleDir, `${hash}.json`);
	}

	private async hashFile(filePath: string): Promise<string> {
		const stat = await fs.stat(filePath);
		if (stat.isDirectory()) {
			throw new Error(`Attempted to hash a directory: ${filePath}`);
		}
		const content = await fs.readFile(filePath, 'utf-8');
		return crypto.createHash('sha256').update(content).digest('hex');
	}

	private async generateFileHashes(dir: string): Promise<Map<string, string>> {
		const fileHashes = new Map<string, string>();

		let entries: Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch (error: any) {
			logger.warn({ dir, error: error.message }, 'Cannot read directory');
			return fileHashes;
		}

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			const relativePath = path.relative(this.rootDir, fullPath);

			// Check if should be included
			if (!this.shouldInclude(relativePath, entry.isDirectory())) {
				continue;
			}

			let stat: Stats;
			try {
				stat = await fs.stat(fullPath);
			} catch (error: any) {
				logger.warn({ fullPath, error: error.message }, 'Cannot stat path');
				continue;
			}

			if (stat.isDirectory()) {
				const subHashes = await this.generateFileHashes(fullPath);
				for (const [p, h] of Array.from(subHashes.entries())) {
					fileHashes.set(p, h);
				}
			} else if (stat.isFile()) {
				try {
					const hash = await this.hashFile(fullPath);
					fileHashes.set(relativePath, hash);
				} catch (error: any) {
					logger.warn({ fullPath, error: error.message }, 'Cannot hash file');
				}
			}
		}

		return fileHashes;
	}

	private shouldInclude(relativePath: string, isDirectory = false): boolean {
		// Always exclude hidden files and directories for safety
		const pathParts = relativePath.split(path.sep);
		if (pathParts.some((part) => part.startsWith('.'))) {
			return false;
		}

		// Exclude common build/dependency directories for safety
		const commonExcluded = ['node_modules', 'dist', 'build', '.git', '.next', 'coverage', '__pycache__'];
		if (pathParts.some((part) => commonExcluded.includes(part))) {
			return false;
		}

		// If no include patterns specified, include everything (that passed safety checks)
		if (this.includePatterns.length === 0) {
			return true;
		}

		const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

		if (!normalizedPath) {
			return false;
		}

		// Check against include patterns - must match at least one pattern
		for (const pattern of this.includePatterns) {
			if (this.matchPattern(normalizedPath, pattern, isDirectory)) {
				return true;
			}
		}

		return false;
	}

	private matchPattern(filePath: string, pattern: string, isDirectory = false): boolean {
		const cleanPath = filePath.replace(/^\/+|\/+$/g, '');
		const cleanPattern = pattern.replace(/^\/+|\/+$/g, '');

		if (!cleanPath || !cleanPattern) {
			return false;
		}

		// Handle directory patterns (ending with /)
		if (pattern.endsWith('/')) {
			if (!isDirectory) return false;
			const dirPattern = cleanPattern.slice(0, -1);
			return this.simpleGlobMatch(cleanPath, dirPattern) || cleanPath.split('/').some((part) => this.simpleGlobMatch(part, dirPattern));
		}

		// Handle path patterns (containing /)
		if (cleanPattern.includes('/')) {
			return this.simpleGlobMatch(cleanPath, cleanPattern);
		}

		// Handle filename patterns
		const fileName = path.basename(cleanPath);
		return this.simpleGlobMatch(fileName, cleanPattern);
	}

	private simpleGlobMatch(text: string, pattern: string): boolean {
		if (!text || !pattern) return false;

		const regexPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');

		const regex = new RegExp(`^${regexPattern}$`);
		return regex.test(text);
	}

	private buildMerkleDAG(fileHashes: Map<string, string>): MerkleDAG {
		const dag = new MerkleDAG();
		const keys = Array.from(fileHashes.keys());
		const sortedPaths = keys.slice().sort();

		// Create root node
		let valuesString = '';
		keys.forEach((key) => {
			valuesString += fileHashes.get(key);
		});
		const rootNodeData = `root:${valuesString}`;
		const rootNodeId = dag.addNode(rootNodeData);

		// Add each file as child of root
		for (const filePath of sortedPaths) {
			const fileData = `${filePath}:${fileHashes.get(filePath)}`;
			dag.addNode(fileData, rootNodeId);
		}

		return dag;
	}

	private compareStates(
		oldHashes: Map<string, string>,
		newHashes: Map<string, string>,
	): {
		added: string[];
		removed: string[];
		modified: string[];
	} {
		const added: string[] = [];
		const removed: string[] = [];
		const modified: string[] = [];

		// Find added and modified
		for (const [file, hash] of Array.from(newHashes.entries())) {
			if (!oldHashes.has(file)) {
				added.push(file);
			} else if (oldHashes.get(file) !== hash) {
				modified.push(file);
			}
		}

		// Find removed
		for (const file of Array.from(oldHashes.keys())) {
			if (!newHashes.has(file)) {
				removed.push(file);
			}
		}

		return { added, removed, modified };
	}

	private async persistSnapshot(): Promise<void> {
		const merkleDir = path.dirname(this.snapshotPath);
		await fs.mkdir(merkleDir, { recursive: true });

		const fileHashesArray: [string, string][] = [];
		const keys = Array.from(this.fileHashes.keys());
		keys.forEach((key) => {
			fileHashesArray.push([key, this.fileHashes.get(key)!]);
		});

		const data = JSON.stringify({
			fileHashes: fileHashesArray,
			merkleDAG: this.merkleDAG.serialize(),
		});

		await fs.writeFile(this.snapshotPath, data, 'utf-8');
		logger.debug({ snapshotPath: this.snapshotPath }, 'Saved snapshot');
	}
}
