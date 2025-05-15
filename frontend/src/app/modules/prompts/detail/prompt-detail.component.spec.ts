import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter, Router, ActivatedRoute, convertToParamMap } from '@angular/router';
import { Location, CommonModule } from '@angular/common';
import { signal, WritableSignal, ChangeDetectorRef } from '@angular/core';
import { of } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { PromptDetailComponent } from './prompt-detail.component';
import { PromptsService } from '../prompts.service';
import type { Prompt } from '#shared/model/prompts.model';

import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';


const mockPrompt: Prompt = {
  id: 'prompt123',
  userId: 'user1',
  revisionId: 1,
  name: 'Test Prompt Detail',
  tags: ['test', 'detail'],
  messages: [
    { role: 'user', content: 'User message' },
    { role: 'assistant', content: 'Assistant response' },
  ],
  options: { temperature: 0.7, maxTokens: 100 },
  updatedAt: Date.now(),
};

class MockPromptsService {
  selectedPrompt: WritableSignal<Prompt | null> = signal(null);
  getPromptById = jasmine.createSpy('getPromptById').and.callFake((id: string) => {
    if (id === mockPrompt.id) {
      this.selectedPrompt.set(mockPrompt);
      return of(mockPrompt);
    }
    this.selectedPrompt.set(null);
    return of(null);
  });
  clearSelectedPrompt = jasmine.createSpy('clearSelectedPrompt');
}

