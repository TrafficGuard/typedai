import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { VibeFileListComponent } from './vibe-file-list.component';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { VibeService } from '../vibe.service';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
// CommonModule, ReactiveFormsModule etc. are usually imported by the standalone component itself.
// VibeFileListComponent is standalone and should import its own dependencies.
import { VibeFileTreeSelectDialogComponent } from '../vibe-file-tree-select-dialog/vibe-file-tree-select-dialog.component';
import { FileSystemNode, SelectedFile, VibeSession } from '../vibe.types';
import { of } from 'rxjs';
import { ActivatedRoute } from '@angular/router';

// Mocks
class MatDialogMock {
  open(component: any, config?: any) {
    return {
      afterClosed: () => of(undefined) // Default mock behavior, overridden in tests
    };
  }
}

class MatSnackBarMock {
  open(message: string, action?: string, config?: any) {}
}

class VibeServiceMock {
  getFileSystemTree(sessionId: string) {
    const mockRootNode: FileSystemNode = { name: '.', path: '.', type: 'directory', children: [] };
    return of(mockRootNode);
  }
  updateSession(id: string, payload: any) { return of({} as VibeSession); } // Return a VibeSession like object
  approveFileSelection(id: string, variations?: any) { return of(undefined); }
  updateFileSelection(id: string, prompt: string) { return of(undefined); }
  getVibeSession(id: string) {
     const mockSession: VibeSession = {
         id: 'test-session', title: 'Test', instructions: 'Test', status: 'file_selection_review',
         repositorySource: 'local', repositoryId: 'test', branch: 'main', fileSelection: [],
         createdAt: Date.now(), updatedAt: Date.now(), useSharedRepos: false, // Added useSharedRepos
      };
     return of(mockSession);
  }
}

class ActivatedRouteMock {
     paramMap = of({ get: (key: string) => 'test-session-id' });
     // Mock snapshot if component uses it, e.g., for initial session ID
     snapshot = { paramMap: { get: (key: string) => 'test-session-id' } };
}


