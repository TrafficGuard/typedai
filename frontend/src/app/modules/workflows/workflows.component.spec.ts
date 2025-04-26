// import { ComponentFixture, TestBed } from '@angular/core/testing';
// import { ReactiveFormsModule } from '@angular/forms';
// import { MaterialModule } from '@app/material.module';
// import { NoopAnimationsModule } from '@angular/platform-browser/animations';
// import { ActionsComponent } from './actions.component';
// import { CodeService } from '@app/shared/services/code.service';
// import { of, throwError } from 'rxjs';
//
// describe.skip('ActionsComponent', () => {
//   let component: ActionsComponent;
//   let fixture: ComponentFixture<ActionsComponent>;
//   let codeService: jest.Mocked<CodeService>;
//
//   beforeEach(async () => {
//     const codeServiceMock = {
//       runCodebaseQuery: jest.fn(),
//       getRepositories: jest.fn(),
//       runCodeEditWorkflow: jest.fn(),
//       selectFilesToEdit: jest.fn(),
//     };
//
//     await TestBed.configureTestingModule({
//       declarations: [ActionsComponent],
//       imports: [ReactiveFormsModule, MaterialModule, NoopAnimationsModule],
//       providers: [{ provide: CodeService, useValue: codeServiceMock }],
//     }).compileComponents();
//
//     codeService = TestBed.inject(CodeService) as jest.Mocked<CodeService>;
//   });
//
//   beforeEach(() => {
//     fixture = TestBed.createComponent(ActionsComponent);
//     component = fixture.componentInstance;
//     codeService.getRepositories.mockReturnValue(of(['repo1', 'repo2']));
//     fixture.detectChanges();
//   });
//
//   it('should create', () => {
//     expect(component).toBeTruthy();
//   });
//
//   it('should execute codebase query operation and update result', () => {
//     component.codeForm.setValue({
//       workingDirectory: 'repo1',
//       operationType: 'query',
//       input: 'test query',
//     });
//
//     codeService.runCodebaseQuery.mockReturnValue(of({ response: 'Query result' }));
//
//     component.onSubmit();
//
//     expect(codeService.runCodebaseQuery).toHaveBeenCalledWith('repo1', 'test query');
//     expect(component.result).toBe('Query result');
//     expect(component.isLoading).toBeFalsy();
//   });
//
//   it('should execute code edit workflow operation and update result', () => {
//     component.codeForm.setValue({
//       workingDirectory: 'repo1',
//       operationType: 'code',
//       input: 'edit requirements',
//     });
//
//     const mockResponse = { changes: ['file1.ts', 'file2.ts'] };
//     codeService.runCodeEditorImplementRequirements.mockReturnValue(of(mockResponse));
//
//     component.onSubmit();
//
//     expect(codeService.runCodeEditWorkflow).toHaveBeenCalledWith('repo1', 'edit requirements');
//     expect(component.result).toBe(JSON.stringify(mockResponse, null, 2));
//     expect(component.isLoading).toBeFalsy();
//   });
//
//   it('should execute select files operation and update result', () => {
//     component.codeForm.setValue({
//       workingDirectory: 'repo1',
//       operationType: 'selectFiles',
//       input: 'selection criteria',
//     });
//
//     const mockResponse = { selectedFiles: ['file1.ts', 'file2.ts'] };
//     codeService.selectFilesToEdit.mockReturnValue(of(mockResponse));
//
//     component.onSubmit();
//
//     expect(codeService.selectFilesToEdit).toHaveBeenCalledWith('repo1', 'selection criteria');
//     expect(component.result).toBe(JSON.stringify(mockResponse, null, 2));
//     expect(component.isLoading).toBeFalsy();
//   });
//
//   it('should handle errors during operation execution', () => {
//     component.codeForm.setValue({
//       workingDirectory: 'repo1',
//       operationType: 'query',
//       input: 'test query',
//     });
//
//     const errorMessage = 'API Error';
//     codeService.runCodebaseQuery.mockReturnValue(throwError(() => new Error(errorMessage)));
//
//     component.onSubmit();
//
//     expect(codeService.runCodebaseQuery).toHaveBeenCalledWith('repo1', 'test query');
//     expect(component.result).toBe(`Error during query operation: ${errorMessage}`);
//     expect(component.isLoading).toBeFalsy();
//   });
//
//   it('should handle invalid operation type', () => {
//     component.codeForm.setValue({
//       workingDirectory: 'repo1',
//       operationType: 'invalidType',
//       input: 'test input',
//     });
//
//     component.onSubmit();
//
//     expect(component.result).toBe('Error: Invalid operation type');
//     expect(component.isLoading).toBeFalsy();
//   });
// });
