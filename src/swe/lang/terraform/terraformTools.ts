import { getFileSystem } from '#agent/agentContextLocalStorage';
import { funcClass } from '#functionSchema/functionDecorators';
import type { LanguageTools } from '../languageTools';

@funcClass(__filename)
export class TerraformTools implements LanguageTools {
	async generateProjectMap(): Promise<string> {
		const filenames = await getFileSystem().listFilesRecursively();
		return filenames.join('\n');
	}

	installPackage(packageName: string): Promise<void> {
		throw new Error('New Terraform modules are added by editing the source code');
	}

	getInstalledPackages(): Promise<string> {
		return Promise.resolve('');
	}
}
