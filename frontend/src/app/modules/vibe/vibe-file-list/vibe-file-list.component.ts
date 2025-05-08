import { Component, Input, Output, EventEmitter, inject, OnInit, OnDestroy } from '@angular/core';
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
export class VibeFileListComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  @Input() session: VibeSession | null = null;

  @Output() fileDeleted = new EventEmitter<SelectedFile>();
  @Output() reasonUpdated = new EventEmitter<{ file: SelectedFile, newReason: string }>();
  @Output() categoryUpdated = new EventEmitter<{ file: SelectedFile, newCategory: SelectedFile['category'] }>();
  @Output() addFileRequested = new EventEmitter<string>();
  @Output() browseFilesRequested = new EventEmitter<void>();

  displayedColumns: string[] = ['filePath', 'reason', 'category', 'actions'];
  public dialog = inject(MatDialog);
  addFileControl = new FormControl('');
  filteredFiles$: Observable<string[]>;
  public editingCategoryFilePath: string | null = null;
  public availableCategories: Array<SelectedFile['category']> = ['edit', 'reference', 'style_example', 'unknown'];

  fileUpdateInstructionsControl = new FormControl('');
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
   * @returns True if the session status is 'file_selection_review' or 'updating_file_selection', false otherwise.
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
      this.fileDeleted.emit(file);
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
      data: { reason: file.reason || '' },
    });

    dialogRef.afterClosed().subscribe(result => {
      if (typeof result === 'string') {
        this.reasonUpdated.emit({ file, newReason: result.trim() });
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
    this.categoryUpdated.emit({ file, newCategory });
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

  ngOnChange(): void {
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
          const initialParentPath = (this.rootNode.name === '.' || !this.rootNode.name) ? '' : this.rootNode.name;
          for (const child of this.rootNode.children) {
            this._extractFilePathsRecursive(child, initialParentPath, this.allFiles);
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
    if (selectedFile) {
      this.addFileRequested.emit(selectedFile);
      this.addFileControl.setValue('');
    } else {
      console.warn('VibeFileListComponent: Attempted to add an empty file path.');
    }
  }

  public onBrowseFiles(): void {
    this.browseFilesRequested.emit();
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

  /**
   * Approves the current file selection and triggers design generation.
   */
  approveSelection(): void {
    this.isProcessingAction = true;
    if (!this.session || this.session.status !== 'file_selection_review') {
      console.error('approveSelection called in invalid state or session missing:', this.session?.status);
      this.snackBar.open('Invalid state or session missing', 'Close', { duration: 3000 });
      this.isProcessingAction = false;
      return;
    }

    const sessionId = this.session.id; // Capture session ID

    this.vibeService.approveFileSelection(sessionId).pipe(
        finalize(() => this.isProcessingAction = false),
        takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        console.log('File selection approved successfully.');
        this.snackBar.open('File selection approved. Generating design...', 'Close', { duration: 3000 });
        // Trigger session refresh
        this.vibeService.getVibeSession(sessionId).pipe(take(1)).subscribe();
      },
      error: (err) => {
        console.error('Error approving file selection:', err);
        this.snackBar.open(`Error approving selection: ${err.message || 'Unknown error'}`, 'Close', { duration: 5000 });
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
      if (selectedFilePaths && Array.isArray(selectedFilePaths) && selectedFilePaths.length > 0) {
        if (this.session && this.session.id) {
          const filesToAdd = selectedFilePaths.filter(path =>
              !this.session.fileSelection?.some(sf => sf.filePath === path)
          );
          if (filesToAdd.length > 0) {
            this.isProcessingAction = true;
            this.vibeService.updateSession(this.session.id, { filesToAdd }).pipe(
                take(1),
                finalize(() => { this.isProcessingAction = false; }),
                takeUntil(this.destroy$)
            ).subscribe({
              next: () => {
                this.snackBar.open(`${filesToAdd.length} file(s) added via browser.`, 'Close', { duration: 3000 });
              },
              error: (err) => {
                this.snackBar.open(`Error adding files: ${err.message || 'Unknown error'}`, 'Close', { duration: 5000 });
              }
            });
          } else {
            this.snackBar.open('Selected file(s) are already in the list or no new files were chosen.', 'Close', { duration: 3000 });
          }
        } else {
          this.snackBar.open('Cannot add files: Current session or session ID is not available.', 'Close', { duration: 3000 });
        }
      } else if (selectedFilePaths && Array.isArray(selectedFilePaths) && selectedFilePaths.length === 0) {
        this.snackBar.open('No files selected from browser.', 'Close', {duration: 2000});
      } else {
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
