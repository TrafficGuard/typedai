import path, { join } from 'path';
import { PuppeteerBlocker } from '@cliqz/adblocker-puppeteer';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { agentContextStorage, getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { execCommand } from '#utils/exec';
import { cacheRetry } from '../../cache/cacheRetry';
const { getJson } = require('serpapi');
import { promises as fsPromises } from 'node:fs';
import * as autoconsent from '@duckduckgo/autoconsent';
import fetch from 'cross-fetch';
import puppeteer from 'puppeteer';
import { Browser } from 'puppeteer';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { sleep } from '#utils/async-utils';
import { agentDir } from '../../appVars';
const TurndownService = require('turndown');
const turndownService = new TurndownService();

export interface OrganicSearchResult {
	url: string;
	title: string;
	content?: string;
}

let blocker: PuppeteerBlocker;

/**
 * Functions for reading web pages on the public internet and taking screenshots
 */
@funcClass(__filename)
export class PublicWeb {
	/**
	 * Downloads the pages under the url 1 level deep to the .wget folder
	 * @param url The URL to crawl (https://...)
	 * @returns the A map of the website contents, keyed by filenames of the scraped web pages
	 */
	// @func
	// @cacheRetry({scope: 'global' })
	async crawlWebsite(url: string): Promise<Map<string, string>> {
		logger.info(`Crawling ${url}`);
		const cwd = path.join(getFileSystem().basePath, '.cache', 'wget');
		const { stdout, stderr, exitCode } = await execCommand(`wget -r -l 1  -k -p ${url}`, { workingDirectory: cwd });
		if (exitCode > 0) throw new Error(`${stdout} ${stderr}`);

		// console.log(stdout)
		// console.log(stderr)
		return new Map();
	}

	/**
	 * Get the contents of a web page on the public internet and extract data using the provided instructions, and optionally store it in memory with a new unique key.
	 * @param url {string} The web page URL (https://...)
	 * @param dataExtractionInstructions {string} Detailed natural language instructions of what data should be extracted from the web page's contents. Provide an example of what structure the data should be in, e.g. [{"name":"description"}, age: number}]
	 * @param memoryKey {string} The key to update the memory with, storing the data extracted from the web page. This key must NOT already exist in the memory block.
	 * @returns the extracted data
	 */
	// @func()
	@cacheRetry({ scope: 'global' })
	async getWebPageExtract(url: string, dataExtractionInstructions: string, memoryKey?: string): Promise<string> {
		const memory = agentContextStorage.getStore().memory;
		if (memory[memoryKey]) throw new Error(`The memory key ${memoryKey} already exists`);
		const contents = await this.getWebPage(url);
		const extracted = await llms().medium.generateText(`<page_contents>${contents}</page_contents>\n\n${dataExtractionInstructions}`, {
			id: 'Webpage Data Extraction',
		});
		if (memoryKey) {
			agentContextStorage.getStore().memory[memoryKey] = extracted;
		}
		return extracted;
	}

	/**
	 * Get the contents of a web page on the public open internet at the provided URL. NOTE: Do NOT use this for URLs websites/SaaS which would require authentication.
	 * @param url {string} The web page URL (https://...)
	 * @returns the web page contents in Markdown format
	 */
	@func()
	// @cacheRetry({ scope: 'global' })
	async getWebPage(url: string): Promise<string> {
		logger.info(`PublicWeb.getWebPage ${url}`);

		// https://screenshotone.com/blog/how-to-hide-cookie-banners-when-taking-a-screenshot-with-puppeteer/
		const browser: Browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
		const page = await browser.newPage();

		await page.setRequestInterception(true);
		page.on('request', (request) => {
			if (request.resourceType() === 'image') request.abort();
			else request.continue();
		});
		const httpResponse = await page.goto(url, { waitUntil: 'networkidle2' });
		await sleep(2000);
		const htmlContents = await page.content();

		await page.close();
		await browser.close();

		const readableHtml = this.readableVersionFromHtml(htmlContents, url);
		return this.htmlToMarkdown(readableHtml, url);
	}

	/**
	 * Transforms the HTML into a readable version, which reduces the text size for LLM processing
	 * @param html
	 * @param url
	 */
	readableVersionFromHtml(html: string, url?: string): string {
		const doc = new JSDOM(html, { url });
		const reader = new Readability(doc.window.document);
		try {
			const article = reader.parse();
			return article.content;
		} catch (e) {
			logger.warn(e, `Could not create readability version of ${url}`);
			return html;
		}
	}

	/**
	 * Transforms HTML into Markdown format, which reduces the text size for LLM processing
	 * @param html The HTML to convert
	 * @param url The URL of the HTML (optional)
	 */
	htmlToMarkdown(html: string, url?: string): string {
		return turndownService.turndown(html);
	}

	/**
	 * Downloads a file from the specified URL and saves it locally.
	 * @param url The URL of the file to download.
	 * @returns The local file path where the file was saved.
	 */
	@func()
	async downloadFile(url: string): Promise<string> {
		logger.info(`Downloading file from ${url}`);
		try {
			const response = await fetch(url);

			if (!response.ok) throw new Error(`Failed to download file from ${url}. Status: ${response.status} ${response.statusText}`);

			const arrayBuffer = await response.arrayBuffer();

			const fileName = url.substring(url.lastIndexOf('/') + 1) || 'downloaded_file';
			const filePath = join(agentDir(), fileName);
			await fsPromises.writeFile(filePath, Buffer.from(arrayBuffer));
			logger.info(`File downloaded and saved to ${filePath}`);
			return filePath;
		} catch (error) {
			logger.error(`Error downloading file from ${url}: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Performs a Google search and returns the URLs of the search results
	 * @param searchTerm
	 */
	// @func
	@cacheRetry()
	async googleSearch(searchTerm: string): Promise<string[]> {
		// console.log('Google search', searchTerm)
		// // https://programmablesearchengine.google.com/controlpanel/create
		// https://programmablesearchengine.google.com/controlpanel/all
		// // Select "Search the entire web"
		// const searchEngineId = envVar('GOOGLE_CUSTOM_SEARCH_ENGINE_ID')
		// const searchKey = envVar('GOOGLE_CUSTOM_SEARCH_KEY')
		//
		// const url = `https://www.googleapis.com/customsearch/v1` // ?key=${searchKey}&cx=${searchEngineId}&q=${searchTerm}
		// const results = await axios.get(url, {
		// 	params: {
		// 		key: searchKey,
		// 		cx: searchEngineId,
		// 		q: searchTerm
		// 	}
		// })
		// console.log(results.data)
		// console.log(results.data.queries.request)
		// try {
		// 	return results.data.items.map((item: any) => item.link)
		// } catch (e) {
		// 	console.error(results.status)
		// 	console.error(results.data)
		// 	console.error(e)
		// 	throw new Error(e.message)
		// }

		// https://developers.google.com/custom-search/v1/reference/rest/v1/Search

		return (await this.serpApiSearch(searchTerm)).map((result) => result.url);
	}

	/**
	 * Performs a Google search and returns the URL and title of the search results
	 * @param searchTerm
	 */
	@func()
	@cacheRetry()
	async serpApiSearch(searchTerm: string): Promise<OrganicSearchResult[]> {
		// https://serpapi.com/search-api
		// https://serpapi.com/search&q=
		// const searchedUrls = new Set<string>();
		logger.info('SerpApi search', searchTerm);
		const json = await getJson({
			// engine: "google",
			q: searchTerm,
			// location: "Seattle-Tacoma, WA, Washington, United States",
			// hl: "en",
			// gl: "us",
			// google_domain: "google.com",
			// num: "10",
			// start: "10",
			// safe: "active",
			api_key: process.env.SERP_API_KEY, // TODO change to user property
		});
		return json.organic_results.map((result) => {
			return { url: result.link, title: result.title };
		});
	}

	/**
	 * Performs a Kagi search and returns a map with the contents of the search results keyed by the URL
	 * @param searchTerm
	 */
	async kagiSearch(searchTerm: string): Promise<Map<string, string>> {
		// TODO
		return new Map();
	}

	/**
	 * Calls the Kagi API which performs a web search and then summarises the results
	 * @param searchTerm
	 * @return A summary of the search results contents from the Kagi search engine
	 */
	async askKagi(question: string): Promise<string> {
		// TODO
		return '';
	}

	/**
	 * Takes a screenshot of a web page while hiding cookie banners
	 * @param url The URL of the web page to screenshot. Must be a complete URL with https://
	 * @returns {Promise<{ image: Buffer; logs: string[] }>} A Buffer containing the screenshot image data in .png format, and the browser logs
	 */
	@func()
	async takeScreenshotAndLogs(url: string): Promise<{ image: Buffer; logs: string[] }> {
		logger.info(`Taking screenshot of ${url}`);

		if (!blocker) blocker = await PuppeteerBlocker.fromLists(fetch as any, ['https://secure.fanboy.co.nz/fanboy-cookiemonster.txt']);

		const browser: Browser = await puppeteer.launch({ headless: true });
		const page = await browser.newPage();

		try {
			await blocker.enableBlockingInPage(page);
			await page.setViewport({ width: 1280, height: 1024 });

			// page.once('load', async () => {
			// 	const tab = autoconsent.attachToPage(page, url, [], 10);
			// 	await tab.doOptIn();
			// });

			const logs: string[] = [];
			//
			page
				.on('console', (message) => logs.push(`${message.type().substr(0, 3).toUpperCase()} ${message.text()}`))
				.on('pageerror', ({ message }) => logs.push(message))
				.on('requestfailed', (request) => logs.push(`${request.failure().errorText} ${request.url()}`));

			await page.goto(url, { waitUntil: ['load', 'domcontentloaded'] });

			// Wait for a short time to allow any dynamic content to load
			await sleep(4000);

			const screenshot = await page.screenshot({ type: 'png' });

			return {
				image: screenshot,
				logs,
			};
		} catch (error) {
			logger.error(`Error taking screenshot of ${url}: ${error.message}`);
			throw error;
		} finally {
			await page?.close();
			await browser?.close();
		}
	}
}

export const PUBLIC_WEB = new PublicWeb();
