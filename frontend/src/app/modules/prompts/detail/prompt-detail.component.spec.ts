    import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
    import { NoopAnimationsModule } from '@angular/platform-browser/animations';
    import { RouterTestingModule } from '@angular/router/testing';
    import { PromptsService } from '../prompts.service';
    import { PromptDetailComponent } from './prompt-detail.component';
    import { MatCardModule } from '@angular/material/card';
    import { MatChipsModule } from '@angular/material/chips';
    import { MatIconModule } from '@angular/material/icon';
    import { MatButtonModule } from '@angular/material/button';
    import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
    import { of } from 'rxjs';
    import { signal } from '@angular/core';
    import { FuseConfirmationService } from '@fuse/services/confirmation';
    import { ActivatedRoute, convertToParamMap } from '@angular/router';
    import type { Prompt } from '#shared/model/prompts.model';

    const mockPrompt: Prompt = {
      id: 'prompt1',
      userId: 'user1',
      revisionId: 1,
      name: 'Test Prompt Detail',
      tags: ['detail', 'test'],
      messages: [
        { role: 'user', content: 'User message with image' },
        { role: 'assistant', content: 'Assistant response' }
      ],
      settings: { llmId: 'llm-test', temperature: 0.5, maxOutputTokens: 100 }
    };

    describe('PromptDetailComponent', () => {
      let component: PromptDetailComponent;
      let fixture: ComponentFixture<PromptDetailComponent>;
      let mockPromptsService: any;
      let mockFuseConfirmationService: any;
      let mockActivatedRoute: any;

      beforeEach(waitForAsync(() => {
        mockPromptsService = {
          selectedPrompt: signal(null), // Initialize as signal
          deletePrompt: jasmine.createSpy('deletePrompt').and.returnValue(of(null))
        };
        // Set the signal value for the test
        mockPromptsService.selectedPrompt.set(mockPrompt);


        mockFuseConfirmationService = {
          open: jasmine.createSpy('open').and.returnValue({
            afterClosed: () => of('confirmed')
          })
        };

        mockActivatedRoute = {
          snapshot: { paramMap: convertToParamMap({ promptId: mockPrompt.id }) },
          data: of({ prompt: mockPrompt }) // Resolver provides the prompt
        };

        TestBed.configureTestingModule({
          imports: [
            PromptDetailComponent, // Standalone component
            NoopAnimationsModule,
            RouterTestingModule,
            MatCardModule,
            MatChipsModule,
            MatIconModule,
            MatButtonModule,
            MatProgressSpinnerModule
          ],
          providers: [
            { provide: PromptsService, useValue: mockPromptsService },
            { provide: FuseConfirmationService, useValue: mockFuseConfirmationService },
            { provide: ActivatedRoute, useValue: mockActivatedRoute }
          ]
        }).compileComponents();
      }));

      beforeEach(() => {
        fixture = TestBed.createComponent(PromptDetailComponent);
        component = fixture.componentInstance;
        fixture.detectChanges(); // This will trigger ngOnInit
      });

      it('should create', () => {
        expect(component).toBeTruthy();
      });

      it('should display prompt details after initialization', () => {
        // The prompt signal is set by the resolver via route.data
        // and ngOnInit subscribes to route.data
        expect(component.prompt()).toEqual(mockPrompt);
        expect(component.isLoading()).toBeFalse(); // Should be false after data is processed

        // Check if processedMessages are generated
        const processedMessages = component.processedMessages();
        expect(processedMessages.length).toBe(mockPrompt.messages.length);
        // Further checks on processedMessages content can be added here
      });

      describe.skip('Attachment Display Functionality', () => {
        it('should correctly process and display messages with image attachments', () => {
          // Modify mockPrompt to include UserContentExt with image parts
          // Check component.processedMessages()
          // Check DOM for img tags
        });

        it('should correctly process and display messages with file attachments', () => {
          // Modify mockPrompt to include UserContentExt with file parts
          // Check component.processedMessages()
          // Check DOM for file icons/links
        });

        it('should correctly process and display messages with mixed content (text, image, file)', () => {
          // Modify mockPrompt
          // Check component.processedMessages()
          // Check DOM
        });
      });
    });
