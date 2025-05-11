import { Dropbox } from 'dropbox';

import { func, funcClass } from '#functionSchema/functionDecorators';
import { functionConfig } from '#user/userContext';

/**
 * AI generated. Not tested.
 */
@funcClass(__filename)
class DropboxClient {
	private dbx: Dropbox;

	constructor() {
		this.dbx = new Dropbox({ accessToken: functionConfig(DropboxClient).token });
	}

	@func()
	async list(): Promise<string[]> {
		const response = await this.dbx.filesListFolder({ path: '' });
		return response.result.entries.map((entry) => `${entry.path_lower}/${entry.name}`);
	}

	@func()
	async createTextFile(filePath: string, contents: string): Promise<string> {
		const response = await this.dbx.filesUpload({
			path: filePath,
			contents: contents,
			mode: { '.tag': 'overwrite' },
		});
		return response.result.id;
	}

	@func()
	async createBinaryFile(filePath: string, contents: Uint8Array): Promise<string> {
		const response = await this.dbx.filesUpload({
			path: filePath,
			contents,
			mode: { '.tag': 'overwrite' },
		});
		return response.result.id;
	}
}

export default DropboxClient;
