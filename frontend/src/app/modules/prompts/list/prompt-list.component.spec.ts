import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { signal, WritableSignal } from '@angular/core';
import { of, throwError } from 'rxjs';

import { PromptListComponent } from './prompt-list.component';
import { PromptsService } from '../prompts.service';
import { PromptPreview } from '#shared/model/prompts.model';
import { provideNoopAnimations } from '@angular/platform-browser/animations'; // Import for animations

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
  let promptsSignal: WritableSignal<PromptPreview[] | null>;
  let consoleLogSpy: jasmine.Spy;

  const mockPrompts: PromptPreview[] = [
    { id: '1', name: 'Test Prompt 1', tags: ['test', 'tag1'], updatedAt: Date.now(), revisionId: 1, userId: 'user1' },
    { id: '2', name: 'Test Prompt 2', tags: [], updatedAt: Date.now() - 100000, revisionId: 1, userId: 'user1' },
  ];

  beforeEach(async () => {
    promptsSignal = signal<PromptPreview[] | null>(null);
    // Ensure all methods that could be called are spied on, even if not directly tested in every test
    mockPromptsService = jasmine.createSpyObj('PromptsService', ['loadPrompts', 'deletePrompt', 'getPromptById', 'setSelectedPromptFromPreview', 'clearSelectedPrompt'], {
      prompts: promptsSignal.asReadonly(), // Use the signal here
    });
    // Mock return value for deletePrompt as it's called in a placeholder way
    mockPromptsService.deletePrompt.and.returnValue(of(undefined));


    await TestBed.configureTestingModule({
      imports: [
        PromptListComponent, // Standalone component
      ],
      providers: [
        { provide: PromptsService, useValue: mockPromptsService },
        DatePipe, // DatePipe is used in the template
        provideNoopAnimations(), // For Material components that might use animations
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PromptListComponent);
    component = fixture.componentInstance;
    consoleLogSpy = spyOn(console, 'log'); // Spy on console.log for the placeholder delete
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display loading spinner initially and call loadPrompts on init', fakeAsync(() => {
    mockPromptsService.loadPrompts.and.returnValue(of(undefined).pipe(delay(100))); 
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
    expect(firstPromptEl.querySelector('.text-xs').textContent).toContain('Last Updated:');

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

  it('should call window.confirm and log on delete button click when confirmed', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    mockPromptsService.loadPrompts.and.returnValue(of(undefined));
    promptsSignal.set([mockPrompts[0]]);
    fixture.detectChanges();

    const deleteButton = fixture.nativeElement.querySelector('button[mattooltip="Delete Prompt (placeholder)"]');
    deleteButton.click();

    expect(window.confirm).toHaveBeenCalledWith('Are you sure you want to delete this prompt? (Placeholder)');
    expect(consoleLogSpy).toHaveBeenCalledWith('Attempting to delete prompt (placeholder):', mockPrompts[0].id);
    expect(mockPromptsService.deletePrompt).not.toHaveBeenCalled(); // As per current component implementation
  });

  it('should NOT call deletePrompt service method if confirmation is false', () => {
    spyOn(window, 'confirm').and.returnValue(false);
    mockPromptsService.loadPrompts.and.returnValue(of(undefined));
    promptsSignal.set([mockPrompts[0]]);
    fixture.detectChanges();

    const deleteButton = fixture.nativeElement.querySelector('button[mattooltip="Delete Prompt (placeholder)"]');
    deleteButton.click();

    expect(window.confirm).toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalledWith('Attempting to delete prompt (placeholder):', mockPrompts[0].id);
    expect(mockPromptsService.deletePrompt).not.toHaveBeenCalled();
  });
});
