import path from 'node:path';
import { getFileSystem } from '#agent/agentContextLocalStorage';
import { AI_INFO_FILENAME, type ProjectInfo, getProjectInfos } from '#swe/projectDetection';

async function findRepoRoot(start: string, fss: typeof getFileSystem): Promise<string | null> {
	const fileSystemService = fss();
	let dir = start;
	while (true) {
		if (await fileSystemService.fileExists(path.join(dir, AI_INFO_FILENAME))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

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
		const allProjects = (await getProjectInfos()) ?? []; // backend + frontend + any others

		// Determine the repository root using VCS root or by searching upwards for .typedai.json
		const repoRoot = fss.getVcsRoot() ?? (await findRepoRoot(originalWd, getFileSystem)) ?? originalWd;

		function abs(dir: string) {
			return path.resolve(repoRoot, dir);
		}
		const absFiles = selectedFiles.map((p) => path.resolve(originalWd, p));

		let projectsToInclude =
			selectedFiles.length === 0
				? [projectInfo] // old behaviour
				: allProjects.filter((p) => absFiles.some((file) => file.startsWith(abs(p.baseDir))));

		// If both root ("./" or ".") and sub-projects are selected, keep the root project
		// only when at least one selected file is outside every sub-project.
		const rootProject = projectsToInclude.find((p) => p.baseDir === './' || p.baseDir === '.');
		const subProjects = projectsToInclude.filter((p) => p.baseDir !== './' && p.baseDir !== '.');

		if (rootProject && subProjects.length > 0) {
			const rootNeeded = absFiles.some((file) => !subProjects.some((sp) => file.startsWith(abs(sp.baseDir))));
			if (!rootNeeded) {
				projectsToInclude = subProjects; // safe to drop root project
			}
		}

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
