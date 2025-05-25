import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { signal, WritableSignal } from '@angular/core';

import { AgentComponent } from './agent.component';
import { AgentService } from '../agent.service';
import { ApiEntityState, createApiEntityState } from '../../../../core/api-state.types'; // Adjusted path
import { AgentContextApi } from '#shared/schemas/agent.schema';

// Mocks
class MockAgentService {
  private _selectedAgentDetailsStateSignal: WritableSignal<ApiEntityState<AgentContextApi>>;
  readonly selectedAgentDetailsState;

  constructor() {
    this._selectedAgentDetailsStateSignal = createApiEntityState<AgentContextApi>();
    this.selectedAgentDetailsState = this._selectedAgentDetailsStateSignal.asReadonly();
  }
  loadAgentDetails(agentId: string): void { /* spy on this if needed */ }
  clearSelectedAgentDetails(): void { /* spy on this if needed */ }
  setAgentDetailsState(newState: ApiEntityState<AgentContextApi>) {
    this._selectedAgentDetailsStateSignal.set(newState);
  }
}

const mockActivatedRoute = {
  paramMap: of(new Map().set('id', 'test-agent-id')),
  snapshot: { // Component uses toSignal(this.route.paramMap...) so snapshot might not be strictly needed for agentId signal
    paramMap: new Map().set('id', 'test-agent-id')
  }
};

class MockMatSnackBar {
  open() { /* spy on this if needed */ }
}

describe.skip('AgentComponent', () => { // Skipped as per instructions
  let component: AgentComponent;
  let fixture: ComponentFixture<AgentComponent>;
  let mockAgentService: MockAgentService;

  beforeEach(async () => {
    mockAgentService = new MockAgentService();

    await TestBed.configureTestingModule({
      imports: [
        AgentComponent, // Standalone component
        NoopAnimationsModule, // For Material components if they render
      ],
      providers: [
        { provide: AgentService, useValue: mockAgentService },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: MatSnackBar, useClass: MockMatSnackBar },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentComponent);
    component = fixture.componentInstance;
    // fixture.detectChanges(); // Initial detectChanges often in 'it' block for components with async init or signal effects
  });

  it('should create', () => {
    fixture.detectChanges(); // Call detectChanges to trigger ngOnInit and effects
    expect(component).toBeTruthy();
  });

  // Example of another skipped test
  // it.skip('should call loadAgentDetails on init if agentId is available via route params', () => {
  //   const loadSpy = spyOn(mockAgentService, 'loadAgentDetails');
  //   fixture.detectChanges(); // Triggers effects
  //   expect(loadSpy).toHaveBeenCalledWith('test-agent-id');
  // });
});
