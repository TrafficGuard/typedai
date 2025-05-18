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

	describe('getIssueComments', () => {
		it('should create an issue, add a comment, retrieve comments, and verify the added comment', async () => {
			const testProjectPath = 'trafficguard/test'; // This repository is used in other E2E examples in github.ts

			// 1. Create a new issue
			const issueTitle = `Test Issue for getIssueComments ${Date.now()}`;
			const issueBodyText = 'This is the initial body of a test issue created for getIssueComments.';
			let createdIssue: any;
			try {
				createdIssue = await github.createIssue(testProjectPath, issueTitle, issueBodyText);
				expect(createdIssue, 'Issue creation failed or returned null/undefined').to.exist;
				expect(createdIssue.number, 'Created issue must have a valid number').to.be.a('number').and.greaterThan(0);
			} catch (error: any) {
				console.error('Error during issue creation in test "getIssueComments":', error);
				// Use expect.fail to clearly mark the test as failed due to setup issues
				expect.fail(`Test setup failed at issue creation: ${error.message}`);
				return; // Exit test if setup fails
			}

			// 2. Post a comment on the newly created issue
			const commentBodyText = `Test comment for issue #${createdIssue.number} added at ${new Date().toISOString()}. Unique: ${Math.random()}`;
			let postedComment: any;
			try {
				postedComment = await github.postCommentOnIssue(testProjectPath, createdIssue.number, commentBodyText);
				expect(postedComment, 'Comment posting failed or returned null/undefined').to.exist;
				expect(postedComment.body, 'Body of the posted comment does not match').to.equal(commentBodyText);
			} catch (error: any) {
				console.error(`Error during comment posting in test "getIssueComments" for issue #${createdIssue.number}:`, error);
				expect.fail(`Test setup failed at comment posting: ${error.message}`);
				return; // Exit test if setup fails
			}

			// 3. Retrieve all comments for the issue
			let comments: string;
			try {
				comments = await github.getIssueComments(testProjectPath, createdIssue.number);
			} catch (error: any) {
				console.error(`Error during getIssueComments call in test for issue #${createdIssue.number}:`, error);
				expect.fail(`Call to getIssueComments failed: ${error.message}`);
				return; // Exit test if retrieval fails
			}

			// 4. Verify the retrieved comments
			expect(comments, 'Retrieved comments should be an array').to.be.an('array');
			// We expect at least the comment we just posted.
			expect(comments.length, 'Comments array should contain at least one comment').to.be.greaterThan(0);

			const foundComment = comments.find((comment) => comment.body === commentBodyText);
			expect(foundComment, `The specific test comment (body: "${commentBodyText}") was not found in the retrieved comments`).to.exist;

			if (foundComment) {
				expect(foundComment.body).to.equal(commentBodyText);
				// Verify the user who made the comment, if possible and configured
				const configuredUsername = github.config().username;
				if (configuredUsername) {
					expect(foundComment.user?.login, 'Comment user login should match the configured GitHub username').to.equal(configuredUsername);
				} else {
					// If no specific username is configured for the GitHub instance,
					// at least ensure a user is associated with the comment.
					expect(foundComment.user, 'Comment should have a user object associated').to.exist;
					expect(foundComment.user?.login, 'Comment user login should be a non-empty string').to.be.a('string').and.not.empty;
				}
			}
		});
	});
});
