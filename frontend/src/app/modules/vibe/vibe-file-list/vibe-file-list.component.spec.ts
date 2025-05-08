import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { VibeFileListComponent } from './vibe-file-list.component';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { VibeService } from '../vibe.service';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { VibeEditReasonDialogComponent } from '../vibe-edit-reason-dialog.component';
import { VibeFileTreeSelectDialogComponent } from '../vibe-file-tree-select-dialog/vibe-file-tree-select-dialog.component';
import { FileSystemNode, SelectedFile, VibeSession } from '../vibe.types';
import { of, Subject } from 'rxjs';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { MatTableHarness } from '@angular/material/table/testing';
import { MatTooltipHarness } from '@angular/material/tooltip/testing';
import { MatIconHarness } from '@angular/material/icon/testing';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatAutocompleteHarness } from '@angular/material/autocomplete/testing';

// --- Mocks ---
class MatDialogMock {
  open(component: any, config?: any) {
    // This will be spied upon and can be configured per test
    return {
      afterClosed: () => of(undefined)
    };
  }
}

class MatSnackBarMock {
  open(message: string, action?: string, config?: any) {}
}

let mockFileSystemTree: FileSystemNode = { name: '.', path: '.', type: 'directory', children: [] };
const mockFileSystemTreeSubject = new Subject<FileSystemNode>();

class VibeServiceMock {
  getFileSystemTree(sessionId: string) {
    return mockFileSystemTreeSubject.asObservable(); // Use a subject to control emission
  }
  updateSession(id: string, payload: any) { return of({ id, ...payload } as VibeSession); }
  approveFileSelection(id: string, variations?: any) { return of(undefined); }
  updateFileSelection(id: string, prompt: string) { return of(undefined); }
  // getVibeSession is not directly called by this component, but by its parent.
}

const initialMockSession: VibeSession = {
  id: 'test-session-1',
  title: 'Test Session',
  instructions: 'Do the thing',
  status: 'file_selection_review',
  repositorySource: 'local',
  repositoryId: 'test-repo',
  branch: 'main',
  fileSelection: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  useSharedRepos: false,
};

