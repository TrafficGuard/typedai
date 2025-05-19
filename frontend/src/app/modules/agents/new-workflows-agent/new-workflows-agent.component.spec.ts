import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';

import { NewWorkflowsAgentComponent } from './new-workflows-agent.component';
import { WorkflowsService } from '../../workflows/workflows.service';

describe('NewWorkflowsAgentComponent', () => {
  let component: NewWorkflowsAgentComponent;
  let fixture: ComponentFixture<NewWorkflowsAgentComponent>;
  let mockWorkflowsService: jasmine.SpyObj<WorkflowsService>;

  beforeEach(async () => {
    mockWorkflowsService = jasmine.createSpyObj('WorkflowsService', [
      'getRepositories',
      'runCodeEditorImplementRequirements',
      'runCodebaseQuery',
      'selectFilesToEdit',
    ]);

    // Default mock implementations
    mockWorkflowsService.getRepositories.and.returnValue(of(['repo1', 'repo2']));
    mockWorkflowsService.runCodeEditorImplementRequirements.and.returnValue(of({ result: 'code implemented' }));
    mockWorkflowsService.runCodebaseQuery.and.returnValue(of({ response: 'query response' }));
    mockWorkflowsService.selectFilesToEdit.and.returnValue(of({ files: ['file1.ts'] }));

    await TestBed.configureTestingModule({
      imports: [
        NewWorkflowsAgentComponent, // Import standalone component directly
        CommonModule,
        ReactiveFormsModule,
        MatFormFieldModule,
        MatSelectModule,
        MatIconModule,
        MatCardModule,
        MatProgressBarModule,
        MatInputModule,
        MatButtonModule,
        NoopAnimationsModule, // For Material components animations
      ],
      providers: [
        FormBuilder, // FormBuilder is usually provided by ReactiveFormsModule, but explicitly adding it is fine.
        { provide: WorkflowsService, useValue: mockWorkflowsService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NewWorkflowsAgentComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(); // Trigger ngOnInit
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize the form on ngOnInit', () => {
    expect(component.codeForm).toBeDefined();
    expect(component.codeForm.get('workingDirectory')).toBeDefined();
    expect(component.codeForm.get('workflowType')).toBeDefined();
    expect(component.codeForm.get('input')).toBeDefined();
  });

  it('should fetch repositories on init and patch workingDirectory if repos exist', () => {
    expect(mockWorkflowsService.getRepositories).toHaveBeenCalled();
    expect(component.repositories).toEqual(['repo1', 'repo2']);
    expect(component.codeForm.get('workingDirectory')?.value).toBe('repo1');
  });

  it('should handle error when fetching repositories', () => {
    mockWorkflowsService.getRepositories.and.returnValue(throwError(() => new Error('Fetch error')));
    component.ngOnInit(); // Re-initialize to trigger the error path
    fixture.detectChanges();
    expect(component.result).toContain('Error fetching repositories');
  });

  it('should return correct input label for "code" workflowType', () => {
    component.codeForm.patchValue({ workflowType: 'code' });
    expect(component.getInputLabel()).toBe('Requirements');
  });

  it('should return correct input label for "query" workflowType', () => {
    component.codeForm.patchValue({ workflowType: 'query' });
    expect(component.getInputLabel()).toBe('Query');
  });

  it('should return correct input label for "selectFiles" workflowType', () => {
    component.codeForm.patchValue({ workflowType: 'selectFiles' });
    expect(component.getInputLabel()).toBe('Requirements for File Selection');
  });

  it('should return default input label for unknown workflowType', () => {
    component.codeForm.patchValue({ workflowType: 'unknown' });
    expect(component.getInputLabel()).toBe('Input');
  });

  it('should not call executeOperation if form is invalid on submit', () => {
    spyOn(component as any, 'executeOperation'); // Spy on private method
    component.codeForm.get('input')?.setValue(''); // Make form invalid
    component.onSubmit();
    expect((component as any).executeOperation).not.toHaveBeenCalled();
    expect(component.isLoading).toBeFalse();
  });

  it('should call executeOperation if form is valid on submit', () => {
    spyOn(component as any, 'executeOperation');
    component.codeForm.patchValue({
      workingDirectory: 'repo1',
      workflowType: 'code',
      input: 'test input',
    });
    component.onSubmit();
    expect((component as any).executeOperation).toHaveBeenCalled();
    expect(component.isLoading).toBeTrue(); // isLoading is set before calling executeOperation
  });

  describe('#executeOperation', () => {
    beforeEach(() => {
      component.codeForm.patchValue({
        workingDirectory: 'repo1',
        input: 'test input',
      });
    });

    it('should call runCodeEditorImplementRequirements for "code" type', () => {
      component.codeForm.patchValue({ workflowType: 'code' });
      (component as any).executeOperation();
      expect(mockWorkflowsService.runCodeEditorImplementRequirements).toHaveBeenCalledWith('repo1', 'test input');
      expect(component.isLoading).toBeFalse(); // After observable completes
      expect(component.result).toBe(JSON.stringify({ result: 'code implemented' }, null, 2));
    });

    it('should call runCodebaseQuery for "query" type', () => {
      component.codeForm.patchValue({ workflowType: 'query' });
      (component as any).executeOperation();
      expect(mockWorkflowsService.runCodebaseQuery).toHaveBeenCalledWith('repo1', 'test input');
      expect(component.isLoading).toBeFalse();
      expect(component.result).toBe('query response');
    });

    it('should call selectFilesToEdit for "selectFiles" type', () => {
      component.codeForm.patchValue({ workflowType: 'selectFiles' });
      (component as any).executeOperation();
      expect(mockWorkflowsService.selectFilesToEdit).toHaveBeenCalledWith('repo1', 'test input');
      expect(component.isLoading).toBeFalse();
      expect(component.result).toBe(JSON.stringify({ files: ['file1.ts'] }, null, 2));
    });

    it('should handle invalid operation type in executeOperation', () => {
      component.codeForm.patchValue({ workflowType: 'invalidType' });
      (component as any).executeOperation();
      expect(component.result).toBe('Error: Invalid operation type');
      expect(component.isLoading).toBeFalse();
    });

    it('should handle error from service call in executeOperation', () => {
      const errorMessage = 'Service error';
      mockWorkflowsService.runCodeEditorImplementRequirements.and.returnValue(throwError(() => new Error(errorMessage)));
      component.codeForm.patchValue({ workflowType: 'code' });
      (component as any).executeOperation();
      expect(component.result).toBe(`Error during code operation: ${errorMessage}`);
      expect(component.isLoading).toBeFalse();
    });
  });
});
