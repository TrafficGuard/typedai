import { funcClass } from '#functionSchema/functionDecorators';
import type { LanguageTools } from '../languageTools';

@funcClass(__filename)
export class PythonTools implements LanguageTools {
	async generateProjectMap(): Promise<string> {
		return '';
	}

	async installPackage(packageName: string): Promise<void> {}

	getInstalledPackages(): Promise<string> {
		return Promise.resolve('');
	}
}