// --- Test Suite ---
describe('VibeFileListComponent', () => {
  let component: VibeFileListComponent;
  let fixture: ComponentFixture<VibeFileListComponent>;
  let vibeService: VibeServiceMock;
  let matDialog: MatDialogMock;
  let matSnackBar: MatSnackBarMock;
  let loader: HarnessLoader;

  // --- Helper Functions (Mini Page Object) ---
  async function getElementByTestId(testId: string) {
    const el = fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
    // if (!el) console.warn(`Element with testid "${testId}" not found.`);
    return el;
  }

  async function getButtonByTestId(testId: string): Promise<MatButtonHarness | null> {
    try {
      return await loader.getHarness(MatButtonHarness.with({ selector: `[data-testid="${testId}"]` }));
    } catch {
      return null;
    }
  }
  
  async function clickButtonByTestId(testId: string) {
    const button = await getButtonByTestId(testId);
    if (button) await button.click();
    else console.warn(`Button with testid "${testId}" not found for clicking.`);
  }

  async function setInputValue(testId: string, value: string) {
    const inputHarness = await loader.getHarness(MatInputHarness.with({ selector: `[data-testid="${testId}"]` }));
    await inputHarness.setValue(value);
  }
  
  function setSessionInput(session: VibeSession | null) {
    fixture.componentRef.setInput('session', session);
    // No need to call detectChanges immediately if we want to tick() to control effect execution
  }

  function triggerFileSystemTreeEmit(tree: FileSystemNode) {
    mockFileSystemTreeSubject.next(tree);
    tick(); // Allow observable to emit and effect to run
    fixture.detectChanges(); // Update view
  }
  
  function getFirstTableRowTextContent(): string[] | null {
      const row = fixture.nativeElement.querySelector('table tbody tr:first-child');
      if (!row) return null;
      return Array.from(row.querySelectorAll('td')).map((td: HTMLElement) => td.textContent.trim());
  }

  beforeEach(async () => {
    matDialog = new MatDialogMock();
    matSnackBar = new MatSnackBarMock();

    await TestBed.configureTestingModule({
      imports: [
        VibeFileListComponent,
        NoopAnimationsModule,
      ],
      providers: [
        { provide: MatDialog, useValue: matDialog },
        { provide: MatSnackBar, useValue: matSnackBar },
        { provide: VibeService, useClass: VibeServiceMock },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(VibeFileListComponent);
    component = fixture.componentInstance;
    loader = TestbedHarnessEnvironment.loader(fixture);
    vibeService = TestBed.inject(VibeService) as unknown as VibeServiceMock; // Get the mock instance

    // Spy on service methods and others before first detectChanges if needed by constructor/effects
    spyOn(vibeService, 'getFileSystemTree').and.callThrough();
    spyOn(vibeService, 'updateSession').and.callThrough();
    spyOn(vibeService, 'approveFileSelection').and.callThrough();
    spyOn(vibeService, 'updateFileSelection').and.callThrough();
    spyOn(matDialog, 'open').and.callThrough();
    spyOn(matSnackBar, 'open').and.callThrough();
    spyOn(component.selectionResetRequested, 'emit').and.callThrough();

    // Initial file system tree for general tests
    mockFileSystemTree = {
        name: '.', path: '.', type: 'directory', children: [
            { name: 'file1.ts', path: 'file1.ts', type: 'file' },
            { name: 'file2.js', path: 'file2.js', type: 'file' },
            { name: 'folder1', path: 'folder1', type: 'directory', children: [
                { name: 'file3.css', path: 'folder1/file3.css', type: 'file' }
            ]}
        ]
    };
  });

  it('should create', () => {
    setSessionInput(initialMockSession);
    fixture.detectChanges(); // Trigger effect in constructor
    triggerFileSystemTreeEmit(mockFileSystemTree);
    expect(component).toBeTruthy();
  });

  // --- I. Viewing the File Selection List ---
  describe('I. Viewing the File Selection List', () => {
    it('1. Initial Page Load - No Files Selected: should show "No files selected." message', fakeAsync(() => {
      const sessionData: VibeSession = { ...initialMockSession, fileSelection: [] };
      setSessionInput(sessionData);
      fixture.detectChanges();
      triggerFileSystemTreeEmit(mockFileSystemTree);
      
      const p = fixture.nativeElement.querySelector('.vibe-file-list-container > p');
      expect(p).toBeTruthy();
      expect(p.textContent).toContain('No files selected.');
      const table = fixture.nativeElement.querySelector('table');
      expect(table).toBeFalsy();
    }));

    it('2. Initial Page Load - System Updating: should show AI review message and disable interactions', fakeAsync(() => {
      const sessionData: VibeSession = { ...initialMockSession, status: 'updating_file_selection', fileSelection: [] };
      setSessionInput(sessionData);
      fixture.detectChanges();
      triggerFileSystemTreeEmit(mockFileSystemTree);

      const p = fixture.nativeElement.querySelector('p');
      expect(p.textContent).toContain('File selection is currently under AI review.');
      
      // Check if add/browse files section is hidden (it should be due to isReadOnly())
      const addBrowseSection = fixture.nativeElement.querySelector('.my-6.p-4.border.rounded');
      expect(addBrowseSection).toBeFalsy();
    }));

    it('3. Viewing the List of Selected Files: should display files in a table with details', fakeAsync(() => {
      const files: SelectedFile[] = [
        { filePath: 'src/app.ts', reason: 'Main entry', category: 'edit' },
        { filePath: 'src/service.ts', reason: 'Business logic', category: 'reference', readOnly: true },
        { filePath: 'src/style.css', reason: '', category: undefined }, // Test missing reason/category
      ];
      const sessionData: VibeSession = { ...initialMockSession, fileSelection: files };
      setSessionInput(sessionData);
      fixture.detectChanges();
      triggerFileSystemTreeEmit(mockFileSystemTree);

      const tableRows = fixture.nativeElement.querySelectorAll('table tbody tr');
      expect(tableRows.length).toBe(3);

      const firstRowCells = tableRows[0].querySelectorAll('td');
      expect(firstRowCells[0].textContent).toContain('src/app.ts');
      expect(firstRowCells[1].textContent).toContain('Main entry');
      expect(firstRowCells[2].textContent).toContain('Edit'); // Titlecased by pipe
      expect(firstRowCells[0].querySelector('mat-icon[svgicon="heroicons_outline:lock-closed"]')).toBeFalsy(); // Not read-only

      const secondRowCells = tableRows[1].querySelectorAll('td');
      expect(secondRowCells[0].textContent).toContain('src/service.ts');
      expect(secondRowCells[0].querySelector('mat-icon[svgicon="heroicons_outline:lock-closed"]')).toBeTruthy(); // Read-only lock
      const removeButtonSecondRow = secondRowCells[3].querySelector('button');
      expect(removeButtonSecondRow.disabled).toBeTrue();


      const thirdRowCells = tableRows[2].querySelectorAll('td');
      expect(thirdRowCells[1].textContent).toContain('-'); // Placeholder for reason
      expect(thirdRowCells[2].textContent).toContain('-'); // Placeholder for category
    }));
  });

  // --- II. Modifying Individual Files in the List ---
  describe('II. Modifying Individual Files in the List (when status allows)', () => {
    let modifiableSession: VibeSession;
    const initialFile: SelectedFile = { filePath: 'file.ts', reason: 'Initial Reason', category: 'edit' };

    beforeEach(fakeAsync(() => {
        modifiableSession = { ...initialMockSession, status: 'file_selection_review', fileSelection: [initialFile] };
        setSessionInput(modifiableSession);
        fixture.detectChanges();
        triggerFileSystemTreeEmit(mockFileSystemTree);
    }));

    it('4. Editing a File\'s Reason: should open dialog and update reason locally', fakeAsync(() => {
      const newReason = 'Updated Reason';
      const newCategory = 'reference';
      // @ts-ignore
      spyOn(matDialog, 'open').and.returnValue({ afterClosed: () => of({ reason: newReason, category: newCategory }) } as MatDialogRef<VibeEditReasonDialogComponent>);
      
      const reasonCell = fixture.nativeElement.querySelector('table tbody tr:first-child td:nth-child(2) span');
      reasonCell.click();
      tick(); // For dialog
      fixture.detectChanges();

      expect(matDialog.open).toHaveBeenCalledWith(VibeEditReasonDialogComponent, jasmine.any(Object));
      expect(component.editableFileSelection()[0].reason).toBe(newReason);
      expect(component.editableFileSelection()[0].category).toBe(newCategory);
      expect(matSnackBar.open).toHaveBeenCalledWith(jasmine.stringContaining('Details for \'file.ts\' updated locally'), 'Close', jasmine.any(Object));
      expect(component.hasUnsavedChanges()).toBeTrue();
    }));

    it('5. Editing a File\'s Category (Inline): should change to select, update category, and revert to text', fakeAsync(async () => {
        const categoryCell = fixture.nativeElement.querySelector('table tbody tr:first-child td:nth-child(3) span');
        categoryCell.click();
        tick();
        fixture.detectChanges();

        let selectElement = fixture.nativeElement.querySelector('mat-select');
        expect(selectElement).toBeTruthy();
        
        const matSelect = await loader.getHarness(MatSelectHarness);
        await matSelect.open();
        const options = await matSelect.getOptions({text: 'Reference'});
        await options[0].click(); // Select 'reference'
        tick();
        fixture.detectChanges();

        expect(component.editableFileSelection()[0].category).toBe('reference');
        expect(matSnackBar.open).toHaveBeenCalledWith(jasmine.stringContaining('Category for \'file.ts\' updated locally to \'reference\''), 'Close', jasmine.any(Object));
        selectElement = fixture.nativeElement.querySelector('mat-select'); // Should be gone
        expect(selectElement).toBeFalsy();
        const updatedCategoryCell = fixture.nativeElement.querySelector('table tbody tr:first-child td:nth-child(3) span');
        expect(updatedCategoryCell.textContent).toContain('Reference'); // Titlecased
        expect(component.hasUnsavedChanges()).toBeTrue();
    }));
    
    it('6. Removing a File from the List: should remove file locally', fakeAsync(() => {
        const removeButton = fixture.nativeElement.querySelector('table tbody tr:first-child td:nth-child(4) button');
        removeButton.click();
        tick();
        fixture.detectChanges();

        expect(component.editableFileSelection().length).toBe(0);
        expect(matSnackBar.open).toHaveBeenCalledWith(jasmine.stringContaining('File \'file.ts\' removed locally'), 'Close', jasmine.any(Object));
        expect(component.hasUnsavedChanges()).toBeTrue();
    }));
  });

  // --- III. Adding New Files to the Selection ---
  describe('III. Adding New Files to the Selection (when status allows)', () => {
    beforeEach(fakeAsync(() => {
        const sessionData: VibeSession = { ...initialMockSession, status: 'file_selection_review', fileSelection: [] };
        setSessionInput(sessionData);
        fixture.detectChanges();
        triggerFileSystemTreeEmit(mockFileSystemTree); // Ensure allFiles is populated
    }));

    it('9. Searching and Adding a File by Path: should add file with reason/category via dialog', fakeAsync(async () => {
        const filePathToAdd = 'file1.ts'; // Exists in mockFileSystemTree -> allFiles
        component.addFileControlValue.set(filePathToAdd);
        fixture.detectChanges();
        tick(); // for computed signal filteredFiles

        // @ts-ignore
        spyOn(matDialog, 'open').and.returnValue({ afterClosed: () => of({ reason: 'Added via search', category: 'edit' }) } as MatDialogRef<VibeEditReasonDialogComponent>);

        const addButton = fixture.nativeElement.querySelector('div.flex.items-center.space-x-2 button');
        addButton.click();
        tick(); // For dialog
        fixture.detectChanges();
        
        expect(matDialog.open).toHaveBeenCalledWith(VibeEditReasonDialogComponent, jasmine.objectContaining({
            data: jasmine.objectContaining({ filePath: filePathToAdd })
        }));
        expect(component.editableFileSelection().length).toBe(1);
        expect(component.editableFileSelection()[0].filePath).toBe(filePathToAdd);
        expect(component.editableFileSelection()[0].reason).toBe('Added via search');
        expect(matSnackBar.open).toHaveBeenCalledWith(jasmine.stringContaining(`File '${filePathToAdd}' added locally`), 'Close', jasmine.any(Object));
        expect(component.addFileControlValue()).toBe('');
        expect(component.hasUnsavedChanges()).toBeTrue();
    }));

    it('10. Browsing Project Files to Add: should add selected files via dialog', fakeAsync(() => {
        const filesToSelectFromBrowser = ['folder1/file3.css', 'file2.js'];
        // @ts-ignore
        spyOn(matDialog, 'open').and.returnValue({ afterClosed: () => of(filesToSelectFromBrowser) } as MatDialogRef<VibeFileTreeSelectDialogComponent>);

        const browseButton = fixture.nativeElement.querySelector('div.mt-3.flex.justify-end button');
        browseButton.click();
        tick(); // For dialog
        fixture.detectChanges();

        expect(matDialog.open).toHaveBeenCalledWith(VibeFileTreeSelectDialogComponent, jasmine.any(Object));
        expect(component.editableFileSelection().length).toBe(2);
        expect(component.editableFileSelection().some(f => f.filePath === 'folder1/file3.css')).toBeTrue();
        expect(component.editableFileSelection().some(f => f.filePath === 'file2.js')).toBeTrue();
        expect(matSnackBar.open).toHaveBeenCalledWith(jasmine.stringContaining('2 file(s) added to selection'), 'Close', jasmine.any(Object));
        expect(component.hasUnsavedChanges()).toBeTrue();
    }));
  });

  // --- IV. Reviewing and Finalizing the File Selection ---
  describe('IV. Reviewing and Finalizing the File Selection (status file_selection_review)', () => {
    beforeEach(fakeAsync(() => {
        const sessionData: VibeSession = { ...initialMockSession, status: 'file_selection_review', fileSelection: [{filePath: 'initial.ts', reason: 'test', category: 'edit'}] };
        setSessionInput(sessionData);
        fixture.detectChanges();
        triggerFileSystemTreeEmit(mockFileSystemTree);
    }));

    it('12. Refining Selection with Instructions: should call service and clear input', fakeAsync(async () => {
        const instructions = 'Refine this selection please.';
        component.fileUpdateInstructionsValue.set(instructions);
        fixture.detectChanges();

        const submitButton = fixture.nativeElement.querySelector('button[mat-flat-button][color="primary"]'); // More specific selector
        submitButton.click();
        tick(); // For service call
        fixture.detectChanges();

        expect(vibeService.updateFileSelection).toHaveBeenCalledWith(initialMockSession.id, instructions);
        expect(matSnackBar.open).toHaveBeenCalledWith('Update request sent. The file selection will be revised.', 'Close', jasmine.any(Object));
        expect(component.fileUpdateInstructionsValue()).toBe('');
    }));

    it('13. Saving Local Changes to the Selection: should call service if changes exist', fakeAsync(() => {
        // Make a local change
        component.editableFileSelection.update(files => [...files, {filePath: 'new.ts', reason: 'new', category: 'edit'}]);
        fixture.detectChanges(); // To update hasUnsavedChanges
        expect(component.hasUnsavedChanges()).toBeTrue();

        const saveButton = fixture.nativeElement.querySelectorAll('div.flex.justify-end.items-center button')[0]; // First button in "Final Actions"
        saveButton.click();
        tick(); // For service call
        fixture.detectChanges();

        expect(vibeService.updateSession).toHaveBeenCalledWith(initialMockSession.id, { fileSelection: component.editableFileSelection() });
        expect(matSnackBar.open).toHaveBeenCalledWith('File selection changes saved successfully.', 'Close', jasmine.any(Object));
    }));
    
    it('14. Resetting the Selection: should emit selectionResetRequested on confirm', fakeAsync(() => {
        spyOn(window, 'confirm').and.returnValue(true);
        const resetButton = fixture.nativeElement.querySelectorAll('div.flex.justify-end.items-center button')[1];
        resetButton.click();
        tick();
        fixture.detectChanges();

        expect(window.confirm).toHaveBeenCalled();
        expect(component.selectionResetRequested.emit).toHaveBeenCalled();
    }));

    it('16. Approving the Selection: should save if changes and then call approve service', fakeAsync(() => {
        // Make a local change to test save path
        component.editableFileSelection.update(files => [...files, {filePath: 'another.ts', reason: 'another', category: 'edit'}]);
        fixture.detectChanges();
        expect(component.hasUnsavedChanges()).toBeTrue();
        
        component.designVariationsValue.set(2); // Set variations
        fixture.detectChanges();

        const approveButton = fixture.nativeElement.querySelectorAll('div.flex.justify-end.items-center button')[3];
        approveButton.click();
        tick(); // For potential save and approve calls
        fixture.detectChanges();

        expect(vibeService.updateSession).toHaveBeenCalledWith(initialMockSession.id, { fileSelection: component.editableFileSelection() });
        expect(vibeService.approveFileSelection).toHaveBeenCalledWith(initialMockSession.id, 2);
        expect(matSnackBar.open).toHaveBeenCalledWith('Design generation started.', 'Close', jasmine.any(Object));
    }));

    it('17. Disabling Actions During Processing: buttons should be disabled', fakeAsync(() => {
        component.isProcessingAction.set(true);
        fixture.detectChanges();

        const submitInstructionsButton = fixture.nativeElement.querySelector('button[mat-flat-button][color="primary"]');
        expect(submitInstructionsButton.disabled).toBeTrue();
        
        const finalActionButtons = fixture.nativeElement.querySelectorAll('div.flex.justify-end.items-center button');
        expect(finalActionButtons[0].disabled).toBeTrue(); // Save
        expect(finalActionButtons[1].disabled).toBeTrue(); // Reset
        // Select for variations is not a button, skip direct check here or use MatSelectHarness if needed
        expect(finalActionButtons[3].disabled).toBeTrue(); // Approve
    }));
  });

});
