import { NO_ERRORS_SCHEMA, type Signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { FilePartExt, ImagePartExt, LlmInfo, LlmMessage, TextPart, UserContentExt } from '#shared/llm/llm.model';
import { Prompt } from '#shared/prompts/prompts.model';
import { PromptSchemaModel } from '#shared/prompts/prompts.schema';
import { ApiListState, createApiListState } from '../../../core/api-state.types';
import { LlmService } from '../../llm.service';
import { PromptsService } from '../prompts.service';
import { PromptFormComponent } from './prompt-form.component';
import { PromptFormPo } from './prompt-form.component.po';

const mockLlms: LlmInfo[] = [
	{ id: 'llm-1', name: 'LLM One', isConfigured: true },
	{ id: 'llm-2', name: 'LLM Two', isConfigured: true },
	{ id: 'llm-3', name: 'LLM Three (Not Configured)', isConfigured: false },
];

const mockPrompt: Prompt = {
	id: 'test-prompt-123',
	userId: 'user-1',
	revisionId: 1,
	name: 'Test Prompt',
	tags: ['test', 'sample'],
	messages: [
		{ role: 'user', content: 'Hello there' },
		{ role: 'assistant', content: 'Hi user!' },
	],
	settings: { temperature: 0.7, maxOutputTokens: 100, llmId: 'llm-1' },
};
const mockPromptSchema = mockPrompt as PromptSchemaModel;

xdescribe('PromptFormComponent', () => {
	let component: PromptFormComponent;
	let fixture: ComponentFixture<PromptFormComponent>;
	let po: PromptFormPo;
	let mockPromptsService: jasmine.SpyObj<PromptsService>;
	let mockLlmService: jasmine.SpyObj<Pick<LlmService, 'refreshLlms' | 'clearCache'>> & {
		loadLlms: jasmine.Spy;
		llmsState: Signal<ApiListState<LlmInfo>>;
	};
	let mockRouter: jasmine.SpyObj<Router>;
	let mockActivatedRoute: any;

	beforeEach(async () => {
		mockPromptsService = jasmine.createSpyObj('PromptsService', ['createPrompt', 'updatePrompt', 'getPromptById', 'clearSelectedPrompt']);

		const llmsStateSignal: WritableSignal<ApiListState<LlmInfo>> = createApiListState<LlmInfo>();
		const spiedMethods = jasmine.createSpyObj<Pick<LlmService, 'refreshLlms' | 'clearCache'>>('LlmService', ['refreshLlms', 'clearCache']);

		mockLlmService = {
			...spiedMethods,
			llmsState: llmsStateSignal.asReadonly(),
			loadLlms: jasmine.createSpy('loadLlms').and.callFake(() => {
				llmsStateSignal.set({ status: 'loading' });
				// Simulate async loading and state update
				Promise.resolve().then(() => {
					llmsStateSignal.set({ status: 'success', data: mockLlms });
				});
			}),
		};

		mockRouter = jasmine.createSpyObj('Router', {
			navigate: Promise.resolve(true), // Return a resolved promise
			getCurrentNavigation: null,
		});

		mockActivatedRoute = {
			snapshot: {
				paramMap: convertToParamMap({}),
				data: {},
			},
			data: of({}),
		};

		await TestBed.configureTestingModule({
			imports: [PromptFormComponent, NoopAnimationsModule, MatIconTestingModule],
			providers: [
				{ provide: PromptsService, useValue: mockPromptsService },
				{ provide: LlmService, useValue: mockLlmService },
				{ provide: Router, useValue: mockRouter },
				{ provide: ActivatedRoute, useValue: mockActivatedRoute },
				{ provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) },
			],
		}).compileComponents();
	});

	it('should create', async () => {
		mockActivatedRoute.data = of({ prompt: null });
		fixture = TestBed.createComponent(PromptFormComponent);
		component = fixture.componentInstance;
		po = await PromptFormPo.create(fixture);
		expect(component).toBeTruthy();
		expect(po).toBeTruthy();
	});

	describe('New Mode', () => {
		beforeEach(async () => {
			mockActivatedRoute.data = of({ prompt: null });
			mockActivatedRoute.snapshot.paramMap = convertToParamMap({});
			fixture = TestBed.createComponent(PromptFormComponent);
			component = fixture.componentInstance;
			po = await PromptFormPo.create(fixture);
		});

		it('should initialize form for new prompt with default LLM selected', async () => {
			expect(component.isEditMode()).toBeFalse();
			expect(await po.getName()).toBe('');
			const messages = await po.getMessagePanels();
			expect(messages.length).toBe(1);
			expect(await messages[0].getRole()).toBe('User');
			expect(await po.getSelectedModel()).toBe('LLM One');
			expect(await po.isGenerating()).toBeFalse();
		});

		it('should call promptsService.clearSelectedPrompt on initialization', () => {
			expect(mockPromptsService.clearSelectedPrompt).toHaveBeenCalled();
		});

		it('onSubmit should call promptsService.createPrompt with correct payload', async () => {
			mockPromptsService.createPrompt.and.returnValue(of(mockPromptSchema));
			const llmId = mockLlms.find((l) => l.isConfigured)!.id;

			await po.setName('New Prompt Name');
			await po.setTemperature(0.5);
			await po.setMaxTokens(500);
			await po.selectModel('LLM One');
			const panel = await po.getMessagePanel(0);
			await panel.setContent('User message');
			await po.addTag('newTag');

			await po.clickSave();

			expect(mockPromptsService.createPrompt).toHaveBeenCalledWith(
				jasmine.objectContaining({
					name: 'New Prompt Name',
					messages: [{ role: 'user', content: 'User message' }],
					tags: ['newTag'],
					settings: { temperature: 0.5, maxOutputTokens: 500, llmId: llmId },
				}),
			);
			expect(mockRouter.navigate).toHaveBeenCalledWith(['/ui/prompts']);
		});
	});

	describe('Edit Mode', () => {
		beforeEach(async () => {
			mockActivatedRoute.data = of({ prompt: mockPrompt });
			mockActivatedRoute.snapshot.paramMap = convertToParamMap({ promptId: mockPrompt.id });
			fixture = TestBed.createComponent(PromptFormComponent);
			component = fixture.componentInstance;
			po = await PromptFormPo.create(fixture);
		});

		it('should initialize form for edit prompt', async () => {
			expect(component.isEditMode()).toBeTrue();
			expect(component.promptIdSignal()).toBe(mockPrompt.id);
			expect(await po.getName()).toBe(mockPrompt.name);
			expect(await po.getSelectedModel()).toBe('LLM One');
			expect((await po.getMessagePanels()).length).toBe(mockPrompt.messages.length);
			expect(await po.getTags()).toEqual(mockPrompt.tags);
			expect(await po.isGenerating()).toBeFalse();
		});

		it('onSubmit should call promptsService.updatePrompt with correct payload', async () => {
			mockPromptsService.updatePrompt.and.returnValue(of(mockPromptSchema));
			const updatedName = 'Updated Prompt Name';
			await po.setName(updatedName);
			await po.clickSave();

			expect(mockPromptsService.updatePrompt).toHaveBeenCalledWith(
				mockPrompt.id,
				jasmine.objectContaining({
					name: updatedName,
					settings: jasmine.objectContaining({ llmId: mockPrompt.settings.llmId }),
				}),
			);
			expect(mockRouter.navigate).toHaveBeenCalledWith(['/ui/prompts']);
		});

		it('should navigate if promptId in params but resolver returns null', async () => {
			mockActivatedRoute.data = of({ prompt: null });
			mockActivatedRoute.snapshot.paramMap = convertToParamMap({ promptId: 'some-id-that-failed' });
			spyOn(console, 'error');

			fixture = TestBed.createComponent(PromptFormComponent);
			po = await PromptFormPo.create(fixture);

			expect(console.error).toHaveBeenCalledWith('Prompt not found for editing, navigating back.');
			expect(mockRouter.navigate).toHaveBeenCalledWith(['/ui/prompts']);
		});
	});

	describe('Form interactions', () => {
		beforeEach(async () => {
			mockActivatedRoute.data = of({ prompt: null });
			fixture = TestBed.createComponent(PromptFormComponent);
			po = await PromptFormPo.create(fixture);
		});

		it('should add and remove messages', async () => {
			await po.clickAddMessage();
			let panels = await po.getMessagePanels();
			expect(panels.length).toBe(2);
			expect(await panels[1].getRole()).toBe('Assistant');

			await panels[0].clickRemoveButton();
			panels = await po.getMessagePanels();
			expect(panels.length).toBe(1);
			expect(await panels[0].getRole()).toBe('Assistant');
		});

		it('should add and remove tags', async () => {
			await po.addTag('newTag');
			expect(await po.getTags()).toEqual(['newTag']);

			await po.removeTag('newTag');
			expect(await po.getTags()).toEqual([]);
		});

		it('should not submit if form is invalid', async () => {
			await po.setName(''); // Makes form invalid
			expect(await po.isSaveButtonDisabled()).toBeTrue();

			await po.clickSave();
			expect(mockPromptsService.createPrompt).not.toHaveBeenCalled();
			expect(mockPromptsService.updatePrompt).not.toHaveBeenCalled();
		});
	});

	describe('LLM Options Validation', () => {
		beforeEach(async () => {
			mockActivatedRoute.data = of({ prompt: null });
			fixture = TestBed.createComponent(PromptFormComponent);
			po = await PromptFormPo.create(fixture);
			await po.setName('A valid name'); // Ensure name is valid for these tests
		});

		it('save button should be disabled for invalid temperature', async () => {
			await po.setTemperature(-0.1);
			expect(await po.isSaveButtonDisabled()).toBeTrue();

			await po.setTemperature(2.1);
			expect(await po.isSaveButtonDisabled()).toBeTrue();

			await po.setTemperature(1.0);
			expect(await po.isSaveButtonDisabled()).toBeFalse();
		});

		it('save button should be disabled for invalid maxOutputTokens', async () => {
			await po.setMaxTokens(0);
			expect(await po.isSaveButtonDisabled()).toBeTrue();

			await po.setMaxTokens(64001);
			expect(await po.isSaveButtonDisabled()).toBeTrue();

			await po.setMaxTokens(2048);
			expect(await po.isSaveButtonDisabled()).toBeFalse();
		});
	});

	describe('LLM Options Parameters UI', () => {
		beforeEach(async () => {
			mockActivatedRoute.data = of({ prompt: null });
			fixture = TestBed.createComponent(PromptFormComponent);
			po = await PromptFormPo.create(fixture);
		});

		it('should render model selector dropdown', async () => {
			expect(await po.getSelectedModel()).toBe('LLM One');
		});

		it('temperature slider and input should be bound', async () => {
			await po.setTemperature(0.5);
			await po.detectAndWait();
			expect(await po.getTemperatureValue()).toBe('0.5');
		});

		it('maxOutputTokens slider and input should be bound', async () => {
			await po.setMaxTokens(1024);
			await po.detectAndWait();
			expect(await po.getMaxTokensValue()).toBe('1024');
		});
	});

	describe('populateForm message content handling', () => {
		const baseTestPromptSettings = {
			llmId: 'llm-1',
			temperature: 1.0,
			maxOutputTokens: 2048,
		};

		const createBasePrompt = (name: string, messages: LlmMessage[]): Prompt => ({
			id: `test-${name.toLowerCase().replace(/\s+/g, '-')}`,
			userId: 'test-user',
			revisionId: 1,
			name,
			tags: [],
			messages,
			settings: baseTestPromptSettings,
		});

		async function setupWithPrompt(prompt: Prompt) {
			mockActivatedRoute.data = of({ prompt });
			fixture = TestBed.createComponent(PromptFormComponent);
			po = await PromptFormPo.create(fixture);
		}

		it('should correctly populate message content when LlmMessage.content is a simple string', async () => {
			const testPrompt = createBasePrompt('Simple String Test', [{ role: 'user', content: 'Hello world' }]);
			await setupWithPrompt(testPrompt);
			const panel = await po.getMessagePanel(0);
			expect(await panel.getContent()).toBe('Hello world');
		});

		it('should correctly populate message content when LlmMessage.content is an array with only TextPart', async () => {
			const contentArray: TextPart[] = [
				{ type: 'text', text: 'First line.' },
				{ type: 'text', text: 'Second line.' },
			];
			const testPrompt = createBasePrompt('TextPart Array Test', [{ role: 'user', content: contentArray as UserContentExt }]);
			await setupWithPrompt(testPrompt);
			const panel = await po.getMessagePanel(0);
			expect(await panel.getContent()).toBe('First line.\n\nSecond line.');
		});

		it('should correctly populate message content with placeholder for ImagePartExt', async () => {
			const contentArray: ImagePartExt[] = [{ type: 'image', image: 'base64data', mediaType: 'image/png', filename: 'test.png' }];
			const testPrompt = createBasePrompt('ImagePart Filename Test', [{ role: 'user', content: contentArray as UserContentExt }]);
			await setupWithPrompt(testPrompt);
			const panel = await po.getMessagePanel(0);
			expect(await panel.getContent()).toBe('[Image: test.png]');
		});

		it('should correctly populate message content with placeholder for FilePartExt', async () => {
			const contentArray: FilePartExt[] = [{ type: 'file', data: 'base64data', mediaType: 'application/pdf', filename: 'document.pdf' }];
			const testPrompt = createBasePrompt('FilePart Filename Test', [{ role: 'user', content: contentArray as UserContentExt }]);
			await setupWithPrompt(testPrompt);
			const panel = await po.getMessagePanel(0);
			expect(await panel.getContent()).toBe('[File: document.pdf]');
		});

		it('should correctly populate message content with mixed parts (text, image, file)', async () => {
			const mixedContent: UserContentExt = [
				{ type: 'text', text: 'Here is an image:' },
				{ type: 'image', image: 'img_data', mediaType: 'image/gif', filename: 'anim.gif' },
				{ type: 'text', text: 'And a file:' },
				{ type: 'file', data: 'file_data', mediaType: 'application/zip', filename: 'archive.zip' },
			];
			const testPrompt = createBasePrompt('Mixed Parts Test', [{ role: 'user', content: mixedContent }]);
			await setupWithPrompt(testPrompt);
			const panel = await po.getMessagePanel(0);
			expect(await panel.getContent()).toBe('Here is an image:\n\n[Image: anim.gif]\n\nAnd a file:\n\n[File: archive.zip]');
		});

		it('should handle LlmMessage.content as an empty array', async () => {
			const testPrompt = createBasePrompt('Empty Array Content Test', [{ role: 'user', content: [] as UserContentExt }]);
			await setupWithPrompt(testPrompt);
			const panel = await po.getMessagePanel(0);
			expect(await panel.getContent()).toBe('');
		});
	});

	describe('Attachment Functionality', () => {
		beforeEach(async () => {
			mockActivatedRoute.data = of({ prompt: null });
			fixture = TestBed.createComponent(PromptFormComponent);
			po = await PromptFormPo.create(fixture);
		});

		it('should allow adding an attachment via file input', async () => {
			const file = new File(['file content'], 'test.txt', { type: 'text/plain' });
			await po.attachFile(0, file);
			const panel = await po.getMessagePanel(0);
			expect(await panel.getAttachmentNames()).toEqual(['test.txt']);
		});

		it('should allow removing an attachment', async () => {
			const file = new File(['file content'], 'test.txt', { type: 'text/plain' });
			await po.attachFile(0, file);
			let panel = await po.getMessagePanel(0);
			expect(await panel.getAttachmentNames()).toEqual(['test.txt']);

			await panel.removeAttachment(0);
			panel = await po.getMessagePanel(0);
			expect(await panel.getAttachmentNames()).toEqual([]);
		});
	});

	describe('Generate message', () => {
		describe('Clicking the generate button will attempt to generate a response', () => {
			it('On success it should display the result in the right hand pane', () => {});
			it('On success the "Add to Prompt" button displays, and when clicked adds the response to the prompt messages and clears the generated response', () => {});
		});

		describe('Generating a response when the last message in the prompt has the Assistant role i.e. Assistant prefill', () => {
			it('the last message should have the label "Assistant Prefill" instead of "Assistant"', () => {});
			it('when generated the generated message in the right pane will have the assistant prefill message appended with the generated result of the remainder of the assistant message', () => {});
		});
	});
});
