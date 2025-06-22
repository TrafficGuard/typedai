import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms'; // Added ReactiveFormsModule
import { MatCheckboxModule } from '@angular/material/checkbox'; // Added MatCheckboxModule
import { MatFormFieldModule } from '@angular/material/form-field'; // Added MatFormFieldModule
import { MatInputModule } from '@angular/material/input'; // Added MatInputModule
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner'; // Added MatProgressSpinnerModule
import { MatSelectModule } from '@angular/material/select'; // Added MatSelectModule
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { UserService } from 'app/core/user/user.service';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { AgentContextApi } from '#shared/agent/agent.schema';
import { UserProfile } from '#shared/user/user.model';
import { ApiListState } from '../../../../core/api-state.types';
import { LLM as LlmModel, LlmService } from '../../../llm.service';
import { AgentService, AgentStartRequestData } from '../../agent.service';
import { NewAutonomousAgentComponent } from './new-autonomous-agent.component';
import { NewAutonomousAgentPo } from './new-autonomous-agent.component.po';

describe('NewAutonomousAgentComponent', () => {
	let component: NewAutonomousAgentComponent;
	let fixture: ComponentFixture<NewAutonomousAgentComponent>;
	let po: NewAutonomousAgentPo; // Added PO variable
	let llmServiceMock: jasmine.SpyObj<LlmService>;
	let userServiceMock: jasmine.SpyObj<UserService>;
	let agentServiceMock: jasmine.SpyObj<AgentService>;
	let snackBarMock: jasmine.SpyObj<MatSnackBar>;
	let routerMock: jasmine.SpyObj<Router>;
	let httpMock: HttpTestingController;
	let userProfileSubject: BehaviorSubject<UserProfile | null>;
	let mockAvailableFunctionsSignal: WritableSignal<ApiListState<string[]>>;

	const mockLlms: LlmModel[] = [
		{ id: 'openai:gpt-4o-mini', name: 'GPT-4o Mini', isConfigured: true },
		{ id: 'anthropic:claude-3-5-haiku', name: 'Claude 3.5 Haiku', isConfigured: true },
	];

	const mockFunctions = ['GitLab', 'GitHub', 'FileAccess']; // Note: component sorts these, so assertions should expect sorted order
});
