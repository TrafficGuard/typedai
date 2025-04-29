import crypto from 'node:crypto';
import type { Pool } from 'pg';

import type { CacheScope, FunctionCacheService } from './functionCacheService';

// AI generated. Not yet tested --------------------------
// TypeORM doesn't work with TypeScript 5.0+ with the new decorators

const CREATE_FUNCTION_CACHE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS function_cache (
    id SERIAL PRIMARY KEY,
    hash VARCHAR(64) UNIQUE NOT NULL,
    class_name TEXT NOT NULL,
    method TEXT NOT NULL,
    params JSON NOT NULL,
    result JSON,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
`;

export class PgFunctionCacheService implements FunctionCacheService {
	private pool: Pool;

	constructor(pool: Pool) {
		this.pool = pool;
	}

	private static generateHash(className: string, method: string, params: any[]): string {
		const hash = crypto.createHash('sha256');
		hash.update(className);
		hash.update(method);
		hash.update(JSON.stringify(params));
		return hash.digest('hex');
	}

	async getValue(scope: CacheScope, className: string, method: string, params: any[]): Promise<any> {
		const hash = PgFunctionCacheService.generateHash(className, method, params);
		const query = 'SELECT result FROM function_cache WHERE hash = $1';
		const { rows } = await this.pool.query(query, [hash]);
		return rows.length > 0 ? rows[0].result : undefined;
	}

	async setValue(scope: CacheScope, className: string, method: string, params: any[], value: any): Promise<void> {
		const hash = PgFunctionCacheService.generateHash(className, method, params);
		const query = `
            INSERT INTO function_cache (hash, class_name, method, params, result)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (hash) DO UPDATE SET result = EXCLUDED.result;
        `;
		await this.pool.query(query, [hash, className, method, JSON.stringify(params), JSON.stringify(value)]);
	}

	clearAgentCache(agentId: string): Promise<number> {
		return Promise.resolve(0);
	}

	clearUserCache(userId: string): Promise<number> {
		return Promise.resolve(0);
	}
}

export const createFunctionCacheTableSql = CREATE_FUNCTION_CACHE_TABLE_SQL;
