import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { NewAutonomousAgentComponent } from './new-autonomous-agent.component';
import { LlmService } from '../services/llm.service';
import { of } from 'rxjs';

describe('NewAutonomousAgentComponent', () => {
  let component: NewAutonomousAgentComponent;
  let fixture: ComponentFixture<NewAutonomousAgentComponent>;
  let llmServiceMock: Partial<LlmService>;

  beforeEach(async () => {
    llmServiceMock = {
      getLlms: () => of([]), // Mock getLlms to return an empty array or mock data
      clearCache: () => {},
    };

    await TestBed.configureTestingModule({
      imports: [
        NewAutonomousAgentComponent, // Import the standalone component
        NoopAnimationsModule,
        HttpClientTestingModule,
        RouterTestingModule,
        MatSnackBarModule,
      ],
      providers: [
        { provide: LlmService, useValue: llmServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NewAutonomousAgentComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
