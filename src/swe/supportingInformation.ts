import { getFileSystem } from '#agent/agentContextLocalStorage';
import path from 'node:path';
import { detectProjectInfo, type ProjectInfo } from '#swe/projectDetection';

export async function supportingInformation(
	projectInfo: ProjectInfo,
	selectedFiles: string[] = [], // new – files the agent will edit/analyse
): Promise<string> {
	const fss = getFileSystem();
	const originalWd = fss.getWorkingDirectory();
	let info = '';

	try {
		/* -----------------------------------------------------------
		 * 1. Work out which projects we need to report on
		 * --------------------------------------------------------- */
		const allProjects = await detectProjectInfo(); // backend + frontend + any others
		function abs(dir: string) {
			return path.resolve(fss.getVcsRoot() ?? originalWd, dir);
		}
		const absFiles = selectedFiles.map((p) => path.resolve(originalWd, p));

		const projectsToInclude =
			selectedFiles.length === 0
				? [projectInfo] // old behaviour
				: allProjects.filter((p) => absFiles.some((file) => file.startsWith(abs(p.baseDir))));

		/* Always fall back to the current project if nothing matched */
		if (projectsToInclude.length === 0) projectsToInclude.push(projectInfo);

		/* -----------------------------------------------------------
		 * 2. Collect installed-package blocks for each project
		 * --------------------------------------------------------- */
		for (const proj of projectsToInclude) {
			if (!proj.languageTools) continue;

			fss.setWorkingDirectory(abs(proj.baseDir));
			const packages = await proj.languageTools.getInstalledPackages();
			info += `\n<!-- ${proj.baseDir} packages -->\n${packages}\n`;
		}

		/* -----------------------------------------------------------
		 * 3. Append repo-wide CONVENTIONS.md (if present)
		 * --------------------------------------------------------- */
		fss.setWorkingDirectory(originalWd);
		if (await fss.fileExists('CONVENTIONS.md')) {
			info += `\n${await fss.readFile('CONVENTIONS.md')}\n`;
		}
	} finally {
		// Ensure working directory is restored
		fss.setWorkingDirectory(originalWd);
	}

	return info.trim();
}
