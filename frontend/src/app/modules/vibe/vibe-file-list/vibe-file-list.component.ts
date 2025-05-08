import { Component, inject, OnInit, OnDestroy, effect, signal, computed, output, input, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms'; // Added for ngModel
import { finalize, Observable, of, Subject, switchMap, take } from 'rxjs'; // Removed tap, map, startWith, takeUntil as signals handle reactivity
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'; // For automatic unsubscription
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
// ActivatedRoute is not used directly in this component anymore, parent handles session via input
import { VibeService } from "../vibe.service";
import { MatSnackBar } from "@angular/material/snack-bar";

@Component({
  selector: 'vibe-file-list',
  templateUrl: './vibe-file-list.component.html',
  styleUrls: ['./vibe-file-list.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule, // Added for ngModel
    ReactiveFormsModule, // Kept for standalone component imports, though direct FormControl use is removed
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
export class VibeFileListComponent { // Removed OnInit, OnDestroy, OnChanges
  // --- Injected Services ---
  public dialog = inject(MatDialog);
  private vibeService = inject(VibeService);
  private snackBar = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);

  // --- Inputs ---
  session = input<VibeSession | null>(null);

  // --- Outputs ---
  fileDeleted = output<SelectedFile>();
  reasonUpdated = output<{ file: SelectedFile, newReason: string }>();
  categoryUpdated = output<{ file: SelectedFile, newCategory: SelectedFile['category'] }>();
  // addFileRequested = output<string>(); // Commented out as handleFileAddRequested is also commented out
  selectionResetRequested = output<void>();

  // --- Signals for State Management ---
  displayedColumns: string[] = ['filePath', 'reason', 'category', 'actions'];
  addFileControlValue = signal('');
  editingCategoryFilePath = signal<string | null>(null);
  availableCategories: Array<SelectedFile['category']> = ['edit', 'reference', 'style_example', 'unknown'];
  editableFileSelection = signal<SelectedFile[]>([]);
  fileUpdateInstructionsValue = signal('');
  designVariationsValue = signal(1);
  rootNode = signal<FileSystemNode | null>(null);
  allFiles = signal<string[]>([]);
  isProcessingAction = signal(false);

  // --- Computed Signals for Derived State ---
  isReadOnly = computed(() => this.session()?.status === 'updating_file_selection');

  filteredFiles = computed(() => this._filterFiles(this.addFileControlValue() || ''));

  hasUnsavedChanges = computed(() => {
    const currentSession = this.session();
    // If there's no session, but there's local data, consider it "unsaved"
    if (!currentSession) {
        return this.editableFileSelection().length > 0;
    }
    const localComparable = this._sortFilesForComparison(this.editableFileSelection());
    const sessionComparable = this._sortFilesForComparison(currentSession.fileSelection || []);
    return JSON.stringify(localComparable) !== JSON.stringify(sessionComparable);
  });

  constructor() {
    // Effect to react to session input changes (replaces ngOnChanges and parts of ngOnInit)
    effect(() => {
      const currentSession = this.session();
      if (currentSession?.id) {
        // this.isProcessingAction.set(true); // Optionally set loading for tree fetching
        this.vibeService.getFileSystemTree(currentSession.id)
          .pipe(
            takeUntilDestroyed(this.destroyRef),
            // finalize(() => this.isProcessingAction.set(false))
          )
          .subscribe({
            next: (fileSystemNode) => {
              this.rootNode.set(fileSystemNode);
              const newAllFiles: string[] = [];
              if (fileSystemNode) {
                if (fileSystemNode.type === 'directory' && fileSystemNode.children) {
                  for (const child of fileSystemNode.children) {
                    this._extractFilePathsRecursive(child, '', newAllFiles);
                  }
                } else if (fileSystemNode.type === 'file') {
                  this._extractFilePathsRecursive(fileSystemNode, '', newAllFiles);
                }
              }
              this.allFiles.set(newAllFiles);
              this.editableFileSelection.set(
                currentSession.fileSelection ? JSON.parse(JSON.stringify(currentSession.fileSelection)) : []
              );
            },
            error: (err) => {
              console.error('Error fetching file system tree:', err);
              this.snackBar.open('Error loading file tree.', 'Close', { duration: 3000 });
              this.rootNode.set(null);
              this.allFiles.set([]);
              // Still set editableFileSelection from session even if tree fails, as they are separate concerns
              this.editableFileSelection.set(
                currentSession.fileSelection ? JSON.parse(JSON.stringify(currentSession.fileSelection)) : []
              );
            }
          });
      } else {
        // Session is null or has no ID, reset relevant states
        this.rootNode.set(null);
        this.allFiles.set([]);
        this.editableFileSelection.set([]);
      }
    });
  }

  // --- File List Item Management (Local Edits) ---

  deleteFile(file: SelectedFile): void {
    if (!file.readOnly) {
      this.editableFileSelection.update(currentSelection =>
        currentSelection.filter(f => f.filePath !== file.filePath)
      );
      this.snackBar.open(`File '${file.filePath}' removed locally. Save changes to persist.`, 'Close', { duration: 3000 });
    }
  }

  editReason(file: SelectedFile): void {
    if (this.isReadOnly()) return;

    const dialogRef = this.dialog.open(VibeEditReasonDialogComponent, {
      width: '450px',
      data: {
        reason: file.reason || '',
        filePath: file.filePath,
        currentCategory: file.category || 'unknown',
        availableCategories: this.availableCategories
      }
    });

    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result && typeof result.reason === 'string') {
        this.editableFileSelection.update(currentSelection =>
          currentSelection.map(f => {
            if (f.filePath === file.filePath) {
              return {
                ...f,
                reason: result.reason.trim(),
                category: (result.category && typeof result.category === 'string') ? result.category as SelectedFile['category'] : f.category,
              };
            }
            return f;
          })
        );
        this.snackBar.open(`Details for '${file.filePath}' updated locally. Save changes to persist.`, 'Close', { duration: 3000 });
      }
    });
  }

  toggleCategoryEdit(file: SelectedFile, event: MouseEvent): void {
    if (this.isReadOnly()) return;
    this.editingCategoryFilePath.set(file.filePath);
    event.stopPropagation();
  }

  onCategoryChange(file: SelectedFile, newCategory: SelectedFile['category']): void {
    this.editableFileSelection.update(currentSelection =>
      currentSelection.map(f =>
        f.filePath === file.filePath ? { ...f, category: newCategory } : f
      )
    );
    this.snackBar.open(`Category for '${file.filePath}' updated locally to '${newCategory}'. Save changes to persist.`, 'Close', { duration: 3000 });
    this.editingCategoryFilePath.set(null);
  }

  cancelCategoryEdit(): void {
    this.editingCategoryFilePath.set(null);
  }

  // --- Adding Files to Selection ---

  onHandleAddFile(): void {
    const selectedFile = this.addFileControlValue()?.trim();
    if (!selectedFile) return;

    if (!this.session() || !this.session()!.id) {
      this.snackBar.open('Session not loaded. Cannot add file.', 'Close', { duration: 3000 });
      return;
    }

    if (this.editableFileSelection().some(f => f.filePath === selectedFile)) {
      this.snackBar.open(`File '${selectedFile}' is already in the local selection.`, 'Close', { duration: 3000 });
      return;
    }

    const dialogRef = this.dialog.open(VibeEditReasonDialogComponent, {
      width: '450px',
      data: {
        reason: '',
        filePath: selectedFile,
        availableCategories: this.availableCategories,
        currentCategory: 'unknown'
      }
    });

    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result && typeof result.reason === 'string' && selectedFile) {
        const { reason, category } = result;
        const newFileEntry: SelectedFile = {
          filePath: selectedFile,
          reason: reason.trim(),
          category: category || 'unknown',
          readOnly: false
        };
        this.editableFileSelection.update(current => [...current, newFileEntry]);
        this.snackBar.open(`File '${selectedFile}' added locally. Save changes to persist.`, 'Close', { duration: 3000 });
        this.addFileControlValue.set('');
      }
    });
  }

  onBrowseFiles(): void { // Renamed from handleBrowseFilesRequest to match template
    if (!this.rootNode()) {
      this.snackBar.open('File tree data is not loaded yet. Please wait.', 'Close', { duration: 3000 });
      return;
    }
    const dialogRef = this.dialog.open(VibeFileTreeSelectDialogComponent, {
      width: '70vw',
      maxWidth: '800px',
      maxHeight: '80vh',
      data: { rootNode: this.rootNode() }
    });

    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(selectedFilePaths => {
      if (selectedFilePaths && Array.isArray(selectedFilePaths)) {
        if (selectedFilePaths.length > 0) {
          let newFilesAddedCount = 0;
          const currentEditableSelection = this.editableFileSelection();
          const filesToAdd: SelectedFile[] = [];

          selectedFilePaths.forEach(path => {
            const alreadyExists = currentEditableSelection.some(sf => sf.filePath === path);
            if (!alreadyExists) {
              filesToAdd.push({
                filePath: path,
                reason: 'Added via file browser',
                category: 'unknown',
                readOnly: false
              });
              newFilesAddedCount++;
            }
          });

          if (newFilesAddedCount > 0) {
            this.editableFileSelection.update(current => [...current, ...filesToAdd]);
            this.snackBar.open(`${newFilesAddedCount} file(s) added to selection. Remember to save changes.`, 'Close', { duration: 3000 });
          } else {
            this.snackBar.open('Selected file(s) are already in the list or no new files were chosen.', 'Close', { duration: 3000 });
          }
        } else {
          this.snackBar.open('No files selected from browser.', 'Close', { duration: 2000 });
        }
      }
    });
  }

  // --- File Selection Actions (Interacting with Service / Parent) ---

  onSaveFileSelectionChanges(): void {
    const currentSession = this.session();
    if (!currentSession || !currentSession.id) {
      this.snackBar.open('Cannot save: Session not available.', 'Close', { duration: 3000 });
      return;
    }
    if (!this.hasUnsavedChanges()) {
      this.snackBar.open('No changes to save.', 'Close', { duration: 2000 });
      return;
    }

    this.isProcessingAction.set(true);
    const sessionId = currentSession.id;
    const selectionPayload = JSON.parse(JSON.stringify(this.editableFileSelection()));

    this.vibeService.updateSession(sessionId, { fileSelection: selectionPayload }).pipe(
      take(1),
      finalize(() => { this.isProcessingAction.set(false); }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (updatedSession) => { // Assuming backend returns the updated session
        this.snackBar.open('File selection changes saved successfully.', 'Close', { duration: 3000 });
        // Parent component is responsible for updating the session input.
        // If the service call itself updates a shared observable that the parent listens to,
        // then the input `session` will eventually reflect the change.
        // For immediate local reflection if parent update is delayed:
        // this.editableFileSelection.set(JSON.parse(JSON.stringify(updatedSession.fileSelection)));
        // However, it's better to rely on the one-way data flow from parent.
      },
      error: (err) => {
        console.error('Error saving file selection changes:', err);
        this.snackBar.open(`Error saving changes: ${err.message || 'Unknown error'}`, 'Close', { duration: 5000 });
      }
    });
  }

  approveSelection(): void {
    const currentSession = this.session();
    if (!currentSession || !currentSession.id || currentSession.status !== 'file_selection_review') {
      this.snackBar.open('Cannot approve selection: Invalid session state or session missing.', 'Close', { duration: 3000 });
      return;
    }

    if (!this.editableFileSelection() || this.editableFileSelection().length === 0) {
      this.snackBar.open('Cannot approve an empty file selection.', 'Close', { duration: 3000 });
      return;
    }

    this.isProcessingAction.set(true);
    const sessionId = currentSession.id;
    const variations = this.designVariationsValue();
    const selectionPayload = JSON.parse(JSON.stringify(this.editableFileSelection()));

    const saveIfNeeded$ = this.hasUnsavedChanges()
      ? this.vibeService.updateSession(sessionId, { fileSelection: selectionPayload })
      : of(null); // Using of(null) to create an observable that completes

    saveIfNeeded$.pipe(
      switchMap(() => {
        // No need to update local session.fileSelection here, parent handles it.
        this.snackBar.open('File selection current. Proceeding to generate design...', 'Close', { duration: 2000 });
        return this.vibeService.approveFileSelection(sessionId, variations);
      }),
      finalize(() => { this.isProcessingAction.set(false); }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        console.log('File selection approved and design generation triggered.');
        this.snackBar.open('Design generation started.', 'Close', { duration: 3000 });
        // Navigation or status update will be handled by parent or service polling
      },
      error: (err) => {
        console.error('Error during save or approve selection:', err);
        this.snackBar.open(`Error: ${err.message || 'Unknown error during approval'}`, 'Close', { duration: 5000 });
      }
    });
  }

  submitFileUpdateInstructions(): void {
    const currentSession = this.session();
    if (!currentSession || (currentSession.status !== 'file_selection_review' && currentSession.status !== 'updating_file_selection')) {
      console.error('submitFileUpdateInstructions called in invalid state or session missing. Current status:', currentSession?.status);
      this.snackBar.open('Cannot submit instructions: Invalid session state.', 'Close', { duration: 3000 });
      return;
    }

    const prompt = this.fileUpdateInstructionsValue()?.trim();
    if (!prompt) {
      this.snackBar.open('Please enter instructions before submitting.', 'Close', { duration: 3000 });
      return;
    }

    const sessionId = currentSession.id;
    this.isProcessingAction.set(true);

    this.vibeService.updateFileSelection(sessionId, prompt).pipe(
      take(1),
      finalize(() => { this.isProcessingAction.set(false); }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        this.snackBar.open('Update request sent. The file selection will be revised.', 'Close', { duration: 3500 });
        this.fileUpdateInstructionsValue.set('');
      },
      error: (err) => {
        console.error('Error requesting file selection update via form:', err);
        this.snackBar.open(`Error sending update request: ${err.message || 'Unknown error'}`, 'Close', { duration: 5000 });
      }
    });
  }

  onResetSelection(): void {
    if (this.isProcessingAction()) {
      this.snackBar.open('Another action is already in progress.', 'Close', { duration: 3000 });
      return;
    }
    if (confirm('Are you sure you want to reset the file selection? Any manual changes to the file list (additions, deletions) since the last AI update will be lost, and the list will revert to what the AI last provided for review.')) {
      this.selectionResetRequested.emit();
    }
  }

  // --- Internal Helper Methods ---

  private _filterFiles(value: string): string[] {
    if (!value) return [];
    const searchTerm = value.toLowerCase();
    const currentAllFiles = this.allFiles() || [];
    const filteredResults = currentAllFiles.filter(filePath => {
      const normalizedFilePath = filePath.toLowerCase();
      if (normalizedFilePath.startsWith(searchTerm)) return true;
      const pathParts = normalizedFilePath.split(/[/\.\-_]/);
      if (pathParts.some(part => part.startsWith(searchTerm))) return true;
      return false;
    });
    return filteredResults.slice(0, 10);
  }

  private _extractFilePathsRecursive(node: FileSystemNode, parentPath: string, allFilesList: string[]): void {
    const currentItemPath = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (node.type === 'file') {
      allFilesList.push(currentItemPath);
    } else if (node.type === 'directory' && node.children) {
      for (const child of node.children) {
        this._extractFilePathsRecursive(child, currentItemPath, allFilesList);
      }
    }
  }

  private _sortFilesForComparison(files: SelectedFile[]): Array<{ filePath: string, reason: string, category: string }> {
    if (!files) return [];
    return [...files]
      .map(f => ({ filePath: f.filePath, reason: f.reason || '', category: f.category || 'unknown' }))
      .sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  // Commented out as it seems to be dead code. The template uses onHandleAddFile.
  // public handleFileAddRequested(filePath: string): void {
  //   if (!filePath || filePath.trim() === '') {
  //     this.snackBar.open('Cannot add empty file path.', 'Close', { duration: 3000 });
  //     return;
  //   }
  //   const currentSession = this.session();
  //   if (!currentSession?.id) {
  //     this.snackBar.open('Cannot add file: Session is not loaded.', 'Close', { duration: 3000 });
  //     return;
  //   }
  //   if (currentSession.fileSelection?.some(f => f.filePath === filePath)) {
  //     this.snackBar.open(`File '${filePath}' is already in the selection.`, 'Close', { duration: 3000 });
  //     return;
  //   }
  //   this.isProcessingAction.set(true);
  //   const sessionId = currentSession.id;
  //   this.vibeService.updateSession(sessionId, { filesToAdd: [filePath] }).pipe(
  //       take(1),
  //       finalize(() => { this.isProcessingAction.set(false); }),
  //       takeUntilDestroyed(this.destroyRef)
  //   ).subscribe({
  //     next: () => {
  //       this.snackBar.open(`File '${filePath}' add request sent.`, 'Close', { duration: 3000 });
  //       // this.addFileRequested.emit(filePath); // Output event
  //     },
  //     error: (err) => {
  //       this.snackBar.open(`Error adding file '${filePath}': ${err.message || 'Unknown error'}`, 'Close', { duration: 5000 });
  //     }
  //   });
  // }

  // requestSelectionUpdate is not used in the template, seems like an alternative to submitFileUpdateInstructions
  // It uses window.prompt which is generally not good for UX.
  // Commenting out for now. If needed, it can be refactored similarly.
  /*
  requestSelectionUpdate(): void {
    this.isProcessingAction.set(true);
    const currentSession = this.session();
    if (!currentSession || currentSession.status !== 'file_selection_review') {
      console.error('requestSelectionUpdate called in invalid state or session missing:', currentSession?.status);
      this.snackBar.open('Invalid state or session missing', 'Close', { duration: 3000 });
      this.isProcessingAction.set(false);
      return;
    }

    const promptValue = window.prompt("Enter instructions to update file selection:");

    if (promptValue !== null && promptValue.trim() !== '') {
      const sessionId = currentSession.id;
      this.vibeService.updateFileSelection(sessionId, promptValue).pipe(
          finalize(() => this.isProcessingAction.set(false)),
          takeUntilDestroyed(this.destroyRef)
      ).subscribe({
        next: () => {
          this.snackBar.open('File selection update requested...', 'Close', { duration: 3000 });
          this.vibeService.getVibeSession(sessionId).pipe(take(1)).subscribe();
        },
        error: (err) => {
          this.snackBar.open(`Error requesting update: ${err.message || 'Unknown error'}`, 'Close', { duration: 5000 });
        }
      });
    } else {
      this.isProcessingAction.set(false);
    }
  }
  */
}
