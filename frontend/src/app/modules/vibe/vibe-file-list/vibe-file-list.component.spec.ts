import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError, Subject } from 'rxjs';
import { take } from 'rxjs/operators';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { VibeFileListComponent } from './vibe-file-list.component';
import { VibeService } from '../vibe.service';
import { FileSystemNode, SelectedFile, VibeSession } from '../vibe.types';
import { VibeEditReasonDialogComponent } from '../vibe-edit-reason-dialog.component'; // Needed for MatDialog open check

// Material Modules used by the component
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SimpleChange } from '@angular/core';

// Helper functions
function createMockSession(id: string, status: VibeSession['status'], fileSelection?: SelectedFile[]): VibeSession {
    return {
        id,
        title: `Session ${id}`,
        status,
        instructions: 'Test instructions',
        repositorySource: 'local',
        repositoryId: '/test/repo',
        branch: 'main',
        useSharedRepos: false,
        fileSelection: fileSelection || [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

function createMockSelectedFile(filePath: string, reason?: string, category?: SelectedFile['category'], readOnly?: boolean): SelectedFile {
    return {
        filePath,
        reason: reason || `Reason for ${filePath}`,
        category: category || 'unknown',
        readOnly: readOnly || false,
    };
}

function createMockFileSystemNode(name: string, type: 'file' | 'directory', children?: FileSystemNode[], path?: string): FileSystemNode {
    const node: FileSystemNode = {
        name,
        type,
        path: path || name, // Simplified path for mock
    };
    if (children) {
        node.children = children;
    }
    return node;
}

function mockDialogRef(result: any): MatDialogRef<any> {
    return {
        afterClosed: () => of(result),
    } as MatDialogRef<any>;
}

describe('VibeFileListComponent', () => {
    let component: VibeFileListComponent;
    let fixture: ComponentFixture<VibeFileListComponent>;
    let mockVibeService: jasmine.SpyObj<VibeService>;
    let mockMatDialog: jasmine.SpyObj<MatDialog>;
    let mockMatSnackBar: jasmine.SpyObj<MatSnackBar>;
    let mockActivatedRoute: any;

    beforeEach(async () => {
        mockVibeService = jasmine.createSpyObj('VibeService', [
            'getFileSystemTree',
            'updateSession',
            'approveFileSelection',
            'updateFileSelection',
            'getVibeSession', // Though not directly used in current component code, good to have if refresh logic changes
            'resetFileSelection' // Added as per component's usage
        ]);
        mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
        mockMatSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
        mockActivatedRoute = { snapshot: { paramMap: convertToParamMap({}) } };

        await TestBed.configureTestingModule({
            imports: [
                VibeFileListComponent, // Standalone component
                CommonModule,
                FormsModule,
                ReactiveFormsModule,
                MatTableModule,
                MatIconModule,
                MatTooltipModule,
                MatDialogModule,
                MatSelectModule,
                MatFormFieldModule,
                MatInputModule,
                MatAutocompleteModule,
                MatButtonModule,
                TextFieldModule,
                MatProgressSpinnerModule,
                NoopAnimationsModule,
                MatSnackBarModule,
            ],
            providers: [
                { provide: VibeService, useValue: mockVibeService },
                { provide: MatDialog, useValue: mockMatDialog },
                { provide: MatSnackBar, useValue: mockMatSnackBar },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(VibeFileListComponent);
        component = fixture.componentInstance;
        // Default session for most tests, can be overridden
        component.session = createMockSession('default-id', 'file_selection_review', []);
        // Mock getFileSystemTree to prevent errors during initialization if ngOnChange is triggered early
        mockVibeService.getFileSystemTree.and.returnValue(of(createMockFileSystemNode('root', 'directory', [])));
        fixture.detectChanges(); // Initial data binding and ngOnInit
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('Component Initialization and Lifecycle Hooks', () => {
        describe('ngOnChanges', () => {
            it('should deep copy session.fileSelection to editableFileSelection on ngOnChanges', () => {
                const mockFile1 = createMockSelectedFile('file1.ts');
                const mockFile2 = createMockSelectedFile('file2.ts');
                const initialSession = createMockSession('sess-changes', 'file_selection_review', [mockFile1, mockFile2]);

                component.session = initialSession;
                component.ngOnChanges({
                    session: new SimpleChange(null, initialSession, true)
                });
                fixture.detectChanges();

                expect(component.editableFileSelection).toEqual(initialSession.fileSelection!);
                expect(component.editableFileSelection).not.toBe(initialSession.fileSelection!); // Ensure it's a copy

                component.editableFileSelection[0].reason = 'changed';
                expect(initialSession.fileSelection![0].reason).not.toBe('changed');
            });

            it('should set editableFileSelection to empty array if session is null on ngOnChanges', () => {
                const previousSession = createMockSession('prev-sess', 'file_selection_review', [createMockSelectedFile('file1.ts')]);
                component.session = null;
                component.ngOnChanges({
                    session: new SimpleChange(previousSession, null, false)
                });
                expect(component.editableFileSelection).toEqual([]);
            });

            it('should set editableFileSelection to empty array if session.fileSelection is null or undefined on ngOnChanges', () => {
                const sessionWithNullFiles = createMockSession('sess-null-files', 'file_selection_review', undefined);
                sessionWithNullFiles.fileSelection = null as any; // Test null
                component.session = sessionWithNullFiles;
                component.ngOnChanges({
                    session: new SimpleChange(null, sessionWithNullFiles, true)
                });
                expect(component.editableFileSelection).toEqual([]);

                const sessionWithUndefinedFiles = createMockSession('sess-undef-files', 'file_selection_review', undefined);
                component.session = sessionWithUndefinedFiles; // fileSelection is already undefined
                component.ngOnChanges({
                    session: new SimpleChange(null, sessionWithUndefinedFiles, true)
                });
                expect(component.editableFileSelection).toEqual([]);
            });
        });

        describe('ngOnInit and ngOnChange (custom)', () => {
            it('should initialize filteredFiles$ on ngOnInit', () => {
                expect(component.filteredFiles$).toBeDefined();
                component.addFileControl.setValue('test');
                component.filteredFiles$.pipe(take(1)).subscribe(files => {
                    // Assuming _filterFiles returns [] if allFiles is empty or no match
                    expect(files).toEqual([]);
                });
            });

            it('should populate allFiles and filteredFiles$ when ngOnChange (custom) is called with a valid session', fakeAsync(() => {
                const mockNode = createMockFileSystemNode('root', 'directory', [
                    createMockFileSystemNode('fileA.ts', 'file', [], 'root/fileA.ts'),
                    createMockFileSystemNode('fileB.ts', 'file', [], 'root/fileB.ts')
                ]);
                mockVibeService.getFileSystemTree.and.returnValue(of(mockNode));
                component.session = createMockSession('sess-tree', 'file_selection_review');

                component.ngOnChange(); // Manually call the custom method
                tick(); // Allow observables to resolve if any async operations were involved (though getFileSystemTree is of())
                fixture.detectChanges();

                expect(mockVibeService.getFileSystemTree).toHaveBeenCalledWith('sess-tree');
                expect(component.allFiles).toContain('root/fileA.ts');
                expect(component.allFiles).toContain('root/fileB.ts');

                component.addFileControl.setValue('root/fileA');
                fixture.detectChanges(); // Trigger valueChanges for autocomplete

                let filtered: string[] = [];
                component.filteredFiles$.pipe(take(1)).subscribe(files => filtered = files);
                expect(filtered).toContain('root/fileA.ts');
                expect(filtered.length).toBe(1); // Assuming exact match or limited results
            }));
        });
    });

    describe('Local State Operations (Modifying editableFileSelection)', () => {
        it('deleteFile should remove a writable file from editableFileSelection and show snackbar', () => {
            const fileToRemove = createMockSelectedFile('file1.ts', 'reason', 'edit', false);
            component.editableFileSelection = [fileToRemove, createMockSelectedFile('file2.ts')];
            component.deleteFile(fileToRemove);
            expect(component.editableFileSelection.length).toBe(1);
            expect(component.editableFileSelection.find(f => f.filePath === 'file1.ts')).toBeUndefined();
            expect(mockMatSnackBar.open).toHaveBeenCalledWith(jasmine.stringMatching(/removed locally/), 'Close', { duration: 3000 });
        });

        it('deleteFile should NOT remove a readOnly file', () => {
            const readOnlyFile = createMockSelectedFile('file1.ts', 'reason', 'edit', true);
            component.editableFileSelection = [readOnlyFile];
            component.deleteFile(readOnlyFile);
            expect(component.editableFileSelection.length).toBe(1);
            expect(mockMatSnackBar.open).not.toHaveBeenCalled();
        });

        it('editReason should update file reason and category from dialog and show snackbar', () => {
            const fileToEdit = createMockSelectedFile('file.ts', 'old reason', 'edit');
            component.editableFileSelection = [fileToEdit];
            const dialogResult = { reason: 'new reason', category: 'reference' as SelectedFile['category'] };
            mockMatDialog.open.and.returnValue(mockDialogRef(dialogResult));

            component.editReason(fileToEdit);

            expect(mockMatDialog.open).toHaveBeenCalledWith(VibeEditReasonDialogComponent, jasmine.any(Object));
            expect(component.editableFileSelection[0].reason).toBe('new reason');
            expect(component.editableFileSelection[0].category).toBe('reference');
            expect(mockMatSnackBar.open).toHaveBeenCalledWith(jasmine.stringMatching(/updated locally/), 'Close', { duration: 3000 });
        });

        it('editReason should not open dialog if component isReadOnly', () => {
            spyOnProperty(component, 'isReadOnly', 'get').and.returnValue(true);
            component.editReason(createMockSelectedFile('file.ts'));
            expect(mockMatDialog.open).not.toHaveBeenCalled();
        });

        it('onCategoryChange should update file category and show snackbar', () => {
            const fileToChange = createMockSelectedFile('file.ts', 'reason', 'edit');
            component.editableFileSelection = [fileToChange];
            component.onCategoryChange(fileToChange, 'style_example');
            expect(component.editableFileSelection[0].category).toBe('style_example');
            expect(component.editingCategoryFilePath).toBeNull();
            expect(mockMatSnackBar.open).toHaveBeenCalledWith(jasmine.stringMatching(/category for .* updated locally/i), 'Close', { duration: 3000 });
        });

        describe('onHandleAddFile', () => {
            beforeEach(() => {
                component.session = createMockSession('sess-add', 'file_selection_review');
            });

            it('should add file via dialog, update editableFileSelection, reset control, and show snackbar', () => {
                component.addFileControl.setValue('new_file.ts');
                const dialogResult = { reason: 'added file', category: 'unknown' as SelectedFile['category'] };
                mockMatDialog.open.and.returnValue(mockDialogRef(dialogResult));

                component.onHandleAddFile();

                expect(mockMatDialog.open).toHaveBeenCalled();
                const addedFile = component.editableFileSelection.find(f => f.filePath === 'new_file.ts');
                expect(addedFile).toBeDefined();
                expect(addedFile?.reason).toBe('added file');
                expect(addedFile?.category).toBe('unknown');
                expect(component.addFileControl.value).toBe('');
                expect(mockMatSnackBar.open).toHaveBeenCalledWith(jasmine.stringMatching(/added locally/), 'Close', { duration: 3000 });
            });

            it('should show snackbar if file to add already exists in editableFileSelection', () => {
                component.editableFileSelection = [createMockSelectedFile('existing.ts')];
                component.addFileControl.setValue('existing.ts');
                component.onHandleAddFile();
                expect(mockMatDialog.open).not.toHaveBeenCalled();
                expect(mockMatSnackBar.open).toHaveBeenCalledWith(jasmine.stringMatching(/already in the local selection/), 'Close', { duration: 3000 });
            });

            it('should show snackbar if session is not loaded on onHandleAddFile', () => {
                component.session = null;
                component.addFileControl.setValue('any_file.ts');
                component.onHandleAddFile();
                expect(mockMatSnackBar.open).toHaveBeenCalledWith('Session not loaded. Cannot add file.', 'Close', { duration: 3000 });
            });
        });

        describe('handleBrowseFilesRequest', () => {
            beforeEach(() => {
                component.rootNode = createMockFileSystemNode('root', 'directory'); // Ensure rootNode is not null
            });

            it('should add new files from browse dialog to editableFileSelection and show snackbar', () => {
                component.editableFileSelection = [createMockSelectedFile('existing.ts')];
                mockMatDialog.open.and.returnValue(mockDialogRef(['new_file.ts', 'another_new.ts', 'existing.ts']));
                component.handleBrowseFilesRequest();

                expect(mockMatDialog.open).toHaveBeenCalled();
                expect(component.editableFileSelection.length).toBe(3);
                expect(component.editableFileSelection.some(f => f.filePath === 'new_file.ts')).toBeTrue();
                expect(mockMatSnackBar.open).toHaveBeenCalledWith('2 file(s) added to selection. Remember to save changes.', 'Close', { duration: 3000 });
            });

            it('should show snackbar if no new files selected from browse dialog (all exist or empty selection)', () => {
                component.editableFileSelection = [createMockSelectedFile('existing.ts')];
                mockMatDialog.open.and.returnValue(mockDialogRef(['existing.ts']));
                component.handleBrowseFilesRequest();
                expect(mockMatSnackBar.open).toHaveBeenCalledWith('Selected file(s) are already in the list or no new files were chosen.', 'Close', { duration: 3000 });

                mockMatDialog.open.and.returnValue(mockDialogRef([])); // Empty selection
                component.handleBrowseFilesRequest();
                expect(mockMatSnackBar.open).toHaveBeenCalledWith('No files selected from browser.', 'Close', {duration: 2000});
            });


            it('should show snackbar if browse dialog is cancelled (returns undefined)', () => {
                mockMatDialog.open.and.returnValue(mockDialogRef(undefined)); // Dialog cancelled
                spyOn(console, 'log');
                component.handleBrowseFilesRequest();
                expect(console.log).toHaveBeenCalledWith('File selection dialog was cancelled.');
                // Check that no "files added" snackbar was shown
                expect(mockMatSnackBar.open.calls.all().some(call => call.args[0].includes('file(s) added'))).toBeFalse();
            });

            it('should show snackbar if rootNode is not loaded for handleBrowseFilesRequest', () => {
                component.rootNode = null as any;
                component.handleBrowseFilesRequest();
                expect(mockMatDialog.open).not.toHaveBeenCalled();
                expect(mockMatSnackBar.open).toHaveBeenCalledWith('File tree data is not loaded yet. Please wait.', 'Close', { duration: 3000 });
            });
        });
    });

    describe('hasUnsavedChanges()', () => {
        it('should return true if session is null and editableFileSelection has items', () => {
            component.session = null;
            component.editableFileSelection = [createMockSelectedFile('file1.ts')];
            expect(component.hasUnsavedChanges()).toBeTrue();
        });

        it('should return false if editableFileSelection is identical to session.fileSelection', () => {
            const files = [createMockSelectedFile('a.ts', 'r', 'edit'), createMockSelectedFile('b.ts', undefined, 'unknown')];
            component.session = createMockSession('s1', 'file_selection_review', [...files].reverse()); // Different order initially
            component.editableFileSelection = [...files]; // Same content
            expect(component.hasUnsavedChanges()).toBeFalse();
        });

        it('should return true if editableFileSelection has different content from session.fileSelection (e.g., reason changed)', () => {
            const sessionFiles = [createMockSelectedFile('a.ts', 'reason1', 'edit')];
            const localFiles = [createMockSelectedFile('a.ts', 'reason2', 'edit')];
            component.session = createMockSession('s1', 'file_selection_review', sessionFiles);
            component.editableFileSelection = localFiles;
            expect(component.hasUnsavedChanges()).toBeTrue();
        });

         it('should return true if a file was added locally', () => {
            const sessionFiles = [createMockSelectedFile('a.ts')];
            const localFiles = [createMockSelectedFile('a.ts'), createMockSelectedFile('b.ts')];
            component.session = createMockSession('s1', 'file_selection_review', sessionFiles);
            component.editableFileSelection = localFiles;
            expect(component.hasUnsavedChanges()).toBeTrue();
        });

        it('should return true if a file was removed locally', () => {
            const sessionFiles = [createMockSelectedFile('a.ts'), createMockSelectedFile('b.ts')];
            const localFiles = [createMockSelectedFile('a.ts')];
            component.session = createMockSession('s1', 'file_selection_review', sessionFiles);
            component.editableFileSelection = localFiles;
            expect(component.hasUnsavedChanges()).toBeTrue();
        });
    });

    describe('onSaveFileSelectionChanges()', () => {
        it('should call VibeService.updateSession if hasUnsavedChanges is true, update session locally, and show snackbar', () => {
            component.session = createMockSession('s-save', 'file_selection_review', [createMockSelectedFile('old.ts')]);
            const newSelection = [createMockSelectedFile('new.ts')];
            component.editableFileSelection = newSelection; // Makes hasUnsavedChanges true
            mockVibeService.updateSession.and.returnValue(of({ ...component.session!, fileSelection: newSelection }));

            component.onSaveFileSelectionChanges();

            expect(component.isProcessingAction).toBeFalse(); // after finalize
            expect(mockVibeService.updateSession).toHaveBeenCalledWith('s-save', { fileSelection: newSelection });
            expect(component.session!.fileSelection).toEqual(newSelection);
            expect(mockMatSnackBar.open).toHaveBeenCalledWith('File selection changes saved successfully.', 'Close', { duration: 3000 });
        });

        it('should NOT call VibeService.updateSession if hasUnsavedChanges is false and show snackbar', () => {
            const currentFiles = [createMockSelectedFile('file.ts')];
            component.session = createMockSession('s-nosave', 'file_selection_review', currentFiles);
            component.editableFileSelection = JSON.parse(JSON.stringify(currentFiles)); // Makes hasUnsavedChanges false
            component.onSaveFileSelectionChanges();
            expect(mockVibeService.updateSession).not.toHaveBeenCalled();
            expect(mockMatSnackBar.open).toHaveBeenCalledWith('No changes to save.', 'Close', { duration: 2000 });
        });

        it('should handle error from VibeService.updateSession and show snackbar', () => {
            component.session = createMockSession('s-save-err', 'file_selection_review', []);
            component.editableFileSelection = [createMockSelectedFile('new.ts')];
            mockVibeService.updateSession.and.returnValue(throwError(() => new Error('Save failed')));
            component.onSaveFileSelectionChanges();
            expect(mockMatSnackBar.open).toHaveBeenCalledWith('Error saving changes: Save failed', 'Close', { duration: 5000 });
            expect(component.isProcessingAction).toBeFalse();
        });
    });

    describe('approveSelection()', () => {
        it('should call updateSession then approveFileSelection if hasUnsavedChanges is true', () => {
            component.session = createMockSession('s-approve-save', 'file_selection_review', [createMockSelectedFile('old.ts')]);
            const newSelection = [createMockSelectedFile('new.ts')];
            component.editableFileSelection = newSelection;
            component.designVariationsControl.setValue(3);
            mockVibeService.updateSession.and.returnValue(of({ ...component.session!, fileSelection: newSelection }));
            mockVibeService.approveFileSelection.and.returnValue(of(void 0));

            component.approveSelection();

            expect(mockVibeService.updateSession).toHaveBeenCalledTimes(1);
            expect(component.session!.fileSelection).toEqual(newSelection);
            expect(mockVibeService.approveFileSelection).toHaveBeenCalledWith('s-approve-save', 3);
            expect(mockMatSnackBar.open).toHaveBeenCalledWith('Design generation started.', 'Close', { duration: 3000 });
        });

        it('should call only approveFileSelection if hasUnsavedChanges is false', () => {
            const currentFiles = [createMockSelectedFile('file.ts')];
            component.session = createMockSession('s-approve-nosave', 'file_selection_review', currentFiles);
            component.editableFileSelection = JSON.parse(JSON.stringify(currentFiles));
            mockVibeService.approveFileSelection.and.returnValue(of(void 0));

            component.approveSelection();

            expect(mockVibeService.updateSession).not.toHaveBeenCalled();
            expect(mockVibeService.approveFileSelection).toHaveBeenCalled();
        });

        it('should show snackbar and not proceed if session is invalid (null, wrong status, or empty selection)', () => {
            component.session = null;
            component.approveSelection();
            expect(mockMatSnackBar.open).toHaveBeenCalledWith('Cannot approve selection: Invalid session state or session missing.', 'Close', { duration: 3000 });
            expect(component.isProcessingAction).toBeFalse();
            expect(mockVibeService.approveFileSelection).not.toHaveBeenCalled();

            component.session = createMockSession('s-invalid-status', 'coding', [createMockSelectedFile('f.ts')]);
            component.editableFileSelection = component.session.fileSelection!;
            component.approveSelection();
            expect(mockMatSnackBar.open).toHaveBeenCalledWith('Cannot approve selection: Invalid session state or session missing.', 'Close', { duration: 3000 });

            component.session = createMockSession('s-empty-selection', 'file_selection_review', []);
            component.editableFileSelection = [];
            component.approveSelection();
            expect(mockMatSnackBar.open).toHaveBeenCalledWith('Cannot approve an empty file selection.', 'Close', { duration: 3000 });
        });
    });

    describe('Event Emitters', () => {
        describe('onResetSelection()', () => {
            it('should emit selectionResetRequested and log when confirmed', () => {
                spyOn(component.selectionResetRequested, 'emit');
                spyOn(window, 'confirm').and.returnValue(true);
                spyOn(console, 'log');
                component.onResetSelection();
                expect(window.confirm).toHaveBeenCalled();
                expect(component.selectionResetRequested.emit).toHaveBeenCalled();
                expect(console.log).toHaveBeenCalledWith('Reset selection confirmed and requested from VibeFileListComponent.');
            });

            it('should NOT emit selectionResetRequested when not confirmed', () => {
                spyOn(component.selectionResetRequested, 'emit');
                spyOn(window, 'confirm').and.returnValue(false);
                spyOn(console, 'log');
                component.onResetSelection();
                expect(window.confirm).toHaveBeenCalled();
                expect(component.selectionResetRequested.emit).not.toHaveBeenCalled();
                expect(console.log).toHaveBeenCalledWith('Reset selection cancelled by user.');
            });
        });
    });

    describe('submitFileUpdateInstructions()', () => {
        it('should call VibeService.updateFileSelection with prompt, reset control, and show snackbar', () => {
            component.session = createMockSession('s-instr', 'file_selection_review');
            component.fileUpdateInstructionsControl.setValue(' test prompt ');
            mockVibeService.updateFileSelection.and.returnValue(of(void 0));

            component.submitFileUpdateInstructions();

            expect(component.isProcessingAction).toBeFalse(); // after finalize
            expect(mockVibeService.updateFileSelection).toHaveBeenCalledWith('s-instr', 'test prompt');
            expect(component.fileUpdateInstructionsControl.value).toBe('');
            expect(mockMatSnackBar.open).toHaveBeenCalledWith('Update request sent. The file selection will be revised.', 'Close', { duration: 3500 });
        });

        it('should show snackbar and not call service if prompt is empty', () => {
            component.session = createMockSession('s-instr-empty', 'file_selection_review');
            component.fileUpdateInstructionsControl.setValue('   ');
            component.submitFileUpdateInstructions();
            expect(mockVibeService.updateFileSelection).not.toHaveBeenCalled();
            expect(mockMatSnackBar.open).toHaveBeenCalledWith('Please enter instructions before submitting.', 'Close', { duration: 3000 });
        });

        it('should show snackbar if session is invalid for submitFileUpdateInstructions', () => {
            component.session = null;
            component.fileUpdateInstructionsControl.setValue('prompt');
            component.submitFileUpdateInstructions();
            expect(mockMatSnackBar.open).toHaveBeenCalledWith('Cannot submit instructions: Invalid session state.', 'Close', { duration: 3000 });
            expect(mockVibeService.updateFileSelection).not.toHaveBeenCalled();

            component.session = createMockSession('s-invalid-status', 'coding');
            component.fileUpdateInstructionsControl.setValue('prompt');
            component.submitFileUpdateInstructions();
            expect(mockMatSnackBar.open).toHaveBeenCalledWith('Cannot submit instructions: Invalid session state.', 'Close', { duration: 3000 });
        });
    });
});
