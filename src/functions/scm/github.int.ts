import { existsSync } from 'node:fs';
import { expect } from 'chai';
import { GitHub } from './github';

const TEST_OWNER = '';
const TEST_REPO = '';
const PROJECT_PATH = `${TEST_OWNER}/${TEST_REPO}`;
/**
 * Tests that interact with real GitHub resources
 */
describe('GitHub Integration Tests', () => {
	let github: GitHub;

	beforeEach(() => {
		// Configured from the provided environment variables
		github = new GitHub();
	});

	afterEach(() => {});

	describe('getProjects', () => {
		it('should get the projects from the configured organization', async () => {
			const projects = await github.getProjects();
			expect(projects).to.be.an('array');
			expect(projects.length).to.be.greaterThan(0);
			expect(projects[0]).to.have.property('name');
			expect(projects[0]).to.have.property('namespace');
		});

		it('should throw an error for invalid organization', async () => {
			// Temporarily set an invalid organization
			const originalOrg = github.config().organisation;
			github.config().organisation = 'invalid-org-name-12345';

			try {
				await github.getProjects();
				expect.fail('Expected an error to be thrown');
			} catch (error) {
				expect(error).to.be.an('error');
				expect(error.message).to.include('Failed to get projects');
			} finally {
				// Restore the original organization
				github.config().organisation = originalOrg;
			}
		});
	});

	describe('getProjects and clone one', () => {
		it('should get the projects and clone the first one', async () => {
			const projects = await github.getProjects();
			expect(projects.length).to.be.greaterThan(0);
			// console.log(projects[0]);
			const firstProject = projects[0];
			const clonePath = await github.cloneProject(`${firstProject.namespace}/${firstProject.name}`, 'main');
			expect(clonePath).to.be.a('string');
			expect(existsSync(clonePath)).to.be.true;
		});
	});

	describe.skip('getJobLogs', () => {
		it('should fetch job logs for a specific job', async () => {
			// Note: You'll need to replace these with actual values from your GitHub repository
			const jobId = '12345678';

			const logs = await github.getJobLogs(PROJECT_PATH, jobId);

			expect(logs).to.be.a('string');
			expect(logs.length).to.be.greaterThan(0);
			// You might want to add more specific assertions based on the expected content of the logs
		});

		it('should throw an error for non-existent job', async () => {
			const nonExistentJobId = '99999999';

			try {
				await github.getJobLogs(PROJECT_PATH, nonExistentJobId);
				expect.fail('Expected an error to be thrown');
			} catch (error) {
				expect(error).to.be.an('error');
				expect(error.message).to.include('Failed to get job logs');
			}
		});
	});
});
