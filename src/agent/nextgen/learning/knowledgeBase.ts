/**
 * Knowledge Base for NextGen Agent
 *
 * Stores and retrieves learnings as markdown files with YAML frontmatter.
 * Provides semantic search for retrieving relevant learnings.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '#o11y/logger';
import type { Learning, LearningSource, LearningType } from '../core/types';

/**
 * Configuration for the knowledge base
 */
export interface KnowledgeBaseConfig {
	/** Base directory for storing learnings (default: .typedai/learnings) */
	basePath?: string;
	/** Maximum learnings to return from search (default: 10) */
	maxResults?: number;
}

/**
 * Query options for retrieving learnings
 */
export interface RetrievalQuery {
	/** Text to match against learning content */
	text?: string;
	/** Filter by learning type */
	types?: LearningType[];
	/** Filter by category (supports wildcards, e.g., 'typescript/*') */
	categories?: string[];
	/** Filter by tags (any match) */
	tags?: string[];
	/** Minimum confidence threshold */
	minConfidence?: number;
	/** Maximum results to return */
	limit?: number;
}

/**
 * Manages storage and retrieval of learnings
 */
export class KnowledgeBase {
	private config: Required<KnowledgeBaseConfig>;
	private cache: Map<string, Learning> = new Map();
	private initialized = false;

	constructor(config: KnowledgeBaseConfig = {}) {
		this.config = {
			basePath: config.basePath ?? '.typedai/learnings',
			maxResults: config.maxResults ?? 10,
		};
	}

	/**
	 * Initializes the knowledge base, creating directories if needed
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		try {
			await fs.mkdir(this.config.basePath, { recursive: true });
			await this.loadCache();
			this.initialized = true;
			logger.debug(`KnowledgeBase initialized at ${this.config.basePath}`);
		} catch (error) {
			logger.error(error, 'Failed to initialize KnowledgeBase');
			throw error;
		}
	}

	/**
	 * Saves a learning to the knowledge base
	 */
	async save(learning: Learning): Promise<string> {
		await this.ensureInitialized();

		const filePath = this.getLearningFilePath(learning);
		const content = this.formatLearningAsMarkdown(learning);

		// Ensure category directory exists
		const dir = path.dirname(filePath);
		await fs.mkdir(dir, { recursive: true });

		await fs.writeFile(filePath, content, 'utf-8');
		this.cache.set(learning.id, learning);

		logger.debug(`Saved learning ${learning.id} to ${filePath}`);
		return filePath;
	}

	/**
	 * Saves multiple learnings
	 */
	async saveAll(learnings: Learning[]): Promise<string[]> {
		const paths: string[] = [];
		for (const learning of learnings) {
			const p = await this.save(learning);
			paths.push(p);
		}
		return paths;
	}

	/**
	 * Retrieves learnings matching the query
	 */
	async retrieve(query: RetrievalQuery): Promise<Learning[]> {
		await this.ensureInitialized();

		const limit = query.limit ?? this.config.maxResults;
		const results: Learning[] = [];

		for (const learning of this.cache.values()) {
			if (this.matchesQuery(learning, query)) {
				results.push(learning);
			}
		}

		// Sort by confidence (highest first) and recency
		results.sort((a, b) => {
			const confidenceDiff = b.confidence - a.confidence;
			if (Math.abs(confidenceDiff) > 0.1) return confidenceDiff;
			return b.createdAt.getTime() - a.createdAt.getTime();
		});

		return results.slice(0, limit);
	}

	/**
	 * Retrieves learnings relevant to a task description
	 */
	async retrieveRelevant(taskDescription: string, context?: { technologies?: string[]; projectPath?: string }): Promise<Learning[]> {
		await this.ensureInitialized();

		// Extract potential categories from task and context
		const categories = this.inferCategories(taskDescription, context);
		const keywords = this.extractKeywords(taskDescription);

		// Try category-based search first
		if (categories.length > 0) {
			const categoryResults = await this.retrieve({
				categories,
				minConfidence: 0.7,
			});
			if (categoryResults.length > 0) {
				return categoryResults;
			}
		}

		// Fall back to keyword-based search
		if (keywords.length > 0) {
			const keywordResults = await this.retrieve({
				tags: keywords,
				minConfidence: 0.7,
			});
			if (keywordResults.length > 0) {
				return keywordResults;
			}
		}

		// Finally try text search
		return this.retrieve({
			text: taskDescription,
			minConfidence: 0.7,
		});
	}

	/**
	 * Gets a learning by ID
	 */
	async get(id: string): Promise<Learning | null> {
		await this.ensureInitialized();
		return this.cache.get(id) ?? null;
	}

	/**
	 * Deletes a learning by ID
	 */
	async delete(id: string): Promise<boolean> {
		await this.ensureInitialized();

		const learning = this.cache.get(id);
		if (!learning) return false;

		const filePath = this.getLearningFilePath(learning);
		try {
			await fs.unlink(filePath);
			this.cache.delete(id);
			logger.debug(`Deleted learning ${id}`);
			return true;
		} catch (error) {
			logger.warn(error, `Failed to delete learning ${id}`);
			return false;
		}
	}

