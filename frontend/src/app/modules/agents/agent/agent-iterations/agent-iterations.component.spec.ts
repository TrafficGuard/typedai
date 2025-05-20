import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AgentIterationsComponent } from './agent-iterations.component';
import { AgentService } from '../../services/agent.service';
import { AutonomousIteration } from '#shared/model/agent.model';
import { CommonModule } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatListModule } from '@angular/material/list';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { FunctionCallResult } from "#shared/model/llm.model";

// Mock AgentService
class MockAgentService {
  getAgentIterations(agentId: string) {
    return of([]); // Default mock response
  }
}

describe('AgentIterationsComponent', () => {
  let component: AgentIterationsComponent;
  let fixture: ComponentFixture<AgentIterationsComponent>;
  let agentService: MockAgentService;
  let cdr: ChangeDetectorRef;

  const mockIteration: AutonomousIteration = {
    agentId: 'test-agent',
    iteration: 1,
    cost: 0.01,
    summary: 'Test iteration summary',
    functions: ['TestFunction'],
    prompt: '<prompt>Test prompt</prompt>',
    images: [],
    expandedUserRequest: 'Expanded request',
    observationsReasoning: 'Observations and reasoning',
    agentPlan: '<plan>Test plan</plan>',
    nextStepDetails: 'Next step details',
    draftCode: 'print("draft")',
    codeReview: 'Looks good',
    code: 'print("final code")',
    executedCode: 'print("final code")',
    functionCalls: [{ function_name: 'func1', parameters: {}, stdout: 'output', stderr: '' } ],
    memory: { key1: 'value1' },
    toolState: { tool1: { state: 'active' }, LiveFiles: ['file1.txt'] },
    stats: { requestTime: 0, timeToFirstToken: 0, totalTime: 100, inputTokens: 10, outputTokens: 20, cost: 0, llmId: 'test-model' },
  };

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [
        CommonModule,
        MatExpansionModule,
        MatProgressSpinnerModule,
        MatListModule,
        MatCardModule,
        MatChipsModule,
        MatIconModule,
        MatTabsModule,
        NoopAnimationsModule,
        AgentIterationsComponent, // Import standalone component
      ],
      providers: [
        { provide: AgentService, useClass: MockAgentService },
        // ChangeDetectorRef is usually provided by Angular, but can be spied if needed
      ],
      // declarations: [AgentIterationsComponent] // Not needed for standalone
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(AgentIterationsComponent);
    component = fixture.componentInstance;
    agentService = TestBed.inject(AgentService) as unknown as MockAgentService;
    cdr = fixture.debugElement.injector.get(ChangeDetectorRef);
    // fixture.detectChanges(); // Initial detectChanges if needed, or call after setting inputs
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load iterations when agentId is set', () => {
    const testAgentId = 'agent123';
    const mockIterationsData: AutonomousIteration[] = [mockIteration];
    spyOn(agentService, 'getAgentIterations').and.returnValue(of(mockIterationsData));
    spyOn(cdr, 'markForCheck').and.callThrough();

    component.agentId = testAgentId;
    component.ngOnChanges({
      agentId: { currentValue: testAgentId, previousValue: null, firstChange: true, isFirstChange: () => true },
    });
    fixture.detectChanges();

    expect(agentService.getAgentIterations).toHaveBeenCalledWith(testAgentId);
    expect(component.iterations.length).toBe(1);
    expect(component.iterations[0].summary).toBe('Test iteration summary');
    expect(component.isLoading).toBe(false);
    expect(cdr.markForCheck).toHaveBeenCalled();
  });

  it('should handle empty agentId in ngOnChanges', () => {
    spyOn(cdr, 'markForCheck').and.callThrough();
    component.agentId = 'oldAgentId';
    component.iterations = [mockIteration]; // Simulate existing data

    component.ngOnChanges({
      agentId: { currentValue: null, previousValue: 'oldAgentId', firstChange: false, isFirstChange: () => false },
    });
    fixture.detectChanges();

    expect(component.iterations.length).toBe(0);
    expect(component.isLoading).toBe(false);
    expect(component.errorLoading).toBe(null);
    expect(cdr.markForCheck).toHaveBeenCalled();
  });

  it('should handle error when loading iterations', () => {
    const testAgentId = 'agent123';
    spyOn(agentService, 'getAgentIterations').and.returnValue(throwError(() => new Error('Load error')));
    spyOn(cdr, 'markForCheck').and.callThrough();

    component.agentId = testAgentId;
     component.ngOnChanges({
      agentId: { currentValue: testAgentId, previousValue: null, firstChange: true, isFirstChange: () => true },
    });
    fixture.detectChanges();

    expect(agentService.getAgentIterations).toHaveBeenCalledWith(testAgentId);
    expect(component.iterations.length).toBe(0);
    expect(component.isLoading).toBe(false);
    expect(component.errorLoading).toBe('Failed to load iteration data.');
    expect(cdr.markForCheck).toHaveBeenCalled();
  });

  it('trackByIteration should return a unique key', () => {
    const iteration: AutonomousIteration = { ...mockIteration, agentId: 'agentX', iteration: 5 };
    expect(component.trackByIteration(0, iteration)).toBe('agentX-5');
    expect(component.trackByIteration(1, { ...mockIteration, agentId: null, iteration: 0 } as any)).toBe('1'); // Fallback
  });

  it('hasError should correctly identify errors in FunctionCallResult', () => {
    const callWithError: FunctionCallResult = { function_name: 'test', parameters: {}, stdout: '', stderr: 'Error occurred' };
    const callWithoutError: FunctionCallResult = { function_name: 'test', parameters: {}, stdout: 'Success', stderr: '' };
    const callWithNullStderr: FunctionCallResult = { function_name: 'test', parameters: {}, stdout: 'Success', stderr: null as any };


    expect(component.hasError(callWithError)).toBeTrue();
    expect(component.hasError(callWithoutError)).toBeFalse();
    expect(component.hasError(callWithNullStderr)).toBeFalse();
  });

  // Add more tests for toggleExpansion, ngOnDestroy if necessary
  // For example, testing toggleExpansion:
  it('toggleExpansion should toggle the correct expanded property', () => {
    const iteration: AutonomousIteration = { ...mockIteration };
    component.iterations = [iteration];
    fixture.detectChanges();

    expect(iteration['promptExpanded']).toBeUndefined();
    component.toggleExpansion(iteration, 'prompt');
    expect(iteration['promptExpanded']).toBeTrue();
    component.toggleExpansion(iteration, 'prompt');
    expect(iteration['promptExpanded']).toBeFalse();
  });

});
