import { randomUUID } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { CICDStatsService, JobResult } from '#functions/scm/cicdStatsService';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { currentUser } from '#user/userContext';
import { firestoreDb } from './firestore';

export class FirestoreCICDStatsService implements CICDStatsService {
	private db: Firestore;

	constructor() {
		this.db = firestoreDb();
	}

	@span()
	async saveJobResult(jobResult: JobResult): Promise<void> {
		const docRef = this.db.collection('CICDStats').doc(randomUUID());
		await docRef.set(jobResult);
	}

	@span()
	async getRecentSuccessfulJobs(project: string, jobName: string): Promise<JobResult[]> {
		const query = this.db
			.collection('CICDStats')
			.where('project', '==', project)
			.where('jobName', '==', jobName)
			.where('status', '==', 'success')
			.orderBy('startedAt', 'desc')
			.limit(20);
		return query.get().then((querySnapshot) => {
			const jobResults: JobResult[] = [];
			querySnapshot.forEach((doc) => {
				jobResults.push(doc.data() as JobResult);
			});
			return jobResults;
		});
	}
}