describe('VibeFileListComponent', () => {
  let component: VibeFileListComponent;
  let fixture: ComponentFixture<VibeFileListComponent>;
  let matDialogMock: MatDialogMock;
  let matSnackBarMock: MatSnackBarMock;
  // let vibeServiceMock: VibeServiceMock; // Will be injected

  beforeEach(async () => {
    matDialogMock = new MatDialogMock();
    matSnackBarMock = new MatSnackBarMock();
    // vibeServiceMock = new VibeServiceMock(); // Instance created by TestBed

    await TestBed.configureTestingModule({
      imports: [
        VibeFileListComponent, // Import the standalone component. It brings its own imports.
        NoopAnimationsModule, // Often needed for Material components in tests
        // MatDialogModule and MatSnackBarModule might be needed if not fully covered by mocks or if using TestbedHarnessEnvironment
      ],
      providers: [
        { provide: MatDialog, useValue: matDialogMock },
        { provide: MatSnackBar, useValue: matSnackBarMock },
        { provide: VibeService, useClass: VibeServiceMock }, // Use useClass for services with methods
        { provide: ActivatedRoute, useClass: ActivatedRouteMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(VibeFileListComponent);
    component = fixture.componentInstance;

    // Initial @Input session
    component.session = {
      id: 'test-session-input', // Differentiate from route mock if necessary
      title: 'Input Test Session',
      instructions: 'Input Test instructions',
      status: 'file_selection_review',
      repositorySource: 'local',
      repositoryId: '/path/to/input/repo',
      branch: 'feature',
      useSharedRepos: false, // Added useSharedRepos
      fileSelection: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as VibeSession;

    // ngOnChanges is complex. For dialog tests, directly set rootNode if simpler.
    // If ngOnChanges must run for rootNode population from service:
    // fixture.detectChanges(); // This would call ngOnInit and ngOnChanges if inputs are set
    // spyOn(TestBed.inject(VibeService), 'getFileSystemTree').and.callThrough();
    // component.ngOnChanges({ session: new SimpleChange(null, component.session, true) });
    // await fixture.whenStable();

    // For simplicity in these specific tests, directly set rootNode if ngOnChanges is not the focus
     component.rootNode = { name: 'root', path: 'root', type: 'directory', children: [
         { name: 'file1.ts', path: 'root/file1.ts', type: 'file', children: [] } // Ensure children is defined for FileSystemNode
     ]};

    fixture.detectChanges(); // Apply initial bindings and run ngOnInit
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Browse Files Functionality', () => {
     // beforeEach for this describe block can set up specific states if needed, e.g., rootNode
     // spyOn(component, 'handleBrowseFilesRequest').and.callThrough(); // Moved to specific test

     it('onBrowseFiles() should call handleBrowseFilesRequest()', () => {
         spyOn(component, 'handleBrowseFilesRequest').and.stub(); // Use stub if we don't want original to run
         component.onBrowseFiles();
         expect(component.handleBrowseFilesRequest).toHaveBeenCalled();
     });

     it('handleBrowseFilesRequest() should open VibeFileTreeSelectDialogComponent with correct data when rootNode is present', () => {
         // rootNode is set in outer beforeEach
         spyOn(matDialogMock, 'open').and.returnValue({ afterClosed: () => of(undefined) } as MatDialogRef<any, any>);
         component.handleBrowseFilesRequest();
         expect(matDialogMock.open).toHaveBeenCalledWith(VibeFileTreeSelectDialogComponent, jasmine.objectContaining({
             width: '70vw', // Check other properties if they are important
             data: { rootNode: component.rootNode }
         }));
     });

     it('handleBrowseFilesRequest() should show snackbar and not open dialog if rootNode is null', () => {
         component.rootNode = null as any;
         // fixture.detectChanges(); // Not strictly needed as we are not testing template interaction here
         spyOn(matDialogMock, 'open');
         spyOn(matSnackBarMock, 'open');
         component.handleBrowseFilesRequest();
         expect(matSnackBarMock.open).toHaveBeenCalledWith('File tree data is not loaded yet. Please wait.', 'Close', { duration: 3000 });
         expect(matDialogMock.open).not.toHaveBeenCalled();
     });

     it('dialog afterClosed() should add new, unique files to editableFileSelection and show success snackbar', fakeAsync(() => {
         component.editableFileSelection = [{ filePath: 'existing/file.txt', reason: '', category: 'edit', readOnly: false }];
         const newFiles = ['new/file1.ts', 'existing/file.txt', 'new/file2.ts'];
         // Ensure rootNode is set for the dialog to open
         component.rootNode = { name: 'root', path: 'root', type: 'directory', children: []};
         spyOn(matDialogMock, 'open').and.returnValue({ afterClosed: () => of(newFiles) } as MatDialogRef<any, any>);
         spyOn(matSnackBarMock, 'open');

         component.handleBrowseFilesRequest();
         tick();

         expect(component.editableFileSelection.length).toBe(3);
         expect(component.editableFileSelection.some(f => f.filePath === 'new/file1.ts')).toBeTrue();
         expect(component.editableFileSelection.some(f => f.filePath === 'new/file2.ts')).toBeTrue();
         expect(matSnackBarMock.open).toHaveBeenCalledWith('2 file(s) added to selection. Remember to save changes.', 'Close', { duration: 3000 });
     }));

     it('dialog afterClosed() should show appropriate snackbar if no new files were added (all selected files already exist)', fakeAsync(() => {
         component.editableFileSelection = [{ filePath: 'existing/file.txt', reason: '', category: 'edit', readOnly: false }];
         component.rootNode = { name: 'root', path: 'root', type: 'directory', children: []}; // Ensure rootNode
         spyOn(matDialogMock, 'open').and.returnValue({ afterClosed: () => of(['existing/file.txt']) } as MatDialogRef<any, any>);
         spyOn(matSnackBarMock, 'open');

         component.handleBrowseFilesRequest();
         tick();

         expect(component.editableFileSelection.length).toBe(1);
         expect(matSnackBarMock.open).toHaveBeenCalledWith('Selected file(s) are already in the list or no new files were chosen.', 'Close', { duration: 3000 });
     }));

     it('dialog afterClosed() should show "No files selected" snackbar if an empty array is returned from dialog', fakeAsync(() => {
         component.rootNode = { name: 'root', path: 'root', type: 'directory', children: []}; // Ensure rootNode
         spyOn(matDialogMock, 'open').and.returnValue({ afterClosed: () => of([]) } as MatDialogRef<any, any>);
         spyOn(matSnackBarMock, 'open');

         component.handleBrowseFilesRequest();
         tick();

         expect(matSnackBarMock.open).toHaveBeenCalledWith('No files selected from browser.', 'Close', { duration: 2000 });
     }));

     it('dialog afterClosed() should do nothing significant if dialog is cancelled (returns undefined)', fakeAsync(() => {
         component.rootNode = { name: 'root', path: 'root', type: 'directory', children: []}; // Ensure rootNode
         component.editableFileSelection = [{ filePath: 'cancel/test.txt', reason: '', category: 'unknown', readOnly: false }];
         const initialSelectionJSON = JSON.stringify(component.editableFileSelection); // Deep copy for comparison

         spyOn(matDialogMock, 'open').and.returnValue({ afterClosed: () => of(undefined) } as MatDialogRef<any, any>);
         const snackBarSpy = spyOn(matSnackBarMock, 'open');

         component.handleBrowseFilesRequest();
         tick();

         expect(JSON.stringify(component.editableFileSelection)).toEqual(initialSelectionJSON);
         // Check that no snackbar for adding files or "no files selected" was called.
         snackBarSpy.calls.allArgs().forEach(args => {
             expect(args[0]).not.toMatch(/file\(s\) added/);
             expect(args[0]).not.toMatch(/No files selected/);
         });
     }));
  });
});
