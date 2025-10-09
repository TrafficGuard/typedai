import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import axios, { type AxiosInstance } from 'axios';
import { getSecretEnvVar } from 'src/config/secretConfig';
import { agentStorageDir } from '#app/appDirs';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';
import { functionConfig } from '#user/userContext';
import { envVar } from '#utils/env-var';
import { escapeXml, formatXmlContent } from '#utils/xml-utils';
import { Jira, JiraConfig } from './jira';
const TurndownService = require('turndown');
const turndownService = new TurndownService();

interface ConfluencePage {
	id: string;
	title: string;
	// add other fields you need
}

interface ConfluenceResponse {
	results: ConfluencePage[];
	size: number;
	limit: number;
	start: number;
	_links: {
		next?: string;
	};
}

@funcClass(__filename)
export class Confluence {
	instance: AxiosInstance | undefined;

	private email(): string {
		const config: JiraConfig = functionConfig(Jira) as JiraConfig;
		return config.email || process.env.JIRA_EMAIL || envVar('SINGLE_USER_EMAIL');
	}

	private axios(): AxiosInstance {
		if (!this.instance) {
			const config: JiraConfig = functionConfig(Jira) as JiraConfig;
			const baseUrl = config.baseUrl || envVar('JIRA_BASE_URL');
			const email = this.email();
			const apiToken = config.token || getSecretEnvVar('JIRA_API_TOKEN');

			if (!baseUrl) throw new Error('Confluence baseUrl must be provided from the user profile or JIRA_BASE_URL environment variable');
			if (!apiToken) throw new Error('Confluence apiToken must be provided from the user profile or JIRA_API_TOKEN environment variable');
			if (!email) throw new Error('Confluence email must be provided from the user profile or CONFLUENCE_EMAIL environment variable (or SINGLE_USER_EMAIL)');

			this.instance = axios.create({
				baseURL: baseUrl,
				headers: {
					Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`,
					'Content-Type': 'application/json',
				},
			});
		}
		return this.instance;
	}

	// https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-search/#api-wiki-rest-api-search-get
	/**
	 * Searches Confluence pages
	 * @param {string} searchString - the string to search for
	 * @returns {Promise<Array<{id: string, title: string, type: string, body: string, bodyTokens: number}>>}
	 */
	@func()
	async search(searchString: string): Promise<Array<{ id: string; title: string; body: string; bodyTokens: number }>> {
		if (!searchString) throw new Error('searchString is required');
		// title ~ "release" OR text ~ "release"  (escape " in searchString)
		searchString = searchString.replaceAll('"', '\\"');
		const cql = `title ~ "${searchString}" OR text ~ "${searchString}"`;

		try {
			const response = await this.axios().get('/wiki/rest/api/content/search', {
				params: { cql, expand: 'type,title,body.export_view' },
			});

			const results = response.data.results.map((page: any) => ({
				id: page.id,
				title: page.title,
				type: page.type,
				body: turndownService.turndown(page.body.export_view.value),
				bodyTokens: null,
			}));
			const tokenPromises = results.map(async (page: any) => {
				page.bodyTokens = await countTokens(page.body);
			});
			await Promise.all(tokenPromises);

			return results;
		} catch (error) {
			logger.error(error, `Error searching Confluence: ${cql}`);
			throw error;
		}
	}

	/**
	 * Fetches the full content and attachments of a Confluence page (as XML).
	 * @param {string} pageId - The Confluence page ID.
	 * @returns {Promise<string>} The page content as XML.
	 */
	@func()
	async getPageContents(pageId: string): Promise<string> {
		if (!pageId) throw new Error('pageId is required');

		try {
			// Fetch page content (with body)
			const pageResp = await this.axios().get(`/wiki/rest/api/content/${pageId}`, {
				params: { expand: 'title,body.storage,version' },
			});
			const page = pageResp.data;

			let xml = `<confluence-page id="${pageId}">\n`;
			xml += `  <title>${formatXmlContent(page.title)}</title>\n`;

			// Body as HTML (storage format); for plain text, could convert if needed.
			xml += `  <body>${formatXmlContent(page.body?.storage?.value || '')}</body>\n`;

			// Attachments (metadata + download)
			const attachmentsResp = await this.axios().get(`/wiki/rest/api/content/${pageId}/child/attachment`);
			const attachments = attachmentsResp.data.results || [];

			if (attachments.length > 0) {
				xml += '  <attachments>\n';
				const agentPath = agentStorageDir();
				const dirPath = join(agentPath, 'confluence', pageId);
				await fs.mkdir(dirPath, { recursive: true });

				const downloadPromises = attachments.map(async (att: any) => {
					const filename = att.title as string;
					const contentUrl = att._links.download ? `${this.axios().defaults.baseURL}${att._links.download}` : '';
					const mimeType = att.metadata?.mediaType || '';
					const size = att.extensions?.fileSize || 0;
					const attachmentPath = join(dirPath, filename);

					try {
						if (contentUrl) {
							const res = await this.axios().get(contentUrl, { responseType: 'arraybuffer' });
							await fs.writeFile(attachmentPath, Buffer.from(res.data, 'binary'));
							return { filename, mimeType, size, attachmentPath };
						}
						return { filename, mimeType, size, attachmentPath: '[Unavailable - no download link]' };
					} catch (e: any) {
						logger.warn(e, `Failed to download attachment ${filename} from ${contentUrl}`);
						return { filename, mimeType, size, attachmentPath: '[Not available - download error]' };
					}
				});

				const results = await Promise.allSettled(downloadPromises);

				results.forEach((result) => {
					if (result.status === 'fulfilled') {
						const { filename, mimeType, size, attachmentPath } = result.value;
						xml += `    <attachment filename="${escapeXml(filename)}" mimeType="${escapeXml(mimeType)}" size="${size}b" path="${escapeXml(attachmentPath)}" />\n`;
					} else {
						logger.error(result.reason, 'Error during attachment download');
					}
				});

				xml += '  </attachments>\n';
			} else {
				xml += '  <attachments />\n';
			}
			xml += '</confluence-page>';

			return xml;
		} catch (error) {
			logger.error(error, `Error fetching Confluence page ${pageId}`);
			throw error;
		}
	}

	async fetchAllPagesInSpace(spaceKey: string): Promise<ConfluencePage[]> {
		const config: ConfluenceConfig = functionConfig(Confluence) as ConfluenceConfig;
		const baseUrl = config.baseUrl || envVar('JIRA_BASE_URL');
		const apiToken = config.token || getSecretEnvVar('JIRA_API_TOKEN');

		const pages: ConfluencePage[] = [];
		let start = 0;
		const limit = 100;
		let hasMore = true;

		while (hasMore) {
			const url = `${baseUrl}/rest/api/content?spaceKey=${spaceKey}&type=page&limit=${limit}&start=${start}`;
			const response = await fetch(url, {
				headers: {
					Authorization: `Basic ${apiToken}`,
					Accept: 'application/json',
				},
			});

			if (!response.ok) throw new Error(`Failed to fetch pages: ${response.status} ${response.statusText}`);

			const data: ConfluenceResponse = await response.json();
			pages.push(...data.results);

			start += limit;
			hasMore = data.size === limit;
		}

		return pages;
	}
}
