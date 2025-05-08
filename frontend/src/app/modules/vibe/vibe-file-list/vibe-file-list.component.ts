import { Component, Input, Output, EventEmitter, inject, OnInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import {finalize, Observable, of, Subject, switchMap, take, tap} from 'rxjs';
import { map, startWith, takeUntil } from 'rxjs/operators';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { SelectedFile, VibeSession, type FileSystemNode } from '../vibe.types';
import { VibeEditReasonDialogComponent } from '../vibe-edit-reason-dialog.component';

import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  VibeFileTreeSelectDialogComponent
} from "../vibe-file-tree-select-dialog/vibe-file-tree-select-dialog.component";
import {ActivatedRoute} from "@angular/router";
import {VibeService} from "../vibe.service";
import {MatSnackBar} from "@angular/material/snack-bar";

@Component({
  selector: 'vibe-file-list',
  templateUrl: './vibe-file-list.component.html',
  styleUrls: ['./vibe-file-list.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatTableModule,
    MatIconModule,
    MatTooltipModule,
    MatDialogModule, // Add MatDialogModule here
    VibeEditReasonDialogComponent, // Import the dialog component
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatAutocompleteModule,
    MatButtonModule,
    TextFieldModule,
    MatProgressSpinnerModule,
  ],
})
export class VibeFileListComponent implements OnInit, OnDestroy, OnChanges {
  private destroy$ = new Subject<void>();

  @Input() session: VibeSession | null = null;

  @Output() fileDeleted = new EventEmitter<SelectedFile>();
  @Output() reasonUpdated = new EventEmitter<{ file: SelectedFile, newReason: string }>();
  @Output() categoryUpdated = new EventEmitter<{ file: SelectedFile, newCategory: SelectedFile['category'] }>();
  @Output() addFileRequested = new EventEmitter<string>();
  @Output() selectionResetRequested = new EventEmitter<void>();

  displayedColumns: string[] = ['filePath', 'reason', 'category', 'actions'];
  public dialog = inject(MatDialog);
  addFileControl = new FormControl('');
  filteredFiles$: Observable<string[]>;
  public editingCategoryFilePath: string | null = null;
  public availableCategories: Array<SelectedFile['category']> = ['edit', 'reference', 'style_example', 'unknown'];
  public editableFileSelection: SelectedFile[] = [];

  fileUpdateInstructionsControl = new FormControl('');
  public designVariationsControl = new FormControl(1);
  // Full list of files available in the session's workspace
  rootNode: FileSystemNode;
  allFiles: string[] = [];
  // filteredFiles$: Observable<string[]>; // Removed

  isProcessingAction: boolean = false; // Flag for loading state

  private route = inject(ActivatedRoute);
  private vibeService = inject(VibeService);
  private snackBar = inject(MatSnackBar);


  /**
   * Checks if the current session status makes the file list read-only.
   * @returns True if the session status is 'updating_file_selection', false otherwise.
   */
  public get isReadOnly(): boolean {
    return this.session?.status === 'updating_file_selection';
  }

  /**
   * Emits an event when the delete button is clicked for a file.
   * @param file The file to be deleted.
   */
  deleteFile(file: SelectedFile): void {
    // Prevent emitting delete for read-only files, although button should be disabled
    if (!file.readOnly) {
      const index = this.editableFileSelection.findIndex(f => f.filePath === file.filePath);
      if (index > -1) {
        this.editableFileSelection.splice(index, 1);
        this.editableFileSelection = [...this.editableFileSelection];
        this.snackBar.open(`File '${file.filePath}' removed locally. Save changes to persist.`, 'Close', { duration: 3000 });
      }
    }
  }