	/**
	 * Gets all learnings in a category
	 */
	async getByCategory(category: string): Promise<Learning[]> {
		await this.ensureInitialized();

		const results: Learning[] = [];
		for (const learning of this.cache.values()) {
			if (learning.category === category || learning.category.startsWith(`${category}/`)) {
				results.push(learning);
			}
		}
		return results;
	}

	/**
	 * Gets statistics about the knowledge base
	 */
	async getStats(): Promise<{
		totalLearnings: number;
		byType: Record<LearningType, number>;
		byCategory: Record<string, number>;
		avgConfidence: number;
	}> {
		await this.ensureInitialized();

		const byType: Record<LearningType, number> = {
			pattern: 0,
			pitfall: 0,
			preference: 0,
			context: 0,
		};
		const byCategory: Record<string, number> = {};
		let totalConfidence = 0;

		for (const learning of this.cache.values()) {
			byType[learning.type]++;

			const topCategory = learning.category.split('/')[0];
			byCategory[topCategory] = (byCategory[topCategory] ?? 0) + 1;

			totalConfidence += learning.confidence;
		}

		return {
			totalLearnings: this.cache.size,
			byType,
			byCategory,
			avgConfidence: this.cache.size > 0 ? totalConfidence / this.cache.size : 0,
		};
	}

	/**
	 * Clears all learnings (use with caution)
	 */
	async clear(): Promise<void> {
		await this.ensureInitialized();

		try {
			await fs.rm(this.config.basePath, { recursive: true, force: true });
			await fs.mkdir(this.config.basePath, { recursive: true });
			this.cache.clear();
			logger.info('KnowledgeBase cleared');
		} catch (error) {
			logger.error(error, 'Failed to clear KnowledgeBase');
			throw error;
		}
	}

	// Private methods

	private async ensureInitialized(): Promise<void> {
		if (!this.initialized) {
			await this.initialize();
		}
	}

	private async loadCache(): Promise<void> {
		try {
			await this.loadDirectory(this.config.basePath);
		} catch (error) {
			// Directory might not exist yet
			logger.debug('No existing learnings to load');
		}
	}

	private async loadDirectory(dirPath: string): Promise<void> {
		try {
			const entries = await fs.readdir(dirPath, { withFileTypes: true });

			for (const entry of entries) {
				const fullPath = path.join(dirPath, entry.name);
				if (entry.isDirectory()) {
					await this.loadDirectory(fullPath);
				} else if (entry.name.endsWith('.md')) {
					await this.loadLearningFile(fullPath);
				}
			}
		} catch (error) {
			// Ignore missing directories
		}
	}

	private async loadLearningFile(filePath: string): Promise<void> {
		try {
			const content = await fs.readFile(filePath, 'utf-8');
			const learning = this.parseLearningMarkdown(content);
			if (learning) {
				this.cache.set(learning.id, learning);
			}
		} catch (error) {
			logger.warn(error, `Failed to load learning from ${filePath}`);
		}
	}

	private getLearningFilePath(learning: Learning): string {
		// Organize by category with sanitized path
		const categoryPath = learning.category.replace(/[^a-zA-Z0-9/]/g, '-').toLowerCase();
		const filename = `${learning.id}.md`;
		return path.join(this.config.basePath, categoryPath, filename);
	}

	private formatLearningAsMarkdown(learning: Learning): string {
		const frontmatter = {
			id: learning.id,
			type: learning.type,
			category: learning.category,
			confidence: learning.confidence,
			tags: learning.tags,
			source: learning.source,
			created: learning.createdAt.toISOString(),
		};

		return `---
${Object.entries(frontmatter)
	.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
	.join('\n')}
---

# ${this.formatTitle(learning)}

${learning.content}
`;
	}

	private formatTitle(learning: Learning): string {
		const typePrefix = {
			pattern: '✓ Pattern',
			pitfall: '⚠ Pitfall',
			preference: '📌 Preference',
			context: 'ℹ Context',
		};
		return `${typePrefix[learning.type]}: ${learning.category}`;
	}

	private parseLearningMarkdown(content: string): Learning | null {
		const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
		if (!frontmatterMatch) return null;

		try {
			const frontmatter = this.parseFrontmatter(frontmatterMatch[1]);
			const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n#[^\n]*\n\n([\s\S]*)$/);
			const body = bodyMatch ? bodyMatch[1].trim() : '';

			return {
				id: frontmatter.id as string,
				type: frontmatter.type as LearningType,
				category: frontmatter.category as string,
				confidence: Number.parseFloat(frontmatter.confidence as string) || 0.7,
				tags: this.parseArrayField(frontmatter.tags as string | string[] | undefined),
				content: body,
				source: typeof frontmatter.source === 'string' ? JSON.parse(frontmatter.source) : (frontmatter.source as LearningSource),
				createdAt: new Date(frontmatter.created as string | number),
			};
		} catch (error) {
			logger.warn(error, 'Failed to parse learning markdown');
			return null;
		}
	}

