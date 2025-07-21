import { randomUUID } from 'node:crypto';
import { expect } from 'chai';
import { SINGLE_USER_ID } from '#modules/memory/inMemoryUserService';
import { system, user } from '#shared/llm/llm.model';
import type { Prompt } from '#shared/prompts/prompts.model';
import type { User } from '#shared/user/user.model';
import { runWithUser } from '#user/userContext';
import type { PromptsService } from './promptsService';

// Test User Definitions
export const TEST_USER_ID = SINGLE_USER_ID; // Using SINGLE_USER_ID for consistency

export const TEST_USER: User = {
	id: TEST_USER_ID,
	name: 'Test User Prompt Library',
	email: 'test-prompts@example.com',
	enabled: true,
	passwordHash: 'test-hash-prompts', // Not used by service, but good for completeness
	createdAt: new Date('2023-01-01T00:00:00.000Z'),
	lastLoginAt: new Date('2023-01-01T01:00:00.000Z'),
	hilBudget: 10,
	hilCount: 5,
	llmConfig: { openaiKey: 'test-key' }, // Example config
	chat: {
		defaultLLM: 'gpt-4o',
		temperature: 0.8,
		topP: 1,
		topK: 50,
	},
	functionConfig: { testFunction: { enabled: true } }, // Example config
};

// Helper for Sample Prompt Data
const getSamplePromptData = (nameSuffix = ''): Omit<Prompt, 'id' | 'revisionId' | 'userId'> => ({
	name: `Test Prompt ${nameSuffix} ${randomUUID()}`, // Unique name for each call
	parentId: undefined,
	appId: undefined,
	tags: ['test', `tag-${nameSuffix}`],
	messages: [system('System message content'), user('User message content')],
	settings: { temperature: 0.5, maxOutputTokens: 100, topK: 40 },
});

