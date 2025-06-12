import { Location } from '@angular/common';
import { CommonModule } from '@angular/common';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormArray, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import type { CodeReviewConfig, IExample } from '#shared/codeReview/codeReview.model';
import type { CodeReviewConfigCreate, CodeReviewConfigUpdate } from '#shared/codeReview/codeReview.schema';
import { CodeReviewServiceClient } from '../code-review.service';
import { CodeReviewEditComponent } from './code-review-edit.component';
import { CodeReviewEditPo } from './code-review-edit.component.po';

// Mock data
const mockExample: IExample = { code: 'console.log("hello");', reviewComment: 'Use logger.' };
const mockConfig: CodeReviewConfig = {
	id: '123',
	title: 'Test Config',
	enabled: true,
	description: 'Test Description',
	fileExtensions: { include: ['.ts'] },
	requires: { text: ['TODO'] },
	tags: ['test-tag'],
	projectPaths: ['/src'],
	examples: [mockExample],
};

describe('CodeReviewEditComponent', () => {
	let component: CodeReviewEditComponent;
	let fixture: ComponentFixture<CodeReviewEditComponent>;
	let po: CodeReviewEditPo;
	let mockCodeReviewService: jasmine.SpyObj<CodeReviewServiceClient>;
	let mockActivatedRoute: any;
	let mockRouter: jasmine.SpyObj<Router>;
	let mockLocation: jasmine.SpyObj<Location>;

	beforeEach(async () => {
		mockCodeReviewService = jasmine.createSpyObj('CodeReviewServiceClient', ['getCodeReviewConfig', 'createCodeReviewConfig', 'updateCodeReviewConfig']);
		mockRouter = jasmine.createSpyObj('Router', ['navigate']);
		mockLocation = jasmine.createSpyObj('Location', ['back']);

		mockActivatedRoute = {
			snapshot: {
				paramMap: jasmine.createSpyObj('paramMap', ['get']),
			},
		};
		(mockActivatedRoute.snapshot.paramMap.get as jasmine.Spy).and.returnValue(null);

		await TestBed.configureTestingModule({
			imports: [
				CommonModule,
				ReactiveFormsModule,
				HttpClientTestingModule,
				NoopAnimationsModule,
				RouterTestingModule,
				RouterModule, // Required for standalone component with routing elements
				MatFormFieldModule,
				MatInputModule,
				MatCheckboxModule,
				MatChipsModule,
				MatIconModule,
				MatButtonModule,
				MatProgressSpinnerModule,
				MatCardModule,
				CodeReviewEditComponent, // Standalone component
			],
			providers: [
				{ provide: CodeReviewServiceClient, useValue: mockCodeReviewService },
				{ provide: ActivatedRoute, useValue: mockActivatedRoute },
				{ provide: Router, useValue: mockRouter },
				{ provide: Location, useValue: mockLocation },
			],
		}).compileComponents();

		fixture = TestBed.createComponent(CodeReviewEditComponent);
		component = fixture.componentInstance;
		po = await CodeReviewEditPo.create(fixture);
		// Note: Add data-testid="page-header" to the h1 in component template for getPageTitleText to work via DOM.
		// For isLoadingIndicatorVisible and getErrorMessageText, ensure corresponding elements with data-testid exist.
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});

	describe('Initialization (ngOnInit)', () => {
		it('should display "Create" title and have empty form if id is not present', async () => {
			// ngOnInit is called by createComponent/detectChanges in beforeEach via PO.create
			// For pageTitle, assuming data-testid="page-header" is on the h1 tag
			// expect(await po.getPageTitleText()).toBe('Create Code Review Configuration');
			expect(component.pageTitle()).toBe('Create Code Review Configuration'); // Direct check if DOM not ready/preferred for this
			expect(component.configId()).toBeNull();
			expect(mockCodeReviewService.getCodeReviewConfig).not.toHaveBeenCalled();
			expect(await po.getTitleValue()).toEqual('');
		});

		it('should load config data, set form, and display "Edit" title if id is present', async () => {
			(mockActivatedRoute.snapshot.paramMap.get as jasmine.Spy).and.returnValue('test-id-1');
			mockCodeReviewService.getCodeReviewConfig.and.returnValue(of(mockConfig));

			component.ngOnInit(); // Manually trigger ngOnInit after setting up mocks for route
			await fixture.whenStable(); // Wait for async operations from ngOnInit
			fixture.detectChanges(); // Update view with loaded data

			// expect(await po.getPageTitleText()).toBe('Edit Code Review Configuration');
			expect(component.pageTitle()).toBe('Edit Code Review Configuration');
			expect(mockCodeReviewService.getCodeReviewConfig).toHaveBeenCalledWith('test-id-1');
			expect(await po.isLoadingIndicatorVisible()).toBeFalse(); // Assuming spinner hides
			expect(await po.getTitleValue()).toEqual(mockConfig.title);
			expect(await po.getExamplesCount()).toBe(mockConfig.examples.length);
			expect(await po.getFileExtensions()).toEqual(mockConfig.fileExtensions.include);
			expect(await po.getRequiresTexts()).toEqual(mockConfig.requires.text);
			expect(await po.getProjectPaths()).toEqual(mockConfig.projectPaths);
			expect(await po.getTags()).toEqual(mockConfig.tags);
		});

		it('should display error message if loading config data fails', async () => {
			(mockActivatedRoute.snapshot.paramMap.get as jasmine.Spy).and.returnValue('test-id-1');
			mockCodeReviewService.getCodeReviewConfig.and.returnValue(throwError(() => new Error('Load failed')));

			component.ngOnInit();
			await fixture.whenStable();
			fixture.detectChanges();

			expect(await po.isLoadingIndicatorVisible()).toBeFalse();
			// expect(await po.getErrorMessageText()).toBe('Error loading config data');
			expect(component.error()).toBe('Error loading config data'); // Direct check if DOM not ready/preferred
		});
	});

	describe('Form Operations', () => {
		beforeEach(async () => {
			// fixture.detectChanges() already called by po.create
		});

		it('should add an example to the form', async () => {
			const initialCount = await po.getExamplesCount();
			await po.clickAddExample();
			expect(await po.getExamplesCount()).toBe(initialCount + 1);
			expect(await po.getExampleCodeValue(initialCount)).toBe('');
		});

		it('should remove an example from the form', async () => {
			await po.clickAddExample(); // Add one
			await po.clickAddExample(); // Add another
			const initialCount = await po.getExamplesCount();
			await po.clickRemoveExample(0);
			expect(await po.getExamplesCount()).toBe(initialCount - 1);
		});

		it('should add a tag if value is provided', async () => {
			await po.addTag('new-tag');
			expect(await po.getTags()).toContain('new-tag');
		});

		it('should not add an empty tag', async () => {
			const initialTags = await po.getTags();
			await po.addTag('  ');
			expect(await po.getTags()).toEqual(initialTags);
		});

		it('should remove a tag', async () => {
			await po.addTag('tag1');
			await po.addTag('tag2');
			await po.removeTagFromList('tag1');
			expect(await po.getTags()).not.toContain('tag1');
			expect(await po.getTags()).toContain('tag2');
		});
	});

	describe('Saving Config (onSubmit)', () => {
		beforeEach(async () => {
			// Set up a valid form for create mode using PO methods
			await po.setTitle('New Config Title');
			await po.setEnabled(true);
			await po.setDescription('New Desc');
			await po.addFileExtension('.ts');
			await po.addFileExtension('.js');
			await po.addRequiresText('TODO');
			await po.addRequiresText('FIXME');
			await po.addProjectPath('/src/app');
			await po.addTag('new-tag');
			await po.clickAddExample();
			await po.setExampleCode(0, 'test code');
			await po.setExampleReviewComment(0, 'test comment');
		});

		it('should call createCodeReviewConfig with correct payload for new config and navigate', fakeAsync(async () => {
			mockCodeReviewService.createCodeReviewConfig.and.returnValue(of({ message: 'Created successfully' }));

			await po.clickSave();
			// expect(await po.isSaveButtonDisabled()).toBeTrue(); // Assuming isSaving disables it
			expect(component.isSaving()).toBeTrue(); // Check signal directly for isSaving state
			tick(); // For async operations like service call and navigation

			expect(mockCodeReviewService.createCodeReviewConfig).toHaveBeenCalledTimes(1);
			const createdArg = mockCodeReviewService.createCodeReviewConfig.calls.first().args[0] as CodeReviewConfigCreate;

			expect(createdArg.title).toBe('New Config Title');
			expect(createdArg.fileExtensions.include).toEqual(['.ts', '.js']);
			expect(createdArg.requires.text).toEqual(['TODO', 'FIXME']);
			// ... other assertions for payload

			expect(component.isSaving()).toBeFalse();
			expect(mockRouter.navigate).toHaveBeenCalledWith(['/ui/code-reviews']);
		}));

		it('should call updateCodeReviewConfig with correct payload for existing config and navigate', fakeAsync(async () => {
			component.configId.set('existing-id'); // Switch to edit mode
			await po.setTitle('Updated Title'); // Update a field

			mockCodeReviewService.updateCodeReviewConfig.and.returnValue(of({ message: 'Updated successfully' }));

			await po.clickSave();
			expect(component.isSaving()).toBeTrue();
			tick();

			expect(mockCodeReviewService.updateCodeReviewConfig).toHaveBeenCalledTimes(1);
			const [updatedId, updatedArg] = mockCodeReviewService.updateCodeReviewConfig.calls.first().args;

			expect(updatedId).toBe('existing-id');
			expect((updatedArg as CodeReviewConfigUpdate).title).toBe('Updated Title');

			expect(component.isSaving()).toBeFalse();
			expect(mockRouter.navigate).toHaveBeenCalledWith(['/ui/code-reviews']);
		}));

		it('should display error if create fails', fakeAsync(async () => {
			mockCodeReviewService.createCodeReviewConfig.and.returnValue(throwError(() => new Error('Create Save failed')));
			await po.clickSave();
			tick();

			expect(component.isSaving()).toBeFalse();
			// expect(await po.getErrorMessageText()).toBe('Error saving configuration');
			expect(component.error()).toBe('Error saving configuration');
			expect(mockRouter.navigate).not.toHaveBeenCalled();
		}));

		it('should display error if update fails', fakeAsync(async () => {
			component.configId.set('existing-id');
			fixture.detectChanges(); // reflect configId change
			mockCodeReviewService.updateCodeReviewConfig.and.returnValue(throwError(() => new Error('Update Save failed')));
			await po.clickSave();
			tick();

			expect(component.isSaving()).toBeFalse();
			// expect(await po.getErrorMessageText()).toBe('Error saving configuration');
			expect(component.error()).toBe('Error saving configuration');
			expect(mockRouter.navigate).not.toHaveBeenCalled();
		}));

		it('should not save if form is invalid and markAllAsTouched', async () => {
			await po.setTitle(''); // Make form invalid
			const markAllAsTouchedSpy = spyOn(component.editForm(), 'markAllAsTouched').and.callThrough();

			await po.clickSave();

			expect(markAllAsTouchedSpy).toHaveBeenCalled();
			expect(mockCodeReviewService.createCodeReviewConfig).not.toHaveBeenCalled();
			expect(mockCodeReviewService.updateCodeReviewConfig).not.toHaveBeenCalled();
			expect(await po.isSaveButtonDisabled()).toBeTrue(); // Save button should be disabled due to invalid form
			expect(component.isSaving()).toBeFalse();
		});
	});

	describe('goBack', () => {
		it('should call location.back()', async () => {
			await po.clickCancel();
			expect(mockLocation.back).toHaveBeenCalled();
		});
	});
});
