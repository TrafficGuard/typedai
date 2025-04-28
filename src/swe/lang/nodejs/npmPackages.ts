import axios from 'axios';
import { agentContext, getFileSystem } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { PublicWeb } from '#functions/web/web';
import { logger } from '#o11y/logger';
import { cacheRetry } from '../../../cache/cacheRetry';

export interface NpmPackageInfo {
	docUrl: string;
	gitHubUrl: string;
}

interface NpmOrgPackageInfo {
	name: string;
	version: string;
	description: string;
	links: {
		npm: string;
		homepage?: string;
		repository?: string;
		bugs?: string;
	};
}

interface SearchResponse {
	objects: Array<{
		package: NpmOrgPackageInfo;
	}>;
	total: number;
	time: string;
}

@funcClass(__filename)
export class NpmPackages {
	/**
	 * Gets the latest version of a NPM package from registry.npmjs.org
	 * @param packageName the NPM package name
	 */
	@func()
	async getLatestNpmPackageVersion(packageName: string): Promise<string | null> {
		try {
			const response = await axios.get<SearchResponse>(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(packageName)}&size=3`);

			const packages = response.data.objects;

			// Find the exact match for the package name
			const exactMatch = packages.find((obj) => obj.package.name.toLowerCase() === packageName.toLowerCase());

			return exactMatch?.package.version ?? null;
		} catch (error) {
			if (axios.isAxiosError(error)) {
				console.error('Error fetching package info:', error.message);
			} else {
				console.error('Unexpected error:', error);
			}
			return null;
		}
	}

	/**
	 * @param npmPackageName
	 */
	// @func
	async getDocumentation(npmPackageName: string): Promise<string> {
		const info = await this.getPackageInfo(npmPackageName);
		const crawls = [];
		if (info.gitHubUrl) crawls.push(new PublicWeb().crawlWebsite(info.gitHubUrl));
		if (info.docUrl) crawls.push(new PublicWeb().crawlWebsite(info.docUrl));

		await Promise.all(crawls);

		logger.info(info);
		throw new Error('Not implemented');
	}

	@cacheRetry({ retries: 1, backOffMs: 1000 })
	async downloadDocumentation(npmPackageName: string): Promise<string> {
		const info = await this.getPackageInfo(npmPackageName);
		const crawls = [];
		if (info.gitHubUrl) crawls.push(new PublicWeb().crawlWebsite(info.gitHubUrl));
		if (info.docUrl) crawls.push(new PublicWeb().crawlWebsite(info.docUrl));

		await Promise.all(crawls);

		logger.info(info);
		throw new Error('Not implemented');
	}

	/**
	 * Gets the GitHub URL and the documentation site URL, if either exist, for a NPM package.
	 * @param npmPackageName
	 * @returns Promise<{docUrl: string; gitHubUrl: string;}>
	 */
	@cacheRetry()
	@func()
	async getPackageInfo(npmPackageName: string): Promise<NpmPackageInfo> {
		const llm = agentContext().llms.easy;
		// fetch the HTML at https://npmjs.com/package/${npmPackageName}
		const url = `https://npmjs.com/package/${npmPackageName}`;
		const npmjsFetch = await fetch(url);
		let html = await npmjsFetch.text();

		html = new PublicWeb().readableVersionFromHtml(html, url);

		const response: any = await llm.generateJson(
			`${html}\n\nExtract the URL from this html document at https://npmjs.com/package/${npmPackageName} that looks like it will be the main site which contains the documentation for the package ${npmPackageName}, and the link to the GitHub repo if it exists. Return your answer as JSON in the format {"docUrl":"", "gitHubUrl":""}`,
			{ id: 'getPackageInfo' },
		);
		let docUrl = response.docUrl as string | null;
		const gitHubUrl = response.gitHubUrl as string | null;

		if (docUrl && gitHubUrl && docUrl.startsWith(gitHubUrl)) {
			docUrl = null;
		}
		return {
			docUrl,
			gitHubUrl,
		};
	}

	/**
	 * Get all the file contents matching node_modules/<package_name>/*.d.ts
	 * @param npmPackageName
	 */
	async getModuleTypings(npmPackageName: string): Promise<string> {
		const fileSystem = getFileSystem();
		if (!(await fileSystem.fileExists(`node_modules/${npmPackageName}`))) {
			return '';
		}
		const files = await fileSystem.listFilesRecursively(`node_modules/${npmPackageName}`);
		const dtsFiles = files.filter((filename) => filename.endsWith('.d.ts'));
		return fileSystem.readFilesAsXml(dtsFiles);
	}
}
