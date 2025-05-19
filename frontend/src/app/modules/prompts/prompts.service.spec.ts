import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PromptsService } from './prompts.service';
import { PROMPT_API } from '#shared/api/prompts.api';
import type { Prompt, PromptPreview } from '#shared/model/prompts.model';
import type { PromptListSchemaModel, PromptSchemaModel, PromptCreatePayload, PromptUpdatePayload } from '#shared/schemas/prompts.schema';
import { signal } from '@angular/core';
import { of, firstValueFrom, filter, first } from 'rxjs';
import { ApplicationRef } from '@angular/core';

describe('PromptsService', () => {
  let service: PromptsService;
  let httpMock: HttpTestingController;

  const mockPromptList: PromptListSchemaModel = {
    prompts: [
      { id: '1', name: 'Prompt 1', tags: [], revisionId: 1, userId: 'user1', settings: {} },
      { id: '2', name: 'Prompt 2', tags: ['test'], revisionId: 1, userId: 'user1', settings: {} },
    ],
    hasMore: false
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
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('loadPrompts', () => {
    it('should fetch prompts and update the prompts signal', () => {
      service.loadPrompts().subscribe();

      const req = httpMock.expectOne(PROMPT_API.listPrompts.buildPath({}));
      expect(req.request.method).toBe('GET');
      req.flush(mockPromptList);

      expect(service.prompts()).toEqual(mockPromptList.prompts);
    });
  });

  describe('getPromptById', () => {
    it('should fetch a prompt by ID and update the selectedPrompt signal', () => {
      const promptId = '1';
      service.getPromptById(promptId).subscribe();

      const req = httpMock.expectOne(PROMPT_API.getPromptById.buildPath({ promptId }));
      expect(req.request.method).toBe('GET');
      req.flush(mockPromptSchemaModel);

      expect(service.selectedPrompt()).toEqual(mockPromptSchemaModel as Prompt);
    });
  });

  describe('createPrompt', () => {
    it('should send a POST request to create a prompt', () => {
      const payload: PromptCreatePayload = { name: 'New Prompt', messages: [{role: 'user', content: 'Hi'}], options: {} };
      service.createPrompt(payload).subscribe(response => {
        expect(response).toEqual(mockPromptSchemaModel);
      });

      const req = httpMock.expectOne(PROMPT_API.createPrompt.buildPath({}));
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(payload);
      req.flush(mockPromptSchemaModel);
    });
  });

  describe('updatePrompt', () => {
    it('should send a PATCH request to update a prompt', () => {
      const promptId = '1';
      const payload: PromptUpdatePayload = { name: 'Updated Prompt' };
      service.updatePrompt(promptId, payload).subscribe(response => {
        expect(response).toEqual(mockPromptSchemaModel);
      });

      const req = httpMock.expectOne(PROMPT_API.updatePrompt.buildPath({ promptId }));
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual(payload);
      req.flush(mockPromptSchemaModel);
    });
  });

  describe('deletePrompt', () => {
    it('should send a DELETE request and update signals on successful deletion of selected prompt', async () => {
        const promptIdToDelete = '1';
        const initialPrompts: PromptPreview[] = [
            { id: '1', name: 'Prompt 1', userId: 'user1', revisionId: 1, tags: [], settings: {} },
            { id: '2', name: 'Prompt 2', userId: 'user1', revisionId: 1, tags: [], settings: {} },
        ];
        const initialSelectedPrompt: Prompt = { id: '1', name: 'Prompt 1', messages: [{role: 'user', content: 'test'}], settings: {temperature: 1}, revisionId: 1, tags: [], userId: 'user1' };

        service['_prompts'].set(initialPrompts);
        service['_selectedPrompt'].set(initialSelectedPrompt);

        const deletePromise = firstValueFrom(service.deletePrompt(promptIdToDelete));

        const req = httpMock.expectOne(PROMPT_API.deletePrompt.buildPath({ promptId: promptIdToDelete }));
        expect(req.request.method).toBe('DELETE');
        req.flush(null, { status: 204, statusText: 'No Content' });

        await deletePromise;
        await firstValueFrom(TestBed.inject(ApplicationRef).isStable.pipe(filter(stable => stable), first()));

        expect(service.prompts()?.length).toBe(1);
        expect(service.prompts()?.find(p => p.id === promptIdToDelete)).toBeUndefined();
        expect(service.selectedPrompt()).toBeNull();
    });

    it('should update prompts signal when deleting a non-selected prompt', async () => {
        const promptIdToDelete = '2';
            const initialPrompts: PromptPreview[] = [
            { id: '1', name: 'Prompt 1', userId: 'user1', revisionId: 1, tags: [], settings: {} },
            { id: '2', name: 'Prompt 2', userId: 'user1', revisionId: 1, tags: [], settings: {} },
        ];
        const initialSelectedPrompt: Prompt = { id: '1', name: 'Prompt 1', messages: [{role: 'user', content: 'test'}], settings: {temperature: 1}, revisionId: 1, tags: [], userId: 'user1' };


        service['_prompts'].set(initialPrompts);
        service['_selectedPrompt'].set(initialSelectedPrompt);


        const deletePromise = firstValueFrom(service.deletePrompt(promptIdToDelete));

        const req = httpMock.expectOne(PROMPT_API.deletePrompt.buildPath({ promptId: promptIdToDelete }));
        req.flush(null, { status: 204, statusText: 'No Content' });

        await deletePromise;
        await firstValueFrom(TestBed.inject(ApplicationRef).isStable.pipe(filter(stable => stable), first()));

        expect(service.prompts()?.length).toBe(1);
        expect(service.prompts()?.[0].id).toBe('1');
        expect(service.selectedPrompt()?.id).toBe('1'); // Selected prompt should remain unchanged
    });
  });

  describe('clearSelectedPrompt', () => {
    it('should set selectedPrompt signal to null', () => {
      service['_selectedPrompt'].set(mockPrompt);
      expect(service.selectedPrompt()).not.toBeNull();

      service.clearSelectedPrompt();
      expect(service.selectedPrompt()).toBeNull();
    });
  });

  describe('setSelectedPromptFromPreview', () => {
    it('should set selectedPrompt to null if preview is null', () => {
      service['_selectedPrompt'].set(mockPrompt);
      service.setSelectedPromptFromPreview(null);
      expect(service.selectedPrompt()).toBeNull();
    });

    it('should call getPromptById and update selectedPrompt if preview is provided', (done) => {
      const preview: PromptPreview = { id: '123', name: 'Preview', tags:[], revisionId: 1, userId: 'user1', settings: {} };

      service.setSelectedPromptFromPreview(preview);

      const req = httpMock.expectOne(PROMPT_API.getPromptById.buildPath({ promptId: '123' }));
      expect(req.request.method).toBe('GET');
      req.flush(mockPromptSchemaModel); // This will trigger the tap operator in getPromptById

      // Wait for effects to propagate
      TestBed.inject(ApplicationRef).isStable.pipe(
          filter(stable => stable),
          first()
      ).subscribe(() => {
          expect(service.selectedPrompt()).toEqual(mockPromptSchemaModel as Prompt);
          done();
      });
    });
  });
});
