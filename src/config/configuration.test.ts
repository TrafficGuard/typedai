import { expect } from 'chai';
import { SecretManager, getSecretEnvVar, loadSecrets } from './secretConfig';

class FakeSecretManager implements SecretManager {
	constructor(private data: Map<string, string>) {}

	async listSecrets(): Promise<string[]> {
		return Array.from(this.data.keys());
	}

	async accessSecret(secretName: string, _version, _projectId: string | undefined): Promise<string> {
		if (!this.data.has(secretName)) throw new Error(`Secret ${secretName} not found in ${Array.from(this.data.keys())}`);
		return this.data.get(secretName)!;
	}
}

describe('configuration', () => {
	it('loads secrets via mapping and allows getSecret/getSetting', async () => {
		process.env.SLACK_BOT_TOKEN = 'secret://SLACK_BOT_TOKEN';

		const fake = new FakeSecretManager(new Map([['SLACK_BOT_TOKEN', 'xoxb-123']]));

		await loadSecrets(fake);

		expect(getSecretEnvVar('SLACK_BOT_TOKEN')).to.equal('xoxb-123');
	});
});
