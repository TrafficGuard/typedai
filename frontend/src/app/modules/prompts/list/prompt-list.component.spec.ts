import { CommonModule, DatePipe } from '@angular/common';
import { type WritableSignal, signal } from '@angular/core';
import { type ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { ActivatedRoute, Router, RouterModule, convertToParamMap } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import { ApiListState } from 'app/core/api-state.types';
import { of, throwError, timer } from 'rxjs';
import { delay } from 'rxjs/operators';
import { PromptPreview } from '#shared/prompts/prompts.model';
import { PromptsService } from '../prompts.service';
import { PromptListComponent } from './prompt-list.component';
import { PromptListPo } from './prompt-list.po';
import { PROMPTS_ROUTES } from '../prompt.paths';

describe('PromptListComponent', () => {
	let component: PromptListComponent;
	let fixture: ComponentFixture<PromptListComponent>;
	let po: PromptListPo;
	let mockPromptsService: jasmine.SpyObj<PromptsService>;
	let mockFuseConfirmationService: jasmine.SpyObj<FuseConfirmationService>;
	let mockRouter: jasmine.SpyObj<Router>;
	let promptsStateSignal: WritableSignal<ApiListState<PromptPreview>>;

	const mockPrompts: PromptPreview[] = [
		{
			id: '1',
			name: 'Test Prompt 1',
			tags: ['test', 'tag1'],
			revisionId: 1,
			userId: 'user1',
			settings: { temperature: 0.7 },
			updatedAt: new Date('2023-10-27T10:00:00Z').getTime(),
		},
		{
			id: '2',
			name: 'Test Prompt 2',
			tags: [],
			revisionId: 1,
			userId: 'user1',
			settings: { temperature: 0.5, llmId: 'test-llm' },
			updatedAt: new Date('2023-10-26T15:30:00Z').getTime(),
		},
	];

	beforeEach(async () => {
		promptsStateSignal = signal<ApiListState<PromptPreview>>({ status: 'idle', data: null });

		mockPromptsService = jasmine.createSpyObj('PromptsService', ['refreshPrompts', 'deletePrompt'], {
			promptsState: promptsStateSignal.asReadonly(),
		});

		mockFuseConfirmationService = jasmine.createSpyObj('FuseConfirmationService', ['open']);
		mockRouter = jasmine.createSpyObj('Router', ['navigate']);

		await TestBed.configureTestingModule({
			imports: [PromptListComponent, RouterModule.forRoot([])],
			providers: [
				{ provide: PromptsService, useValue: mockPromptsService },
				{ provide: FuseConfirmationService, useValue: mockFuseConfirmationService },
				{ provide: Router, useValue: mockRouter },
				DatePipe,
				provideNoopAnimations(),
				{
					provide: ActivatedRoute,
					useValue: {
						snapshot: { paramMap: convertToParamMap({}) },
						paramMap: of(convertToParamMap({})),
					},
				},
			],
		}).compileComponents();

		fixture = TestBed.createComponent(PromptListComponent);
		component = fixture.componentInstance;
		po = await PromptListPo.create(fixture);
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});

	it('should call refreshPrompts on init, show loading state, then show prompts', fakeAsync(async () => {
		mockPromptsService.refreshPrompts.and.callFake(() => {
			promptsStateSignal.set({ status: 'loading', data: null });
			timer(100).subscribe(() => {
				promptsStateSignal.set({ status: 'success', data: mockPrompts });
			});
		});

		expect(await po.isLoading()).withContext('Should show loading view for initial idle state').toBeTrue();

		fixture.detectChanges(); // Triggers ngOnInit

		expect(mockPromptsService.refreshPrompts).toHaveBeenCalled();
		expect(await po.isLoading()).withContext('Should show loading view for loading state').toBeTrue();

		tick(100);
		await po.detectAndWait();

		expect(await po.isLoading()).toBeFalse();
		expect(await po.isTableVisible()).toBeTrue();
	}));

	it('should show an error message if refreshing prompts fails', fakeAsync(async () => {
		const error = new Error('Failed to load');
		mockPromptsService.refreshPrompts.and.callFake(() => {
			promptsStateSignal.set({ status: 'loading', data: null });
			timer(100).subscribe(() => {
				promptsStateSignal.set({ status: 'error', error });
			});
		});

		fixture.detectChanges(); // ngOnInit
		expect(await po.isLoading()).toBeTrue();

		tick(100);
		await po.detectAndWait();

		expect(await po.isLoading()).toBeFalse();
		expect(await po.isError()).toBeTrue();
		const errorText = await po.text('error-view');
		expect(errorText).toContain('Failed to load prompts.');
		expect(errorText).toContain(error.message);
	}));

	it('should display "No prompts found." when promptsState is success with null data', async () => {
		promptsStateSignal.set({ status: 'success', data: null });
		await po.detectAndWait();
		expect(await po.isNoPromptsViewVisible()).toBeTrue();
		const text = await po.text('no-prompts-view');
		expect(text).toContain('No prompts found.');
	});

	it('should display "No prompts found." when promptsState is success with an empty array', async () => {
		promptsStateSignal.set({ status: 'success', data: [] });
		await po.detectAndWait();
		expect(await po.isNoPromptsViewVisible()).toBeTrue();
		const text = await po.text('no-prompts-view');
		expect(text).toContain('No prompts found.');
	});

	it('should render a table of prompts when promptsState has data', async () => {
		promptsStateSignal.set({ status: 'success', data: mockPrompts });
		await po.detectAndWait();

		expect(await po.getRowCount()).toBe(mockPrompts.length);

		const firstRowText = await po.getRowText(0);
		expect(firstRowText).toContain(mockPrompts[0].name);
		expect(firstRowText).toContain(mockPrompts[0].tags.join(', '));
		expect(firstRowText).toContain('Oct 27, 2023');

		const secondRowText = await po.getRowText(1);
		expect(secondRowText).toContain(mockPrompts[1].name);
		expect(secondRowText).toContain('N/A');
	});

	it('should navigate to edit page on row click', async () => {
		promptsStateSignal.set({ status: 'success', data: mockPrompts });
		await po.detectAndWait();

		await po.clickRow(0);

		expect(mockRouter.navigate).toHaveBeenCalledWith(PROMPTS_ROUTES.edit(mockPrompts[0].id));
	});

	it('should navigate to edit page on edit button click', async () => {
		promptsStateSignal.set({ status: 'success', data: mockPrompts });
		await po.detectAndWait();

		await po.clickEdit(mockPrompts[0].id);

		expect(mockRouter.navigate).toHaveBeenCalledWith(PROMPTS_ROUTES.edit(mockPrompts[0].id));
	});

	it('should have a "New" button with correct routerLink', async () => {
		const link = await po.getAttribute('new-prompt-btn', 'ng-reflect-router-link');
		expect(link).toBe('../,new');
	});

	describe('deletePrompt', () => {
		const promptToDelete = mockPrompts[0];

		beforeEach(async () => {
			promptsStateSignal.set({ status: 'success', data: mockPrompts });
			await po.detectAndWait();
		});

		it('should call promptsService.deletePrompt and show spinner when confirmation is confirmed', fakeAsync(async () => {
			mockFuseConfirmationService.open.and.returnValue({
				afterClosed: () => of('confirmed'),
			} as MatDialogRef<any>);
			mockPromptsService.deletePrompt.and.returnValue(of(undefined).pipe(delay(50)));

			await po.clickDelete(promptToDelete.id);
			tick(); // for afterClosed observable

			expect(mockFuseConfirmationService.open).toHaveBeenCalled();
			expect(component.isDeletingSignal()).toBe(promptToDelete.id);

			await po.detectAndWait();
			expect(await po.isDeleteSpinnerVisible(promptToDelete.id))
				.withContext('Expected spinner to be visible during deletion')
				.toBeTrue();

			tick(50); // for deletePrompt observable
			await po.detectAndWait();

			expect(mockPromptsService.deletePrompt).toHaveBeenCalledWith(promptToDelete.id);
			expect(component.isDeletingSignal()).toBeNull();
			expect(await po.isDeleteSpinnerVisible(promptToDelete.id))
				.withContext('Expected spinner to be hidden after deletion')
				.toBeFalse();
		}));

		it('should NOT call promptsService.deletePrompt when confirmation is cancelled', fakeAsync(async () => {
			mockFuseConfirmationService.open.and.returnValue({
				afterClosed: () => of('cancelled'),
			} as MatDialogRef<any>);

			await po.clickDelete(promptToDelete.id);
			tick();

			expect(mockFuseConfirmationService.open).toHaveBeenCalled();
			expect(mockPromptsService.deletePrompt).not.toHaveBeenCalled();
			expect(component.isDeletingSignal()).toBeNull();
		}));

		it('should reset deleting signal if deletePrompt errors', fakeAsync(async () => {
			mockFuseConfirmationService.open.and.returnValue({
				afterClosed: () => of('confirmed'),
			} as MatDialogRef<any>);
			mockPromptsService.deletePrompt.and.returnValue(throwError(() => new Error('Deletion failed')));

			await po.clickDelete(promptToDelete.id);
			tick(); // for afterClosed

			expect(component.isDeletingSignal()).toBe(promptToDelete.id);

			tick(); // for deletePrompt observable to error out
			await po.detectAndWait();

			expect(component.isDeletingSignal()).toBeNull();
			expect(await po.isDeleteSpinnerVisible(promptToDelete.id)).toBeFalse();
		}));
	});
});
