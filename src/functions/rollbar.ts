import axios, { type AxiosInstance } from 'axios';
import { getSecretEnvVar } from '#config/secretConfig';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { escapeXml, formatXmlContent } from '#utils/xml-utils';

export interface RollbarConfig {
	accessToken: string;
}

interface RollbarItem {
	id: number;
	counter: number;
	environment: string;
	framework: string;
	title: string;
	level: string;
	status: string;
	first_occurrence_timestamp: number;
	last_occurrence_timestamp: number;
	total_occurrences: number;
	unique_occurrences: number;
}

interface RollbarOccurrence {
	id: string;
	timestamp: number;
	version: string;
	data: {
		environment: string;
		level: string;
		body: {
			trace?: {
				frames: Array<{
					filename: string;
					lineno: number;
					colno?: number;
					method?: string;
					code?: string;
					context?: {
						pre?: string[];
						post?: string[];
					};
				}>;
				exception: {
					class: string;
					message: string;
					description?: string;
				};
			};
			trace_chain?: Array<{
				frames: Array<{
					filename: string;
					lineno: number;
					colno?: number;
					method?: string;
					code?: string;
				}>;
				exception: {
					class: string;
					message: string;
				};
			}>;
			message?: {
				body: string;
			};
		};
		request?: {
			url?: string;
			method?: string;
			user_ip?: string;
		};
		server?: {
			host?: string;
			root?: string;
		};
		custom?: Record<string, unknown>;
	};
}

@funcClass(__filename)
export class Rollbar {
	instance: AxiosInstance | undefined;

	private axios(): AxiosInstance {
		if (!this.instance) {
			const accessToken = getSecretEnvVar('ROLLBAR_ACCESS_TOKEN');

			if (!accessToken) {
				throw new Error('Rollbar accessToken must be provided via ROLLBAR_ACCESS_TOKEN environment variable');
			}

			this.instance = axios.create({
				baseURL: 'https://api.rollbar.com/api/1',
				headers: {
					'X-Rollbar-Access-Token': accessToken,
					'Content-Type': 'application/json',
				},
			});
		}
		return this.instance;
	}

	/**
	 * Parses a Rollbar URL to extract the item ID.
	 * Supports URLs like: https://app.rollbar.com/a/trafficguard/fix/item/waf/3600
	 * @param url - The Rollbar URL
	 * @returns The item ID
	 */
	private parseRollbarUrl(url: string): { itemId: string; project: string } {
		// URL format: https://app.rollbar.com/a/{account}/fix/item/{project}/{item_id}
		// or: https://app.rollbar.com/a/{account}/items/{project}/{item_id}
		const patterns = [
			/app\.rollbar\.com\/a\/[^/]+\/fix\/item\/([^/]+)\/(\d+)/,
			/app\.rollbar\.com\/a\/[^/]+\/items\/([^/]+)\/(\d+)/,
			/app\.rollbar\.com\/a\/[^/]+\/[^/]+\/item\/([^/]+)\/(\d+)/,
		];

		for (const pattern of patterns) {
			const match = url.match(pattern);
			if (match) {
				return { project: match[1], itemId: match[2] };
			}
		}

		throw new Error(`Unable to parse Rollbar URL: ${url}. Expected format: https://app.rollbar.com/a/{account}/fix/item/{project}/{item_id}`);
	}

	/**
	 * Gets error details from Rollbar given a Rollbar item URL.
	 * Returns item metadata, recent occurrences, and stack traces.
	 * @param {string} rollbarUrl - The Rollbar item URL (e.g., https://app.rollbar.com/a/{account}/fix/item/{project}/{item_id})
	 * @returns {Promise<string>} The error details formatted as XML
	 */
	@func()
	async getErrorDetails(rollbarUrl: string): Promise<string> {
		if (!rollbarUrl) throw new Error('rollbarUrl is required');

		const { itemId } = this.parseRollbarUrl(rollbarUrl);

		try {
			// Fetch item details and recent occurrences in parallel
			const [itemResponse, occurrencesResponse] = await Promise.all([
				this.axios().get(`/item/${itemId}`),
				this.axios().get(`/item/${itemId}/instances`, { params: { page: 1 } }),
			]);

			const item: RollbarItem = itemResponse.data.result;
			const occurrences: RollbarOccurrence[] = occurrencesResponse.data.result?.instances || [];

			return this.formatItemAsXml(item, occurrences, rollbarUrl);
		} catch (error) {
			logger.error(error, `Error fetching Rollbar item ${itemId}`);
			throw error;
		}
	}

	/**
	 * Gets a specific occurrence from Rollbar by its instance ID.
	 * @param {string} instanceId - The Rollbar occurrence/instance ID
	 * @returns {Promise<string>} The occurrence details formatted as XML
	 */
	@func()
	async getOccurrenceDetails(instanceId: string): Promise<string> {
		if (!instanceId) throw new Error('instanceId is required');

		try {
			const response = await this.axios().get(`/instance/${instanceId}`);
			const occurrence: RollbarOccurrence = response.data.result;

			return this.formatOccurrenceAsXml(occurrence);
		} catch (error) {
			logger.error(error, `Error fetching Rollbar occurrence ${instanceId}`);
			throw error;
		}
	}

