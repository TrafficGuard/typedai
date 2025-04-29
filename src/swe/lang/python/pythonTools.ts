import { getFileSystem } from '#agent/agentContextLocalStorage';
import { funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { getPythonPath } from '#swe/aiderCodeEditor';
import { execCmd, execCommand } from '#utils/exec';
import type { LanguageTools } from '../languageTools';

@funcClass(__filename)
export class PythonTools implements LanguageTools {
	async generateProjectMap(): Promise<string> {
		logger.info(getFileSystem().getWorkingDirectory());
		const { stdout, stderr /*, exitCode*/ } = await execCmd(`${getPythonPath()} -m aider --yes --map-tokens 2048 --show-repo-map`);
		// stubgen --ignore-errors -o stubs

		// if (exitCode > 0) throw new Error(`${stdout} ${stderr}`);
		return stdout;
	}

	async installPackage(packageName: string): Promise<void> {}

	getInstalledPackages(): Promise<string> {
		return Promise.resolve('');
	}
}
