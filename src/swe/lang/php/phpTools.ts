import { func, funcClass } from '#functionSchema/functionDecorators';
import type { LanguageTools } from '../languageTools';

@funcClass(__filename)
export class PhpTools implements LanguageTools {
	/**
	 * Generates an outline of a PHP project
	 */
	@func()
	async generateProjectMap(): Promise<string> {
		return '';
	}

	async installPackage(packageName: string): Promise<void> {}

	getInstalledPackages(): Promise<string> {
		return Promise.resolve('');
	}
}
