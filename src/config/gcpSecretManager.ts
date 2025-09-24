import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { RetryableError, cacheRetry } from '#cache/cacheRetry';
import { logger } from '#o11y/logger';
import { SecretManager } from './secretConfig';

function getProjectId(): string {
	const pid = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
	if (!pid) throw new Error('Google Cloud project id not found. Set GCLOUD_PROJECT or GOOGLE_CLOUD_PROJECT.');
	return pid;
}

export class GcpSecretManager implements SecretManager {
	private client = new SecretManagerServiceClient();

	@cacheRetry({ retries: 3, backOffMs: 500 })
	async listSecrets(projectId?: string): Promise<string[]> {
		const pid = projectId ?? getProjectId();
		const parent = `projects/${pid}`;
		const [secrets] = await this.client.listSecrets({ parent });
		const names: string[] = [];
		for (const s of secrets || []) {
			const full = s.name || '';
			const ix = full.lastIndexOf('/secrets/');
			const name = ix >= 0 ? full.substring(ix + '/secrets/'.length).split('/')[0] : full;
			if (name) names.push(name);
		}
		logger.info(`GSM listed ${names.length} secrets`);
		return names;
	}

	@cacheRetry({ retries: 3, backOffMs: 500 })
	async accessSecret(secretName: string, version = 'latest', projectIdOrName?: string): Promise<string> {
		const pid = projectIdOrName ?? getProjectId();
		const name = `projects/${pid}/secrets/${secretName}/versions/${version}`;
		try {
			const [resp] = await this.client.accessSecretVersion({ name });
			const dataBuf = resp?.payload?.data;
			if (!dataBuf) throw new RetryableError(new Error('Secret payload missing'));
			const value = dataBuf.toString('utf8');
			const mask = value.length > 10 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
			logger.debug(`GSM accessed ${secretName} (${mask})`);
			return value;
		} catch (e: any) {
			const status = e?.code;
			if (!status || status >= 500) throw new RetryableError(e instanceof Error ? e : new Error(String(e)));
			throw e;
		}
	}
}
