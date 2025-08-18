import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { PROMPT_API } from '#shared/prompts/prompts.api';
import { Prompt, PromptPreview } from '#shared/prompts/prompts.model';
import { PromptCreatePayload, PromptListSchemaModel, PromptSchemaModel, PromptUpdatePayload } from '#shared/prompts/prompts.schema';
import { PromptsService } from './prompts.service';

describe('PromptsService', () => {
	let service: PromptsService;
	let httpMock: HttpTestingController;

	const mockPromptList: PromptListSchemaModel = {
		prompts: [
			{ id: '1', name: 'Prompt 1', tags: [], revisionId: 1, userId: 'user1', settings: {} },
			{ id: '2', name: 'Prompt 2', tags: ['test'], revisionId: 1, userId: 'user1', settings: {} },
		],
		hasMore: false,
	};

	const mockPrompt: Prompt = {
		id: '1',
		name: 'Prompt 1',
		userId: 'user1',
		revisionId: 1,
		tags: [],
		messages: [{ role: 'user', content: 'Hello' }],
		settings: { temperature: 1.0 },
	};
	const mockPromptSchemaModel = mockPrompt as PromptSchemaModel;

	beforeEach(() => {
		TestBed.configureTestingModule({
			imports: [HttpClientTestingModule],
			providers: [PromptsService],
		});
		service = TestBed.inject(PromptsService);
		httpMock = TestBed.inject(HttpTestingController);

		// Handle the initial request made by the service constructor
		const initialReq = httpMock.expectOne(PROMPT_API.listPrompts.pathTemplate);
		initialReq.flush(mockPromptList);
	});

	afterEach(() => {
		httpMock.verify();
	});

	it('should be created and load initial prompts', () => {
		expect(service).toBeTruthy();
		const state = service.promptsState();
		expect(state.status).toBe('success');
		if (state.status === 'success') {
			expect(state.data).toEqual(mockPromptList.prompts);
		}
	});

	describe('refreshPrompts', () => {
		it('should fetch prompts and update the prompts BehaviorSubject', fakeAsync(() => {
			service.refreshPrompts();
			tick();

			const req = httpMock.expectOne(PROMPT_API.listPrompts.pathTemplate);
			expect(req.request.method).toBe('GET');
			req.flush(mockPromptList);
			tick();

			const state = service.promptsState();
			expect(state.status).toBe('success');
			if (state.status === 'success') {
				expect(state.data).toEqual(mockPromptList.prompts);
			}
		}));
	});

	describe('getPromptById', () => {
		it('should fetch a prompt by ID and update the selectedPrompt signal', fakeAsync(() => {
			const promptId = '1';
			service.getPromptById(promptId).subscribe();
			tick();

			const url = PROMPT_API.getPromptById.pathTemplate.replace(':promptId', promptId);
			const req = httpMock.expectOne(url);
			expect(req.request.method).toBe('GET');
			req.flush(mockPromptSchemaModel);
			tick();

			expect(service.selectedPrompt()).toEqual(mockPromptSchemaModel as Prompt);
		}));
	});

	describe('createPrompt', () => {
		it('should send a POST request to create a prompt', fakeAsync(() => {
			const payload: PromptCreatePayload = { name: 'New Prompt', messages: [{ role: 'user', content: 'Hi' }], options: {} };
			let responsePayload: PromptSchemaModel | undefined;
			service.createPrompt(payload).subscribe((response) => {
				responsePayload = response;
			});
			tick();

			const req = httpMock.expectOne(PROMPT_API.createPrompt.pathTemplate);
			expect(req.request.method).toBe('POST');
			expect(req.request.body).toEqual(payload);
			req.flush(mockPromptSchemaModel);
			tick();

			expect(responsePayload).toEqual(mockPromptSchemaModel);
		}));
	});

	describe('updatePrompt', () => {
		it('should send a PATCH request to update a prompt', fakeAsync(() => {
			const promptId = '1';
			const payload: PromptUpdatePayload = { name: 'Updated Prompt' };
			let responsePayload: PromptSchemaModel | undefined;
			service.updatePrompt(promptId, payload).subscribe((response) => {
				responsePayload = response;
			});
			tick();

			const url = PROMPT_API.updatePrompt.pathTemplate.replace(':promptId', promptId);
			const req = httpMock.expectOne(url);
			expect(req.request.method).toBe('PATCH');
			expect(req.request.body).toEqual(payload);
			req.flush(mockPromptSchemaModel);
			tick();

			expect(responsePayload).toEqual(mockPromptSchemaModel);
		}));
	});

	describe('deletePrompt', () => {
		it('should send a DELETE request and update signals on successful deletion of selected prompt', fakeAsync(() => {
			const promptIdToDelete = '1';
			const initialPrompts: PromptPreview[] = [
				{ id: '1', name: 'Prompt 1', userId: 'user1', revisionId: 1, tags: [], settings: {} },
				{ id: '2', name: 'Prompt 2', userId: 'user1', revisionId: 1, tags: [], settings: {} },
			];
			const initialSelectedPrompt: Prompt = {
				id: '1',
				name: 'Prompt 1',
				messages: [{ role: 'user', content: 'test' }],
				settings: { temperature: 1 },
				revisionId: 1,
				tags: [],
				userId: 'user1',
			};

			(service as any)._promptsState.set({ status: 'success', data: initialPrompts });
			service._selectedPrompt.set(initialSelectedPrompt);
			tick();

			service.deletePrompt(promptIdToDelete).subscribe();
			tick();

			const url = PROMPT_API.deletePrompt.pathTemplate.replace(':promptId', promptIdToDelete);
			const req = httpMock.expectOne(url);
			expect(req.request.method).toBe('DELETE');
			req.flush(null, { status: 204, statusText: 'No Content' });
			tick();

			const state = service.promptsState();
			expect(state.status).toBe('success');
			if (state.status === 'success') {
				expect(state.data.length).toBe(1);
				expect(state.data.find((p) => p.id === promptIdToDelete)).toBeUndefined();
			}
			expect(service.selectedPrompt()).toBeNull();
		}));

		it('should update prompts BehaviorSubject when deleting a non-selected prompt', fakeAsync(() => {
			const promptIdToDelete = '2';
			const initialPrompts: PromptPreview[] = [
				{ id: '1', name: 'Prompt 1', userId: 'user1', revisionId: 1, tags: [], settings: {} },
				{ id: '2', name: 'Prompt 2', userId: 'user1', revisionId: 1, tags: [], settings: {} },
			];
			const initialSelectedPrompt: Prompt = {
				id: '1',
				name: 'Prompt 1',
				messages: [{ role: 'user', content: 'test' }],
				settings: { temperature: 1 },
				revisionId: 1,
				tags: [],
				userId: 'user1',
			};

			(service as any)._promptsState.set({ status: 'success', data: initialPrompts });
			service._selectedPrompt.set(initialSelectedPrompt);
			tick();

			service.deletePrompt(promptIdToDelete).subscribe();
			tick();

			const url = PROMPT_API.deletePrompt.pathTemplate.replace(':promptId', promptIdToDelete);
			const req = httpMock.expectOne(url);
			req.flush(null, { status: 204, statusText: 'No Content' });
			tick();

			const state = service.promptsState();
			expect(state.status).toBe('success');
			if (state.status === 'success') {
				expect(state.data.length).toBe(1);
				expect(state.data[0].id).toBe('1');
			}
			expect(service.selectedPrompt()?.id).toBe('1'); // Selected prompt should remain unchanged
		}));
	});

	describe('clearSelectedPrompt', () => {
		it('should set selectedPrompt signal to null', fakeAsync(() => {
			service._selectedPrompt.set(mockPrompt);
			tick();
			expect(service.selectedPrompt()).not.toBeNull();

			service.clearSelectedPrompt();
			tick();
			expect(service.selectedPrompt()).toBeNull();
		}));
	});

	describe('setSelectedPromptFromPreview', () => {
		it('should set selectedPrompt to null if preview is null', fakeAsync(() => {
			service._selectedPrompt.set(mockPrompt);
			tick();
			service.setSelectedPromptFromPreview(null);
			tick();
			expect(service.selectedPrompt()).toBeNull();
		}));

		it('should call getPromptById and update selectedPrompt if preview is provided', fakeAsync(() => {
			const preview: PromptPreview = { id: '123', name: 'Preview', tags: [], revisionId: 1, userId: 'user1', settings: {} };

			service.setSelectedPromptFromPreview(preview);
			tick(); // Allow setSelectedPromptFromPreview to call getPromptById

			const url = PROMPT_API.getPromptById.pathTemplate.replace(':promptId', '123');
			const req = httpMock.expectOne(url);
			expect(req.request.method).toBe('GET');
			req.flush(mockPromptSchemaModel); // This will trigger the tap operator in getPromptById
			tick(); // Allow the tap operator and subscription in setSelectedPromptFromPreview to complete

			expect(service.selectedPrompt()).toEqual(mockPromptSchemaModel as Prompt);
		}));
	});
});
