import { ComponentFixture, TestBed, waitForAsync, fakeAsync, tick } from '@angular/core/testing';
// ChangeDetectorRef is not typically injected directly into tests for standalone components with signals.
// import { ChangeDetectorRef } from '@angular/core';
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
  // let cdr: ChangeDetectorRef; // Not typically needed for direct injection in tests

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
        NoopAnimationsModule,
        AgentIterationsComponent, // Import standalone component
      ],
      providers: [
        { provide: AgentService, useClass: MockAgentService },
      ],
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(AgentIterationsComponent);
    component = fixture.componentInstance;
    agentService = TestBed.inject(AgentService) as unknown as MockAgentService;
    // cdr = fixture.debugElement.injector.get(ChangeDetectorRef); // Not typically needed
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load iterations when agentId input signal changes', fakeAsync(() => {
    const testAgentId = 'agent123';
    const mockIterationsData: AutonomousIteration[] = [mockIteration];
    spyOn(agentService, 'getAgentIterations').and.returnValue(of(mockIterationsData));

    component.agentId.set(testAgentId);
    tick(); // Allow effect to run and async operations to complete
    fixture.detectChanges();

    expect(agentService.getAgentIterations).toHaveBeenCalledWith(testAgentId);
    expect(component.iterations().length).toBe(1);
    expect(component.iterations()[0].summary).toBe('Test iteration summary');
    expect(component.isLoading()).toBe(false);
  }));

  it('should clear iterations when agentId input signal becomes null', fakeAsync(() => {
    component.agentId.set('oldAgentId');
    tick();
    fixture.detectChanges(); // Initial load

    component.iterations.set([mockIteration]); // Simulate existing data
    component.isLoading.set(false);
    component.errorLoading.set(null);

    component.agentId.set(null);
    tick(); // Allow effect to run
    fixture.detectChanges();

    expect(component.iterations().length).toBe(0);
    expect(component.isLoading()).toBe(false);
    expect(component.errorLoading()).toBe(null);
  }));

  it('should handle error when loading iterations', fakeAsync(() => {
    const testAgentId = 'agent123';
    spyOn(agentService, 'getAgentIterations').and.returnValue(throwError(() => new Error('Load error')));

    component.agentId.set(testAgentId);
    tick(); // Allow effect and async operations
    fixture.detectChanges();

    expect(agentService.getAgentIterations).toHaveBeenCalledWith(testAgentId);
    expect(component.iterations().length).toBe(0);
    expect(component.isLoading()).toBe(false);
    expect(component.errorLoading()).toBe('Failed to load iteration data.');
  }));

  it('trackByIteration should return a unique key', () => {
    const iteration: AutonomousIteration = { ...mockIteration, agentId: 'agentX', iteration: 5 };
    expect(component.trackByIteration(0, iteration)).toBe('agentX-5');
    // Create a new object that is definitely not AutonomousIteration for the fallback test
    const nonIterationObject: any = { someOtherProp: 'value' };
    expect(component.trackByIteration(1, nonIterationObject)).toBe('1');
  });

  it('hasError should correctly identify errors in FunctionCallResult', () => {
    const callWithError: FunctionCallResult = { function_name: 'test', parameters: {}, stdout: '', stderr: 'Error occurred' };
    const callWithoutError: FunctionCallResult = { function_name: 'test', parameters: {}, stdout: 'Success', stderr: '' };
    const callWithNullStderr: FunctionCallResult = { function_name: 'test', parameters: {}, stdout: 'Success', stderr: null as any };


    expect(component.hasError(callWithError)).toBeTrue();
    expect(component.hasError(callWithoutError)).toBeFalse();
    expect(component.hasError(callWithNullStderr)).toBeFalse();
  });

  it('toggleExpansion should toggle the correct expanded property', () => {
    const iteration: AutonomousIteration = { ...mockIteration }; // Create a mutable copy
    component.iterations.set([iteration]);
    fixture.detectChanges();

    expect(iteration['promptExpanded']).toBeUndefined();
    component.toggleExpansion(iteration, 'prompt');
    expect(iteration['promptExpanded']).toBeTrue();
    component.toggleExpansion(iteration, 'prompt');
    expect(iteration['promptExpanded']).toBeFalse();
  });

});
