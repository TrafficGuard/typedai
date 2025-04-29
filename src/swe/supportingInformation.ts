import { getFileSystem } from '#agent/agentContextLocalStorage';
import type { ProjectInfo } from '#swe/projectDetection';

export async function supportingInformation(projectInfo: ProjectInfo): Promise<string> {
	let info = '';
	if (projectInfo.languageTools) {
		const tools = projectInfo.languageTools;
		const packages = await tools.getInstalledPackages();
		info += packages;
	}

	if (await getFileSystem().fileExists('CONVENTIONS.md')) {
		info += `\n${await getFileSystem().readFile('CONVENTIONS.md')}\n`;
	}

	return info;
}