describe('PromptDetailComponent', () => {
  let component: PromptDetailComponent;
  let fixture: ComponentFixture<PromptDetailComponent>;
  let router: Router;
  let location: Location;
  let promptsService: MockPromptsService;
  let activatedRouteMock: any;

  const setupComponent = (routeData: { prompt: Prompt | null } | null, params?: any) => {
    activatedRouteMock = {
        data: routeData ? of(routeData) : of({ prompt: null }), // Ensure data is always an observable
        snapshot: {
          paramMap: convertToParamMap(params || { promptId: mockPrompt.id })
        },
        parent: { snapshot: { url: [{ path: 'prompts' }] } }, // For relative navigation
        routeConfig: { path: ':promptId' }
    };

    TestBed.configureTestingModule({
      imports: [
        CommonModule,
        NoopAnimationsModule,
        MatProgressSpinnerModule,
        MatCardModule,
        MatButtonModule,
        MatIconModule,
        MatChipsModule,
        MatDividerModule,
        PromptDetailComponent
      ],
      providers: [
        provideRouter([]),
        { provide: PromptsService, useClass: MockPromptsService },
        { provide: ActivatedRoute, useValue: activatedRouteMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PromptDetailComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    location = TestBed.inject(Location);
    promptsService = TestBed.inject(PromptsService) as unknown as MockPromptsService;

    spyOn(router, 'navigate').and.stub();
    spyOn(location, 'back').and.stub();
  };


  it('should create', () => {
    setupComponent({ prompt: mockPrompt });
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should display loading spinner initially and then hide it', fakeAsync(() => {
    setupComponent(null); // Start with no data to ensure isLoading is true
    expect(component.isLoading()).toBe(true);
    //detectChanges might be too fast, let's check initial state then trigger data
    activatedRouteMock.data = of({ prompt: mockPrompt }); // Simulate data arriving
    promptsService.selectedPrompt.set(mockPrompt);

    fixture.detectChanges(); // ngOnInit called
    tick(); // Process route.data observable
    fixture.detectChanges(); // Update view after data processed

    expect(component.isLoading()).toBe(false);
    const spinner = fixture.nativeElement.querySelector('mat-spinner');
    expect(spinner).toBeNull();
  }));

  describe('Data Loading and Display', () => {
    it('should load and display prompt details when resolver provides data', fakeAsync(() => {
      setupComponent({ prompt: mockPrompt });
      // Simulate resolver has set this signal before component initializes fully with data
      promptsService.selectedPrompt.set(mockPrompt);

      fixture.detectChanges(); // ngOnInit
      tick(); // Process observables from route.data
      fixture.detectChanges(); // Update view

      expect(component.isLoading()).toBe(false);
      expect(component.prompt()).toEqual(mockPrompt);

      const titleElement: HTMLElement = fixture.nativeElement.querySelector('h1');
      expect(titleElement.textContent).toContain(mockPrompt.name);

      const tagElements = fixture.nativeElement.querySelectorAll('mat-chip');
      expect(tagElements.length).toBe(mockPrompt.tags.length);
      // Note: mat-chip content might have extra spaces or sub-elements.
      expect(tagElements[0].textContent?.trim()).toBe(mockPrompt.tags[0]);

      const messageElements = fixture.nativeElement.querySelectorAll('div.p-4.border.rounded-md.bg-gray-50');
      expect(messageElements.length).toBe(mockPrompt.messages.length);
      const firstMessageRole = messageElements[0].querySelector('span.font-semibold.capitalize');
      expect(firstMessageRole?.textContent?.toLowerCase()).toBe(mockPrompt.messages[0].role);
    }));

    it('should navigate to /prompts if resolver returns null for a promptId in URL', fakeAsync(() => {
      setupComponent({ prompt: null }, { promptId: 'nonexistent' });
      // Resolver sets selectedPrompt to null, which is the default for the mock
      // promptsService.selectedPrompt.set(null); // Already default

      fixture.detectChanges(); // ngOnInit
      tick(); // Process observables
      fixture.detectChanges();

      expect(component.isLoading()).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/prompts']);
    }));
  });

  describe('User Interactions', () => {
    beforeEach(fakeAsync(() => {
        setupComponent({ prompt: mockPrompt });
        promptsService.selectedPrompt.set(mockPrompt);
        fixture.detectChanges(); // ngOnInit
        tick();
        fixture.detectChanges();
    }));

    it('should navigate to edit page on editPrompt() call', () => {
      component.editPrompt();
      expect(router.navigate).toHaveBeenCalledWith(['../edit'], { relativeTo: TestBed.inject(ActivatedRoute) });
    });

    it('should call location.back() on goBack() call', () => {
      component.goBack();
      expect(location.back).toHaveBeenCalled();
    });

    it('should call editPrompt when edit button is clicked', () => {
        spyOn(component, 'editPrompt').and.callThrough();
        const editButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[color="primary"]');
        editButton.click();
        expect(component.editPrompt).toHaveBeenCalled();
    });

    it('should call goBack when back button is clicked', () => {
        spyOn(component, 'goBack').and.callThrough();
        // The back button is the first mat-stroked-button in the header
        const backButton: HTMLButtonElement = fixture.nativeElement.querySelector('.flex.justify-between.items-center button[mat-stroked-button]');
        backButton.click();
        expect(component.goBack).toHaveBeenCalled();
    });
  });

  it('should display "Prompt Not Found" message if prompt is null and not loading', fakeAsync(() => {
    setupComponent({ prompt: null }, {promptId: 'someid'});
    promptsService.selectedPrompt.set(null); // Ensure service state matches resolved data

    fixture.detectChanges(); // ngOnInit
    tick(); // process route.data
    fixture.detectChanges(); // update view

    expect(component.isLoading()).toBe(false);
    expect(component.prompt()).toBeNull();
    const notFoundMessageContainer: HTMLElement = fixture.nativeElement.querySelector('div.text-center');
    expect(notFoundMessageContainer).toBeTruthy();
    const notFoundMessage: HTMLElement = notFoundMessageContainer.querySelector('p.text-xl.font-medium') as HTMLElement;
    expect(notFoundMessage.textContent).toContain('Prompt Not Found');
  }));

  it('ngOnDestroy should complete the destroy subject', () => {
    setupComponent({ prompt: mockPrompt });
    fixture.detectChanges();
    // Access private member for spying
    const destroy$ = component['destroy$'];
    spyOn(destroy$, 'next').and.callThrough();
    spyOn(destroy$, 'complete').and.callThrough();

    component.ngOnDestroy();

    expect(destroy$.next).toHaveBeenCalled();
    expect(destroy$.complete).toHaveBeenCalled();
  });
});