export function runPromptsServiceTests(createService: () => PromptsService, beforeEachHook: () => Promise<void> | void = () => {}): void {
	let service: PromptsService;

	const runWithTestUserContext = (testFn: () => Promise<void>) => {
		return () => runWithUser(TEST_USER, testFn);
	};

	beforeEach(async () => {
		service = createService();
		await beforeEachHook(); // For things like resetting DB emulator
	});

	describe('PromptsService Tests', () => {
		describe('createPrompt', () => {
			it(
				'should create a new prompt with revision 1',
				runWithTestUserContext(async () => {
					const sampleData = getSamplePromptData('create');
					const createdPrompt = await service.createPrompt(sampleData, TEST_USER_ID);

					expect(createdPrompt.id).to.be.a('string').and.not.empty;
					expect(createdPrompt.userId).to.equal(TEST_USER_ID);
					expect(createdPrompt.revisionId).to.equal(1);
					expect(createdPrompt.name).to.equal(sampleData.name);
					expect(createdPrompt.tags).to.deep.equal(sampleData.tags);
					expect(createdPrompt.messages).to.deep.equal(sampleData.messages);
					expect(createdPrompt.settings).to.deep.equal(sampleData.settings);
					expect(createdPrompt.parentId).to.be.undefined;
					expect(createdPrompt.appId).to.be.undefined;
				}),
			);

			it(
				'should create a prompt with parentId and appId',
				runWithTestUserContext(async () => {
					const sampleData = { ...getSamplePromptData('create-optional'), parentId: 'parent-123', appId: 'app-xyz' };
					const createdPrompt = await service.createPrompt(sampleData, TEST_USER_ID);
					expect(createdPrompt.parentId).to.equal('parent-123');
					expect(createdPrompt.appId).to.equal('app-xyz');
				}),
			);
		});

		describe('getPrompt', () => {
			it(
				'should get the latest revision of a prompt',
				runWithTestUserContext(async () => {
					const initialData = getSamplePromptData('get-latest');
					const promptV1 = await service.createPrompt(initialData, TEST_USER_ID);
					const updatedData = { name: 'Updated Name V2' };
					await service.updatePrompt(promptV1.id, updatedData, TEST_USER_ID, true); // newVersion = true

					const fetchedPrompt = await service.getPrompt(promptV1.id, TEST_USER_ID);
					expect(fetchedPrompt).to.not.be.null;
					expect(fetchedPrompt!.revisionId).to.equal(2);
					expect(fetchedPrompt!.name).to.equal('Updated Name V2');
				}),
			);

			it(
				'should return null if prompt does not exist',
				runWithTestUserContext(async () => {
					const fetchedPrompt = await service.getPrompt('non-existent-id', TEST_USER_ID);
					expect(fetchedPrompt).to.be.null;
				}),
			);
		});

		describe('getPromptVersion', () => {
			it(
				'should get a specific revision of a prompt',
				runWithTestUserContext(async () => {
					const initialData = getSamplePromptData('get-version');
					const promptV1 = await service.createPrompt(initialData, TEST_USER_ID);
					await service.updatePrompt(promptV1.id, { name: 'V2 Name' }, TEST_USER_ID, true);
					// const promptV3 = await service.updatePrompt(promptV1.id, { name: 'V3 Name' }, TEST_USER_ID, true); // Not used, but shows sequence

					const fetchedV1 = await service.getPromptVersion(promptV1.id, 1, TEST_USER_ID);
					expect(fetchedV1).to.not.be.null;
					expect(fetchedV1!.name).to.equal(initialData.name);
					expect(fetchedV1!.revisionId).to.equal(1);

					const fetchedV2 = await service.getPromptVersion(promptV1.id, 2, TEST_USER_ID);
					expect(fetchedV2).to.not.be.null;
					expect(fetchedV2!.name).to.equal('V2 Name');
					expect(fetchedV2!.revisionId).to.equal(2);
				}),
			);

			it(
				'should return null if specific revision does not exist',
				runWithTestUserContext(async () => {
					const initialData = getSamplePromptData('get-non-rev');
					const promptV1 = await service.createPrompt(initialData, TEST_USER_ID);
					const fetchedPrompt = await service.getPromptVersion(promptV1.id, 99, TEST_USER_ID);
					expect(fetchedPrompt).to.be.null;
				}),
			);

			it(
				'should return null if prompt does not exist',
				runWithTestUserContext(async () => {
					const fetchedPrompt = await service.getPromptVersion('non-existent-prompt-id', 1, TEST_USER_ID);
					expect(fetchedPrompt).to.be.null;
				}),
			);
		});

		describe('updatePrompt', () => {
			it(
				'should update the latest revision in place (newVersion = false)',
				runWithTestUserContext(async () => {
					const initialData = getSamplePromptData('update-inplace');
					const prompt = await service.createPrompt(initialData, TEST_USER_ID);
					const updates = { name: 'Updated InPlace Name', tags: ['new-tag'] };
					const updatedPrompt = await service.updatePrompt(prompt.id, updates, TEST_USER_ID, false);

					expect(updatedPrompt.revisionId).to.equal(1); // Should be same revision
					expect(updatedPrompt.name).to.equal('Updated InPlace Name');
					expect(updatedPrompt.tags).to.deep.equal(['new-tag']);
					// Ensure other fields are preserved
					expect(updatedPrompt.messages).to.deep.equal(initialData.messages);
					expect(updatedPrompt.settings).to.deep.equal(initialData.settings);
				}),
			);

			it(
				'should create a new revision (newVersion = true)',
				runWithTestUserContext(async () => {
					const initialData = getSamplePromptData('update-new-rev');
					const prompt = await service.createPrompt(initialData, TEST_USER_ID);
					const updates = { name: 'New Revision Name' };
					const updatedPrompt = await service.updatePrompt(prompt.id, updates, TEST_USER_ID, true);

					expect(updatedPrompt.revisionId).to.equal(2); // Should be new revision
					expect(updatedPrompt.name).to.equal('New Revision Name');
					// Ensure other fields are from the previous version or updated
					expect(updatedPrompt.tags).to.deep.equal(initialData.tags); // Tags should carry over
					expect(updatedPrompt.messages).to.deep.equal(initialData.messages); // Messages should carry over
				}),
			);

			it(
				'should throw an error if prompt does not exist when updating',
				runWithTestUserContext(async () => {
					try {
						await service.updatePrompt('non-existent-id', { name: 'Update Fail' }, TEST_USER_ID, false);
						expect.fail('Should have thrown an error because the prompt does not exist');
					} catch (error: any) {
						// Check for a message indicating the prompt was not found.
						// The exact message might vary by implementation.
						expect(error.message).to.match(/not found|does not exist/i);
					}
				}),
			);
		});

		describe('listPromptsForUser', () => {
			it(
				'should list prompts for the user, returning PromptPreview',
				runWithTestUserContext(async () => {
					const prompt1Data = getSamplePromptData('list1');
					const prompt2Data = getSamplePromptData('list2');
					// Create prompts with slight delay or ensure unique names if order matters and is based on creation time/name
					const p1 = await service.createPrompt(prompt1Data, TEST_USER_ID);
					const p2 = await service.createPrompt(prompt2Data, TEST_USER_ID);

					const previews = await service.listPromptsForUser(TEST_USER_ID);
					expect(previews).to.be.an('array').with.lengthOf(2);

					// Verify structure of previews and that they match created prompts (order might not be guaranteed)
					const previewNames = previews.map((p) => p.name);
					expect(previewNames).to.include.members([prompt1Data.name, prompt2Data.name]);

					for (const preview of previews) {
						expect(preview.userId).to.equal(TEST_USER_ID);
						expect(preview).to.not.have.property('messages'); // Key check for PromptPreview
						expect(preview.id).to.be.a('string');
						expect(preview.name).to.be.a('string');
						expect(preview.revisionId).to.be.a('number'); // Should be latest revision
						expect(preview.settings).to.be.an('object');
						expect(preview.tags).to.be.an('array');

						// Check if it's one of the created prompts
						const originalPrompt = preview.name === prompt1Data.name ? p1 : p2;
						expect(preview.id).to.equal(originalPrompt.id);
						expect(preview.revisionId).to.equal(originalPrompt.revisionId); // Should be 1 as no updates made them new versions
					}
				}),
			);

			it(
				'should return an empty array if user has no prompts',
				runWithTestUserContext(async () => {
					const previews = await service.listPromptsForUser(TEST_USER_ID);
					expect(previews).to.be.an('array').that.is.empty;
				}),
			);
		});

		describe('deletePrompt', () => {
			it(
				'should delete a prompt and all its revisions',
				runWithTestUserContext(async () => {
					const data = getSamplePromptData('delete');
					const prompt = await service.createPrompt(data, TEST_USER_ID);
					// Create a second revision
					await service.updatePrompt(prompt.id, { name: 'Delete V2' }, TEST_USER_ID, true);

					await service.deletePrompt(prompt.id, TEST_USER_ID);

					const fetchedLatest = await service.getPrompt(prompt.id, TEST_USER_ID);
					expect(fetchedLatest).to.be.null;
					const fetchedV1 = await service.getPromptVersion(prompt.id, 1, TEST_USER_ID);
					expect(fetchedV1).to.be.null;
					const fetchedV2 = await service.getPromptVersion(prompt.id, 2, TEST_USER_ID);
					expect(fetchedV2).to.be.null;
				}),
			);

			it(
				'should throw an error if prompt does not exist when deleting',
				runWithTestUserContext(async () => {
					try {
						await service.deletePrompt('non-existent-delete-id', TEST_USER_ID);
						expect.fail('Should have thrown an error for deleting non-existent prompt');
					} catch (error: any) {
						expect(error.message).to.match(/not found|does not exist/i);
					}
				}),
			);
		});
	});
}