	private formatItemAsXml(item: RollbarItem, occurrences: RollbarOccurrence[], url: string): string {
		let xml = `<rollbar-item id="${item.id}" counter="${item.counter}" url="${escapeXml(url)}">\n`;
		xml += `  <title>${formatXmlContent(item.title)}</title>\n`;
		xml += `  <level>${escapeXml(item.level)}</level>\n`;
		xml += `  <status>${escapeXml(item.status)}</status>\n`;
		xml += `  <environment>${escapeXml(item.environment)}</environment>\n`;
		xml += `  <framework>${escapeXml(item.framework || 'unknown')}</framework>\n`;
		xml += `  <total_occurrences>${item.total_occurrences}</total_occurrences>\n`;
		xml += `  <unique_occurrences>${item.unique_occurrences}</unique_occurrences>\n`;
		xml += `  <first_occurrence>${new Date(item.first_occurrence_timestamp * 1000).toISOString()}</first_occurrence>\n`;
		xml += `  <last_occurrence>${new Date(item.last_occurrence_timestamp * 1000).toISOString()}</last_occurrence>\n`;

		if (occurrences.length > 0) {
			xml += '  <recent_occurrences>\n';
			// Limit to 5 most recent occurrences to keep context manageable
			for (const occurrence of occurrences.slice(0, 5)) {
				xml += this.formatOccurrenceAsXmlElement(occurrence, '    ');
			}
			xml += '  </recent_occurrences>\n';
		} else {
			xml += '  <recent_occurrences />\n';
		}

		xml += '</rollbar-item>';
		return xml;
	}

	private formatOccurrenceAsXml(occurrence: RollbarOccurrence): string {
		let xml = '<rollbar-occurrence>\n';
		xml += this.formatOccurrenceAsXmlElement(occurrence, '  ');
		xml += '</rollbar-occurrence>';
		return xml;
	}

	private formatOccurrenceAsXmlElement(occurrence: RollbarOccurrence, indent: string): string {
		const data = occurrence.data;
		let xml = `${indent}<occurrence id="${escapeXml(occurrence.id)}" timestamp="${new Date(occurrence.timestamp * 1000).toISOString()}">\n`;

		xml += `${indent}  <environment>${escapeXml(data.environment || 'unknown')}</environment>\n`;
		xml += `${indent}  <level>${escapeXml(data.level || 'error')}</level>\n`;

		if (occurrence.version) {
			xml += `${indent}  <version>${escapeXml(occurrence.version)}</version>\n`;
		}

		// Handle trace (single exception)
		if (data.body.trace) {
			xml += this.formatTraceAsXml(data.body.trace, `${indent}  `);
		}

		// Handle trace_chain (chained exceptions)
		if (data.body.trace_chain && data.body.trace_chain.length > 0) {
			xml += `${indent}  <trace_chain>\n`;
			for (const trace of data.body.trace_chain) {
				xml += this.formatTraceAsXml(trace, `${indent}    `);
			}
			xml += `${indent}  </trace_chain>\n`;
		}

		// Handle message-type errors
		if (data.body.message) {
			xml += `${indent}  <message>${formatXmlContent(data.body.message.body)}</message>\n`;
		}

		// Request info
		if (data.request) {
			xml += `${indent}  <request>\n`;
			if (data.request.method) xml += `${indent}    <method>${escapeXml(data.request.method)}</method>\n`;
			if (data.request.url) xml += `${indent}    <url>${escapeXml(data.request.url)}</url>\n`;
			if (data.request.user_ip) xml += `${indent}    <user_ip>${escapeXml(data.request.user_ip)}</user_ip>\n`;
			xml += `${indent}  </request>\n`;
		}

		// Server info
		if (data.server) {
			xml += `${indent}  <server>\n`;
			if (data.server.host) xml += `${indent}    <host>${escapeXml(data.server.host)}</host>\n`;
			if (data.server.root) xml += `${indent}    <root>${escapeXml(data.server.root)}</root>\n`;
			xml += `${indent}  </server>\n`;
		}

		xml += `${indent}</occurrence>\n`;
		return xml;
	}

	private formatTraceAsXml(trace: NonNullable<RollbarOccurrence['data']['body']['trace']>, indent: string): string {
		let xml = `${indent}<trace>\n`;

		// Exception info
		xml += `${indent}  <exception class="${escapeXml(trace.exception.class)}">\n`;
		xml += `${indent}    <message>${formatXmlContent(trace.exception.message)}</message>\n`;
		if (trace.exception.description) {
			xml += `${indent}    <description>${formatXmlContent(trace.exception.description)}</description>\n`;
		}
		xml += `${indent}  </exception>\n`;

		// Stack frames (limit to 20 to keep context manageable)
		if (trace.frames && trace.frames.length > 0) {
			xml += `${indent}  <stack_frames>\n`;
			for (const frame of trace.frames.slice(0, 20)) {
				xml += `${indent}    <frame`;
				xml += ` filename="${escapeXml(frame.filename)}"`;
				xml += ` line="${frame.lineno}"`;
				if (frame.colno) xml += ` col="${frame.colno}"`;
				if (frame.method) xml += ` method="${escapeXml(frame.method)}"`;
				xml += '>\n';

				if (frame.code) {
					xml += `${indent}      <code>${formatXmlContent(frame.code)}</code>\n`;
				}
				if (frame.context?.pre?.length) {
					xml += `${indent}      <context_before>${formatXmlContent(frame.context.pre.join('\n'))}</context_before>\n`;
				}
				if (frame.context?.post?.length) {
					xml += `${indent}      <context_after>${formatXmlContent(frame.context.post.join('\n'))}</context_after>\n`;
				}

				xml += `${indent}    </frame>\n`;
			}
			if (trace.frames.length > 20) {
				xml += `${indent}    <!-- ${trace.frames.length - 20} more frames omitted -->\n`;
			}
			xml += `${indent}  </stack_frames>\n`;
		}

		xml += `${indent}</trace>\n`;
		return xml;
	}
}