  /**
   * Opens a dialog to edit the reason for a selected file.
   * Emits an event if the reason is updated.
   * @param file The file whose reason is to be edited.
   */
  editReason(file: SelectedFile): void {
    if (this.isReadOnly) {
      return;
    }

    const dialogRef = this.dialog.open(VibeEditReasonDialogComponent, {
      width: '450px',
      data: { // VibeEditReasonDialogData
          reason: file.reason || '',
          filePath: file.filePath,
          currentCategory: file.category || 'unknown',
          availableCategories: this.availableCategories
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      // result is expected to be an object: { reason: string, category: SelectedFile['category'] }
      if (result && typeof result.reason === 'string') {
        const fileToUpdate = this.editableFileSelection.find(f => f.filePath === file.filePath);
        if (fileToUpdate) {
          fileToUpdate.reason = result.reason.trim();
          if (result.category && typeof result.category === 'string') {
            fileToUpdate.category = result.category as SelectedFile['category'];
          }
          this.editableFileSelection = [...this.editableFileSelection];
          this.snackBar.open(`Details for '${file.filePath}' updated locally. Save changes to persist.`, 'Close', { duration: 3000 });
        }
      }
    });
  }

  /**
   * Toggles the category editing UI for a given file.
   * @param file The file for which to toggle category editing.
   * @param event The mouse event that triggered the toggle.
   */
  toggleCategoryEdit(file: SelectedFile, event: MouseEvent): void {
    if (this.isReadOnly) {
      return;
    }
    this.editingCategoryFilePath = file.filePath;
    event.stopPropagation(); // Prevent triggering other click listeners, e.g., on the row
  }

  /**
   * Handles the change of a category for a file.
   * Emits an event with the updated category and resets the editing state.
   * @param file The file whose category was changed.
   * @param newCategory The new category selected for the file.
   */
  onCategoryChange(file: SelectedFile, newCategory: SelectedFile['category']): void {
    const fileToUpdate = this.editableFileSelection.find(f => f.filePath === file.filePath);
    if (fileToUpdate) {
      fileToUpdate.category = newCategory;
      this.editableFileSelection = [...this.editableFileSelection];
      this.snackBar.open(`Category for '${file.filePath}' updated locally to '${newCategory}'. Save changes to persist.`, 'Close', { duration: 3000 });
    }
    this.editingCategoryFilePath = null;
  }

  /**
   * Cancels the category editing state.
   * Called when the select dropdown is closed without a selection or focus is lost.
   */
  cancelCategoryEdit(): void {
    this.editingCategoryFilePath = null;
  }


  ngOnInit() {
    // Removed: designForm initialization

    this.filteredFiles$ = this.addFileControl.valueChanges.pipe(
        startWith(''),
        map(value => this._filterFiles(value || '')),
        takeUntil(this.destroy$)
    );

    // Initialize filteredFiles$ here if not done above, ensuring it's set up
    if (!this.filteredFiles$) {
      this.filteredFiles$ = this.addFileControl.valueChanges.pipe(
          startWith(''),
          map(value => this._filterFiles(value || '')),
          takeUntil(this.destroy$) // Clean up inner subscription
      );
    }

    // Removed: this.codeForm = this.fb.group({ ... });
  }


  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.session?.id) {
    // Fetch the file tree as a single string
    this.vibeService.getFileSystemTree(this.session.id).subscribe((fileSystemNode: FileSystemNode | null) => {
      this.rootNode = fileSystemNode;
      this.allFiles = []; // Clear previous files

      if (this.rootNode) {
        // If the rootNode itself is a directory and has children, iterate through them.
        // The initial parentPath for items directly under the root depends on the rootNode.name.
        // If rootNode.name is '.' or empty, it implies the children are at the top level.
        // Otherwise, rootNode.name is part of their path.
        if (this.rootNode.type === 'directory' && this.rootNode.children) {
          for (const child of this.rootNode.children) {
            this._extractFilePathsRecursive(child, '', this.allFiles);
          }
        } else if (this.rootNode.type === 'file') {
          // Handle the unlikely case where the root node itself is a file
          this._extractFilePathsRecursive(this.rootNode, '', this.allFiles);
        }
      }

      // Ensure the autocomplete updates if it already has a value
      if (this.addFileControl.value) {
        this.addFileControl.updateValueAndValidity({ emitEvent: true });
      }
      // Initialize or re-initialize the filtered files observable
      if (!this.filteredFiles$) {
        this.filteredFiles$ = this.addFileControl.valueChanges.pipe(
            startWith(''),
            map(value => this._filterFiles(value || '')),
            takeUntil(this.destroy$) // Clean up inner subscription
        );
      }
    });
    }
  }

  /**
   * Sorts files: writable files first, then alphabetically by path.
   * @param files Array of SelectedFile objects.
   * @returns Sorted array of SelectedFile objects.
   */
  sortFiles(files: SelectedFile[]): SelectedFile[] {
    if (!files) return [];
    return files.sort((a, b) => {
      // Prioritize writable files (!readOnly means writable)
      const readOnlyCompare = (!a.readOnly ? 1 : 0) - (!b.readOnly ? 1 : 0);
      if (readOnlyCompare !== 0) {
        // If one is read-only and the other isn't, sort by that first (writable first)
        // We multiply by -1 because we want writable (true, represented as 1) to come before read-only (false, represented as 0).
        // So, 1 - 0 = 1. We want this case to be negative for sorting. 0 - 1 = -1. We want this case to be positive.
        return readOnlyCompare * -1;
      }
      // If both are read-only or both are writable, sort by filePath
      return a.filePath.localeCompare(b.filePath);
    });
  }

  private _filterFiles(value: string): string[] {
    if (!value) {
        return [];
    }
    const searchTerm = value.toLowerCase();
    const localAllFiles = this.allFiles || [];
    const filteredResults = localAllFiles.filter(filePath => {
        const normalizedFilePath = filePath.toLowerCase();
        if (normalizedFilePath.startsWith(searchTerm)) {
            return true;
        }
        const pathParts = normalizedFilePath.split(/[/\.\-_]/);
        if (pathParts.some(part => part.startsWith(searchTerm))) {
            return true;
        }
        return false;
    });
    return filteredResults.slice(0, 10);
  }

  public onHandleAddFile(): void {
    const selectedFile = this.addFileControl.value?.trim();
    if (!selectedFile) {
      console.warn('VibeFileListComponent: Attempted to add an empty file path.');
      // Optionally, show a snackbar for empty input
      // this.snackBar.open('File path cannot be empty.', 'Close', { duration: 3000 });
      return;
    }

    if (!this.session || !this.session.id) {
      this.snackBar.open('Session not loaded. Cannot add file.', 'Close', { duration: 3000 });
      return;
    }

    if (this.editableFileSelection.some(f => f.filePath === selectedFile)) { // Check against local editableFileSelection
      this.snackBar.open(`File '${selectedFile}' is already in the local selection.`, 'Close', { duration: 3000 });
      return;
    }

    const dialogRef = this.dialog.open(VibeEditReasonDialogComponent, {
      width: '450px',
      data: { // VibeEditReasonDialogData
        reason: '', // Initial empty reason
        filePath: selectedFile,
        availableCategories: this.availableCategories,
        currentCategory: 'unknown' // Default category for new files
      }
    });

    dialogRef.afterClosed().pipe(takeUntil(this.destroy$)).subscribe(result => {
      // result is an object { reason: string, category: string }
      // Ensure selectedFile is still valid here as it's from outer scope
      if (result && typeof result.reason === 'string' && selectedFile) {
        const { reason, category } = result;

        const newFileEntry: SelectedFile = {
          filePath: selectedFile,
          reason: reason.trim(),
          category: category || 'unknown',
          readOnly: false
        };

        this.editableFileSelection.push(newFileEntry);
        this.editableFileSelection = [...this.editableFileSelection]; // Trigger change detection

        this.snackBar.open(`File '${selectedFile}' added locally. Save changes to persist.`, 'Close', { duration: 3000 });
        this.addFileControl.setValue(''); // Clear the autocomplete input
      } else {
        // User cancelled the dialog or provided no reason (dialog closed without valid result)
        console.log('VibeFileListComponent: Add file dialog cancelled or no data returned.');
        // Optionally, clear input if dialog was cancelled but input had value
        // if (selectedFile) this.addFileControl.setValue('');
      }
    });
  }

  public onBrowseFiles(): void {
    this.handleBrowseFilesRequest();
  }




  private _extractFilePathsRecursive(node: FileSystemNode, parentPath: string, allFilesList: string[]): void {
    // Construct the current item's full path.
    // If parentPath is empty (e.g. for items directly under a root like '.'), don't prepend a slash.
    const currentItemPath = parentPath ? `${parentPath}/${node.name}` : node.name;

    if (node.type === 'file') {
      allFilesList.push(currentItemPath);
    } else if (node.type === 'directory' && node.children) {
      // For directories, recurse for each child.
      // The currentItemPath becomes the parentPath for its children.
      for (const child of node.children) {
        this._extractFilePathsRecursive(child, currentItemPath, allFilesList);
      }
    }
  }

  private sortFilesForComparison(files: SelectedFile[]): Array<{ filePath: string, reason: string, category: string }> {
    if (!files) return [];
    // Create a shallow copy and sort by filePath for stable stringify comparison
    // Only include filePath, reason, and category for comparison, exclude readOnly or other dynamic properties
    return [...files]
        .map(f => ({ filePath: f.filePath, reason: f.reason || '', category: f.category || 'unknown' }))
        .sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  public hasUnsavedChanges(): boolean {
    if (!this.session) { // If there's no session, but there's local data, consider it "unsaved"
        return this.editableFileSelection && this.editableFileSelection.length > 0;
    }
    const localComparable = this.sortFilesForComparison(this.editableFileSelection);
    const sessionComparable = this.sortFilesForComparison(this.session.fileSelection || []);
    return JSON.stringify(localComparable) !== JSON.stringify(sessionComparable);
  }

  public onSaveFileSelectionChanges(): void {
    if (!this.session || !this.session.id) {
        this.snackBar.open('Cannot save: Session not available.', 'Close', { duration: 3000 });
        return;
    }
    if (!this.hasUnsavedChanges()) {
        this.snackBar.open('No changes to save.', 'Close', { duration: 2000 });
        return;
    }

    this.isProcessingAction = true;
    const sessionId = this.session.id;

    // Create a deep copy of editableFileSelection for the payload
    const selectionPayload = JSON.parse(JSON.stringify(this.editableFileSelection));

    this.vibeService.updateSession(sessionId, { fileSelection: selectionPayload }).pipe(
        take(1),
        finalize(() => { this.isProcessingAction = false; }),
        takeUntil(this.destroy$)
    ).subscribe({
        next: () => {
            this.snackBar.open('File selection changes saved successfully.', 'Close', { duration: 3000 });
            if (this.session) {
                 this.session.fileSelection = JSON.parse(JSON.stringify(selectionPayload));
            }
        },
        error: (err) => {
            console.error('Error saving file selection changes:', err);
            this.snackBar.open(`Error saving changes: ${err.message || 'Unknown error'}`, 'Close', { duration: 5000 });
        }
    });
  }

  /**
   * Approves the current file selection and triggers design generation.
   */
  public approveSelection(): void {
    if (!this.session || !this.session.id || this.session.status !== 'file_selection_review') {
        this.snackBar.open('Cannot approve selection: Invalid session state or session missing.', 'Close', { duration: 3000 });
        this.isProcessingAction = false;
        return;
    }

    if (!this.editableFileSelection || this.editableFileSelection.length === 0) {
         this.snackBar.open('Cannot approve an empty file selection.', 'Close', { duration: 3000 });
         this.isProcessingAction = false;
         return;
    }

    this.isProcessingAction = true;
    const sessionId = this.session.id;
    const variations = this.designVariationsControl.value;

    const selectionPayload = JSON.parse(JSON.stringify(this.editableFileSelection));

    const saveIfNeeded$ = this.hasUnsavedChanges()
        ? this.vibeService.updateSession(sessionId, { fileSelection: selectionPayload })
        : of(null);

    saveIfNeeded$.pipe(
        switchMap(() => {
            if (this.hasUnsavedChanges() && this.session) { // Check again in case save failed or was concurrent
                 this.session.fileSelection = JSON.parse(JSON.stringify(selectionPayload));
            }
            this.snackBar.open('File selection current. Proceeding to generate design...', 'Close', { duration: 2000 });
            return this.vibeService.approveFileSelection(sessionId, variations);
        }),
        finalize(() => { this.isProcessingAction = false; }),
        takeUntil(this.destroy$)
    ).subscribe({
        next: () => {
            console.log('File selection approved and design generation triggered.');
            this.snackBar.open('Design generation started.', 'Close', { duration: 3000 });
        },
        error: (err) => {
            console.error('Error during save or approve selection:', err);
            this.snackBar.open(`Error: ${err.message || 'Unknown error during approval'}`, 'Close', { duration: 5000 });
        }
    });
  }

  /**
   * Requests an update to the file selection based on user prompt.
   */
  requestSelectionUpdate(): void {
    this.isProcessingAction = true;
    if (!this.session || this.session.status !== 'file_selection_review') {
      console.error('requestSelectionUpdate called in invalid state or session missing:', this.session?.status);
      this.snackBar.open('Invalid state or session missing', 'Close', { duration: 3000 });
      this.isProcessingAction = false;
      return;
    }

    const prompt = window.prompt("Enter instructions to update file selection:");

    if (prompt !== null && prompt.trim() !== '') {
      const sessionId = this.session.id; // Capture session ID
      this.vibeService.updateFileSelection(sessionId, prompt).pipe(
          finalize(() => this.isProcessingAction = false),
          takeUntil(this.destroy$)
      ).subscribe({
        next: () => {
          console.log('File selection update requested successfully.');
          this.snackBar.open('File selection update requested...', 'Close', { duration: 3000 });
          // Trigger session refresh
          this.vibeService.getVibeSession(sessionId).pipe(take(1)).subscribe();
        },
        error: (err) => {
          console.error('Error requesting file selection update:', err);
          this.snackBar.open(`Error requesting update: ${err.message || 'Unknown error'}`, 'Close', { duration: 5000 });
        }
      });
    } else {
      // User cancelled or entered empty prompt
      console.log('File selection update cancelled by user.');
      this.isProcessingAction = false;
    }
  }

  public handleBrowseFilesRequest(): void {
    if (!this.rootNode) {
      this.snackBar.open('File tree data is not loaded yet. Please wait.', 'Close', { duration: 3000 });
      return;
    }
    const dialogRef = this.dialog.open(VibeFileTreeSelectDialogComponent, {
      width: '70vw',
      maxWidth: '800px',
      maxHeight: '80vh',
      data: { rootNode: this.rootNode }
    });

    dialogRef.afterClosed().pipe(takeUntil(this.destroy$)).subscribe(selectedFilePaths => {
      if (selectedFilePaths && Array.isArray(selectedFilePaths)) {
        // This condition means the user confirmed the dialog,
        // and selectedFilePaths is an array (could be empty if no files were checked).

        if (selectedFilePaths.length > 0) {
          let newFilesAddedCount = 0;
          selectedFilePaths.forEach(path => { // path is a string representing a file path
            const alreadyExists = this.editableFileSelection.some(sf => sf.filePath === path);
            if (!alreadyExists) {
              const newFileEntry: SelectedFile = {
                filePath: path,
                reason: 'Added via file browser', // Default reason
                category: 'unknown', // Default category
                readOnly: false // New files added by user are not read-only
              };
              this.editableFileSelection.push(newFileEntry);
              newFilesAddedCount++;
            }
          });

          if (newFilesAddedCount > 0) {
            this.snackBar.open(`${newFilesAddedCount} file(s) added to selection. Remember to save changes.`, 'Close', { duration: 3000 });
            // Ensure change detection picks up the modification to the array.
            this.editableFileSelection = [...this.editableFileSelection];
          } else {
            // This means selectedFilePaths.length > 0, but all selected files were already in editableFileSelection.
            this.snackBar.open('Selected file(s) are already in the list or no new files were chosen.', 'Close', { duration: 3000 });
          }
        } else { // selectedFilePaths.length === 0
          // User confirmed the dialog but selected no files.
          this.snackBar.open('No files selected from browser.', 'Close', {duration: 2000});
        }
      } else {
        // This condition (selectedFilePaths is undefined or not an array) means the dialog was cancelled (e.g., Esc, click outside).
        console.log('File selection dialog was cancelled.');
      }
    });
  }

  public handleFileAddRequested(filePath: string): void {
    if (!filePath || filePath.trim() === '') {
      this.snackBar.open('Cannot add empty file path.', 'Close', { duration: 3000 });
      return;
    }
    if (!this.session?.id) {
      this.snackBar.open('Cannot add file: Session is not loaded.', 'Close', { duration: 3000 });
      return;
    }
    if (this.session.fileSelection?.some(f => f.filePath === filePath)) {
      this.snackBar.open(`File '${filePath}' is already in the selection.`, 'Close', { duration: 3000 });
      return;
    }
    this.isProcessingAction = true;
    const sessionId = this.session.id;
    this.vibeService.updateSession(sessionId, { filesToAdd: [filePath] }).pipe(
        take(1),
        finalize(() => { this.isProcessingAction = false; }),
        takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.snackBar.open(`File '${filePath}' add request sent.`, 'Close', { duration: 3000 });
      },
      error: (err) => {
        this.snackBar.open(`Error adding file '${filePath}': ${err.message || 'Unknown error'}`, 'Close', { duration: 5000 });
      }
    });
  }

  public onResetSelection(): void {
    if (this.isProcessingAction) {
      this.snackBar.open('Another action is already in progress.', 'Close', { duration: 3000 });
      return;
    }
    // Using a simple browser confirm dialog for now.
    // A MatDialog would be a more polished solution for a real application.
    if (confirm('Are you sure you want to reset the file selection? Any manual changes to the file list (additions, deletions) since the last AI update will be lost, and the list will revert to what the AI last provided for review.')) {
      console.log('Reset selection confirmed and requested from VibeFileListComponent.');
      this.selectionResetRequested.emit();
      // Parent component (VibeComponent) will handle setting its own isProcessingAction state
      // when it calls the service.
    } else {
      console.log('Reset selection cancelled by user.');
    }
  }

  public submitFileUpdateInstructions(): void {
    // Check if the component is in a state to allow this action
    if (!this.session || (this.session.status !== 'file_selection_review' && this.session.status !== 'updating_file_selection')) {
      console.error('submitFileUpdateInstructions called in invalid state or session missing. Current status:', this.session?.status);
      this.snackBar.open('Cannot submit instructions: Invalid session state.', 'Close', { duration: 3000 });
      return;
    }

    const prompt = this.fileUpdateInstructionsControl.value?.trim();
    if (!prompt) {
      this.snackBar.open('Please enter instructions before submitting.', 'Close', { duration: 3000 });
      return;
    }

    const sessionId = this.session.id;
    this.isProcessingAction = true; // Indicate that an action is in progress

    console.log(`Submitting file update instructions for session ${sessionId}: "${prompt}"`);

    this.vibeService.updateFileSelection(sessionId, prompt).pipe(
        take(1),
        finalize(() => {
          this.isProcessingAction = false; // Reset loading state regardless of outcome
        }),
        takeUntil(this.destroy$) // Ensure subscription cleanup
    ).subscribe({
      next: () => {
        console.log('File selection update request sent successfully via form.');
        this.snackBar.open('Update request sent. The file selection will be revised.', 'Close', { duration: 3500 });
        this.fileUpdateInstructionsControl.reset(''); // Clear the textarea on success
        // The session will refresh due to backend status change and polling/SSE by getVibeSession
      },
      error: (err) => {
        console.error('Error requesting file selection update via form:', err);
        this.snackBar.open(`Error sending update request: ${err.message || 'Unknown error'}`, 'Close', { duration: 5000 });
      }
    });
  }
}
