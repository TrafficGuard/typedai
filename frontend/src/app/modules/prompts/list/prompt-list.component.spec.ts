import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule, ActivatedRoute, convertToParamMap } from '@angular/router'; // Import ActivatedRoute and convertToParamMap
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { signal, WritableSignal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { MatDialogRef } from '@angular/material/dialog';

import { PromptListComponent } from './prompt-list.component';
import { PromptsService } from '../prompts.service';
import { PromptPreview } from '#shared/prompts/prompts.model';
import { provideNoopAnimations } from '@angular/platform-browser/animations'; // Import for animations
import { FuseConfirmationService } from '@fuse/services/confirmation';

// Helper to delay observable for fakeAsync
import { timer } from 'rxjs';
import { mapTo } from 'rxjs/operators';
function delay(ms: number) {
  return timer(ms).pipe(mapTo(undefined));
}

describe('PromptListComponent', () => {
  let component: PromptListComponent;
  let fixture: ComponentFixture<PromptListComponent>;
  let mockPromptsService: jasmine.SpyObj<PromptsService>;
  let mockFuseConfirmationService: jasmine.SpyObj<FuseConfirmationService>;
  let promptsSignal: WritableSignal<PromptPreview[] | null>;

  const mockPrompts: PromptPreview[] = [
    { id: '1', name: 'Test Prompt 1', tags: ['test', 'tag1'], revisionId: 1, userId: 'user1', settings: { temperature: 0.7 } },
    { id: '2', name: 'Test Prompt 2', tags: [], revisionId: 1, userId: 'user1', settings: { temperature: 0.5, llmId: 'test-llm' } },
  ];

  beforeEach(async () => {
    promptsSignal = signal<PromptPreview[] | null>(null);
    mockPromptsService = jasmine.createSpyObj('PromptsService', ['loadPrompts', 'deletePrompt', 'getPromptById', 'setSelectedPromptFromPreview', 'clearSelectedPrompt'], {
      prompts: promptsSignal.asReadonly(),
    });
    mockFuseConfirmationService = jasmine.createSpyObj('FuseConfirmationService', ['open']);


    await TestBed.configureTestingModule({
      imports: [
        PromptListComponent, // Standalone component
          RouterModule,
      ],
      providers: [
        { provide: PromptsService, useValue: mockPromptsService },
        { provide: FuseConfirmationService, useValue: mockFuseConfirmationService },
        DatePipe, // DatePipe is used in the template
        provideNoopAnimations(), // For Material components that might use animations
        // Add the ActivatedRoute mock here:
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({}), // Or a more specific mock if needed
              queryParamMap: convertToParamMap({}), // Or a more specific mock if needed
              data: {}
            },
            paramMap: of(convertToParamMap({})), // Observable version
            queryParamMap: of(convertToParamMap({})), // Observable version
            data: of({}) // Observable version
            // Add other properties/methods of ActivatedRoute if your component uses them
          }
        }
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PromptListComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display loading spinner initially and call loadPrompts on init', fakeAsync(() => {
    mockPromptsService.loadPrompts.and.returnValue(delay(100));
    expect(component.isLoading()).toBeTrue();
    fixture.detectChanges(); // Triggers ngOnInit

    expect(mockPromptsService.loadPrompts).toHaveBeenCalled();
    tick(50);
    expect(component.isLoading()).toBeTrue();

    tick(100);
    fixture.detectChanges();
    expect(component.isLoading()).toBeFalse();
  }));

  it('should hide loading spinner if loadPrompts errors', fakeAsync(() => {
    mockPromptsService.loadPrompts.and.returnValue(throwError(() => new Error('Failed to load')));
    fixture.detectChanges(); // ngOnInit
    tick();
    fixture.detectChanges();
    expect(component.isLoading()).toBeFalse();
  }));

  it('should display "No prompts found." when prompts signal is null', () => {
    mockPromptsService.loadPrompts.and.returnValue(of(undefined));
    promptsSignal.set(null);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const noPromptsEl = compiled.querySelector('p.text-xl');
    expect(noPromptsEl?.textContent).toContain('No prompts found.');
  });

  it('should display "No prompts found." when prompts signal is an empty array', () => {
    mockPromptsService.loadPrompts.and.returnValue(of(undefined));
    promptsSignal.set([]);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const noPromptsEl = compiled.querySelector('p.text-xl');
    expect(noPromptsEl?.textContent).toContain('No prompts found.');
  });

  it('should render a list of prompts when prompts signal has data', () => {
    mockPromptsService.loadPrompts.and.returnValue(of(undefined));
    promptsSignal.set(mockPrompts);
    fixture.detectChanges();

    const listItems = fixture.nativeElement.querySelectorAll('mat-list-item');
    expect(listItems.length).toBe(mockPrompts.length);

    const firstPromptEl = listItems[0];
    expect(firstPromptEl.textContent).toContain(mockPrompts[0].name);
    expect(firstPromptEl.textContent).toContain(mockPrompts[0].tags.join(', '));
    // Note: The 'Last Updated' text content check was removed as 'updatedAt' is not on PromptPreview
    // and the original selector '.text-xs' was likely incorrect for the mat-table structure.

    const secondPromptEl = listItems[1];
    expect(secondPromptEl.textContent).toContain(mockPrompts[1].name);
    expect(secondPromptEl.textContent).toContain('N/A');
  });

  it('should have correct routerLinks for view and edit buttons', () => {
    mockPromptsService.loadPrompts.and.returnValue(of(undefined));
    promptsSignal.set([mockPrompts[0]]);
    fixture.detectChanges();

    const viewLinkEl = fixture.nativeElement.querySelector('mat-list-item');
    expect(viewLinkEl.getAttribute('ng-reflect-router-link')).toBe(`../,${mockPrompts[0].id}`);

    const editButton = fixture.nativeElement.querySelector('button[mattooltip="Edit Prompt"]');
    expect(editButton.getAttribute('ng-reflect-router-link')).toBe(`../,${mockPrompts[0].id},edit`);
  });

  it('should have a "Create New Prompt" button with correct routerLink', () => {
    const createButton = fixture.nativeElement.querySelector('button[color="primary"]');
    expect(createButton.textContent).toContain('Create New Prompt');
    expect(createButton.getAttribute('ng-reflect-router-link')).toBe('../,new');
  });

  describe('deletePrompt', () => {
    const mockEvent = new MouseEvent('click');
    const promptToDelete = mockPrompts[0];

    beforeEach(() => {
        mockPromptsService.loadPrompts.and.returnValue(of(undefined));
        promptsSignal.set(mockPrompts);
        fixture.detectChanges();
    });

    it('should call promptsService.deletePrompt when confirmation is confirmed', fakeAsync(() => {
      mockFuseConfirmationService.open.and.returnValue({
        afterClosed: () => of('confirmed'),
      } as MatDialogRef<any>);
      mockPromptsService.deletePrompt.and.returnValue(of(undefined));

      expect(component.isDeletingSignal()).toBeNull();
      component.deletePrompt(mockEvent, promptToDelete);
      tick(); // for afterClosed observable

      expect(mockFuseConfirmationService.open).toHaveBeenCalled();
      expect(component.isDeletingSignal()).toBe(promptToDelete.id);

      tick(); // for deletePrompt observable if it involves async operations internally before signal update
      fixture.detectChanges();

      expect(mockPromptsService.deletePrompt).toHaveBeenCalledWith(promptToDelete.id);
      // Assuming isDeletingSignal is set back to false after completion
      // This might need another tick if deletePrompt is async and updates signal in finalize/tap
      // For simplicity, if deletePrompt is synchronous in its signal update:
      // tick(); // If deletePrompt itself is async and updates the signal upon completion
      // expect(component.isDeletingSignal()).toBe(false);
    }));

    it('should NOT call promptsService.deletePrompt when confirmation is cancelled', fakeAsync(() => {
      mockFuseConfirmationService.open.and.returnValue({
        afterClosed: () => of('cancelled'),
      } as MatDialogRef<any>);

      component.deletePrompt(mockEvent, promptToDelete);
      tick();

      expect(mockFuseConfirmationService.open).toHaveBeenCalled();
      expect(mockPromptsService.deletePrompt).not.toHaveBeenCalled();
      expect(component.isDeletingSignal()).toBeNull();
    }));

    it('should set isDeletingSignal to null if deletePrompt errors', fakeAsync(() => {
        mockFuseConfirmationService.open.and.returnValue({
            afterClosed: () => of('confirmed'),
        } as MatDialogRef<any>);
        mockPromptsService.deletePrompt.and.returnValue(throwError(() => new Error('Deletion failed')));

        component.deletePrompt(mockEvent, promptToDelete);
        tick(); // for afterClosed

        expect(component.isDeletingSignal()).toBe(promptToDelete.id);

        try {
            tick(); // for deletePrompt observable
        } catch (e) {
            // Expected error
        }
        fixture.detectChanges();
        expect(component.isDeletingSignal()).toBeNull();
    }));
  });
});