	private parseFrontmatter(text: string): Record<string, string | object> {
		const result: Record<string, string | object> = {};
		const lines = text.split('\n');

		for (const line of lines) {
			const colonIdx = line.indexOf(':');
			if (colonIdx === -1) continue;

			const key = line.slice(0, colonIdx).trim();
			const value = line.slice(colonIdx + 1).trim();

			// Try to parse JSON values
			if (value.startsWith('{') || value.startsWith('[')) {
				try {
					result[key] = JSON.parse(value);
					continue;
				} catch {
					// Keep as string
				}
			}

			result[key] = value;
		}

		return result;
	}

	private parseArrayField(value: string | string[] | undefined): string[] {
		if (!value) return [];
		if (Array.isArray(value)) return value;
		if (value.startsWith('[')) {
			try {
				return JSON.parse(value);
			} catch {
				return [];
			}
		}
		return value.split(',').map((s) => s.trim());
	}

	private matchesQuery(learning: Learning, query: RetrievalQuery): boolean {
		// Check type filter
		if (query.types && query.types.length > 0 && !query.types.includes(learning.type)) {
			return false;
		}

		// Check category filter
		if (query.categories && query.categories.length > 0) {
			const matches = query.categories.some((cat) => {
				if (cat.endsWith('/*')) {
					return learning.category.startsWith(cat.slice(0, -2));
				}
				return learning.category === cat || learning.category.startsWith(`${cat}/`);
			});
			if (!matches) return false;
		}

		// Check tag filter
		if (query.tags && query.tags.length > 0) {
			const matches = query.tags.some((tag) => learning.tags.includes(tag.toLowerCase()));
			if (!matches) return false;
		}

		// Check confidence threshold
		if (query.minConfidence !== undefined && learning.confidence < query.minConfidence) {
			return false;
		}

		// Check text match (simple substring matching)
		if (query.text) {
			const searchText = query.text.toLowerCase();
			const learningText = `${learning.content} ${learning.category} ${learning.tags.join(' ')}`.toLowerCase();
			if (!learningText.includes(searchText) && !this.hasKeywordOverlap(searchText, learningText)) {
				return false;
			}
		}

		return true;
	}

	private hasKeywordOverlap(query: string, text: string): boolean {
		const queryWords = query.split(/\s+/).filter((w) => w.length > 3);
		return queryWords.some((word) => text.includes(word));
	}

	private inferCategories(taskDescription: string, context?: { technologies?: string[] }): string[] {
		const categories: string[] = [];
		const text = taskDescription.toLowerCase();

		// Technology-based categories
		if (context?.technologies) {
			categories.push(...context.technologies.map((t) => t.toLowerCase()));
		}

		// Infer from task description
		const techPatterns: Array<[RegExp, string]> = [
			[/typescript|\.ts\b/i, 'typescript'],
			[/javascript|\.js\b/i, 'javascript'],
			[/react|jsx|tsx/i, 'react'],
			[/node|npm|pnpm/i, 'nodejs'],
			[/python|\.py\b/i, 'python'],
			[/test|spec|jest|vitest|mocha/i, 'testing'],
			[/api|endpoint|rest|graphql/i, 'api'],
			[/database|sql|mongo|postgres/i, 'database'],
			[/auth|authentication|login/i, 'authentication'],
		];

		for (const [pattern, category] of techPatterns) {
			if (pattern.test(text) && !categories.includes(category)) {
				categories.push(category);
			}
		}

		return categories;
	}

	private extractKeywords(text: string): string[] {
		// Simple keyword extraction - remove common words
		const stopWords = new Set([
			'the',
			'a',
			'an',
			'is',
			'are',
			'was',
			'were',
			'be',
			'been',
			'being',
			'have',
			'has',
			'had',
			'do',
			'does',
			'did',
			'will',
			'would',
			'could',
			'should',
			'may',
			'might',
			'must',
			'shall',
			'can',
			'need',
			'to',
			'of',
			'in',
			'for',
			'on',
			'with',
			'at',
			'by',
			'from',
			'as',
			'into',
			'through',
			'during',
			'before',
			'after',
			'above',
			'below',
			'between',
			'under',
			'again',
			'further',
			'then',
			'once',
			'here',
			'there',
			'when',
			'where',
			'why',
			'how',
			'all',
			'each',
			'every',
			'both',
			'few',
			'more',
			'most',
			'other',
			'some',
			'such',
			'no',
			'nor',
			'not',
			'only',
			'own',
			'same',
			'so',
			'than',
			'too',
			'very',
			'just',
			'and',
			'but',
			'if',
			'or',
			'because',
			'while',
			'although',
			'this',
			'that',
			'these',
			'those',
			'what',
			'which',
			'who',
			'whom',
		]);

		return text
			.toLowerCase()
			.split(/\s+/)
			.filter((word) => word.length > 3 && !stopWords.has(word))
			.slice(0, 10);
	}

	/**
	 * Gets the base path of the knowledge base
	 */
	getBasePath(): string {
		return this.config.basePath;
	}
}
