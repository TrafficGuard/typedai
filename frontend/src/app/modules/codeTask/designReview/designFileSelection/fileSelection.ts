import { Component, inject, OnInit, OnDestroy, signal, computed, output, input, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import {FormsModule, ReactiveFormsModule} from '@angular/forms';
import { finalize, of, switchMap, take, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CodeTaskServiceClient } from "../../codeTask.service";
import { MatSnackBar } from "@angular/material/snack-bar";
import {SelectedFile} from "#shared/files/files.model";
import {FileSystemNode} from "#shared/files/fileSystemService";
import {CodeTask} from "#shared/codeTask/codeTask.model";
import {FileSelectionEditDialogComponent} from "./fileSelectionEditDialog/fileSelectionEditDialog.component";
import {
    DesignFileTreeDialogComponent
} from "../designFileTreeDialog/designFileTreeDialog.component";

@Component({
  selector: 'code-task-file-selection',
  templateUrl: './fileSelection.html',
  styleUrls: ['./fileSelection.scss'],
  standalone: true,
  imports: [
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
  ],
})
export class FileSelection {
  public dialog = inject(MatDialog);
  private codeTaskService = inject(CodeTaskServiceClient);
  private snackBar = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);

  // --- Inputs ---
  codeTask = input<CodeTask | null>(null);

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
  isReadOnly = computed(() => this.codeTask()?.status === 'updating_file_selection');

  filteredFiles = computed(() => this._filterFiles(this.addFileControlValue() || ''));

  hasUnsavedChanges = computed(() => {
    const currentCodeTask = this.codeTask();
    // If there's no codeTask, but there's local data, consider it "unsaved"
    if (!currentCodeTask) {
        return this.editableFileSelection().length > 0;
    }
    const localComparable = this._sortFilesForComparison(this.editableFileSelection());
    const codeTaskComparable = this._sortFilesForComparison(currentCodeTask.fileSelection || []);
    return JSON.stringify(localComparable) !== JSON.stringify(codeTaskComparable);
  });

  constructor() {
    // Replace effect() with RxJS subscription for codeTask input changes
    toObservable(this.codeTask).pipe(
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(currentCodeTask => {
      if (currentCodeTask?.id) {
        this.codeTaskService.getFileSystemTree(currentCodeTask.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
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
                currentCodeTask.fileSelection ? JSON.parse(JSON.stringify(currentCodeTask.fileSelection)) : []
              );
            },
            error: (err) => {
              console.error('Error fetching file system tree:', err);
              this.snackBar.open('Error loading file tree.', 'Close', { duration: 3000 });
              this.rootNode.set(null);
              this.allFiles.set([]);
              // Still set editableFileSelection from codeTask even if tree fails, as they are separate concerns
              this.editableFileSelection.set(
                currentCodeTask.fileSelection ? JSON.parse(JSON.stringify(currentCodeTask.fileSelection)) : []
              );
            }
          });
      } else {
        // CodeTask is null or has no ID, reset relevant states
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

    const dialogRef = this.dialog.open(FileSelectionEditDialogComponent, {
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

    if (!this.codeTask() || !this.codeTask()!.id) {
      this.snackBar.open('CodeTask not loaded. Cannot add file.', 'Close', { duration: 3000 });
      return;
    }

    if (this.editableFileSelection().some(f => f.filePath === selectedFile)) {
      this.snackBar.open(`File '${selectedFile}' is already in the local selection.`, 'Close', { duration: 3000 });
      return;
    }

    const dialogRef = this.dialog.open(FileSelectionEditDialogComponent, {
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
    const dialogRef = this.dialog.open(DesignFileTreeDialogComponent, {
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
    const currentCodeTask = this.codeTask();
    if (!currentCodeTask || !currentCodeTask.id) {
      this.snackBar.open('Cannot save: CodeTask not available.', 'Close', { duration: 3000 });
      return;
    }
    if (!this.hasUnsavedChanges()) {
      this.snackBar.open('No changes to save.', 'Close', { duration: 2000 });
      return;
    }

    this.isProcessingAction.set(true);
    const codeTaskId = currentCodeTask.id;
    const selectionPayload = JSON.parse(JSON.stringify(this.editableFileSelection()));

    this.codeTaskService.updateCodeTask(codeTaskId, { fileSelection: selectionPayload }).pipe(
      take(1),
      finalize(() => { this.isProcessingAction.set(false); }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (updatedCodeTask) => { // Assuming backend returns the updated codeTask
        this.snackBar.open('File selection changes saved successfully.', 'Close', { duration: 3000 });
        // Parent component is responsible for updating the codeTask input.
        // If the service call itself updates a shared observable that the parent listens to,
        // then the input `codeTask` will eventually reflect the change.
        // For immediate local reflection if parent update is delayed:
        // this.editableFileSelection.set(JSON.parse(JSON.stringify(updatedCodeTask.fileSelection)));
        // However, it's better to rely on the one-way data flow from parent.
      },
      error: (err) => {
        console.error('Error saving file selection changes:', err);
        this.snackBar.open(`Error saving changes: ${err.message || 'Unknown error'}`, 'Close', { duration: 5000 });
      }
    });
  }

  approveSelection(): void {
    const currentCodeTask = this.codeTask();
    if (!currentCodeTask || !currentCodeTask.id || currentCodeTask.status !== 'file_selection_review') {
      this.snackBar.open('Cannot approve selection: Invalid codeTask state or codeTask missing.', 'Close', { duration: 3000 });
      return;
    }

    if (!this.editableFileSelection() || this.editableFileSelection().length === 0) {
      this.snackBar.open('Cannot approve an empty file selection.', 'Close', { duration: 3000 });
      return;
    }

    this.isProcessingAction.set(true);
    const codeTaskId = currentCodeTask.id;
    const variations = this.designVariationsValue();
    const selectionPayload = JSON.parse(JSON.stringify(this.editableFileSelection()));

    const saveIfNeeded$ = this.hasUnsavedChanges()
      ? this.codeTaskService.updateCodeTask(codeTaskId, { fileSelection: selectionPayload })
      : of(null); // Using of(null) to create an observable that completes

    saveIfNeeded$.pipe(
      switchMap(() => {
        // No need to update local codeTask.fileSelection here, parent handles it.
        this.snackBar.open('File selection current. Proceeding to generate design...', 'Close', { duration: 2000 });
        return this.codeTaskService.approveFileSelection(codeTaskId, variations);
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
    const currentCodeTask = this.codeTask();
    if (!currentCodeTask || (currentCodeTask.status !== 'file_selection_review' && currentCodeTask.status !== 'updating_file_selection')) {
      console.error('submitFileUpdateInstructions called in invalid state or codeTask missing. Current status:', currentCodeTask?.status);
      this.snackBar.open('Cannot submit instructions: Invalid codeTask state.', 'Close', { duration: 3000 });
      return;
    }

    const prompt = this.fileUpdateInstructionsValue()?.trim();
    if (!prompt) {
      this.snackBar.open('Please enter instructions before submitting.', 'Close', { duration: 3000 });
      return;
    }

    const codeTaskId = currentCodeTask.id;
    this.isProcessingAction.set(true);

    this.codeTaskService.updateFileSelection(codeTaskId, prompt).pipe(
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
  //   const currentCodeTask = this.codeTask();
  //   if (!currentCodeTask?.id) {
  //     this.snackBar.open('Cannot add file: CodeTask is not loaded.', 'Close', { duration: 3000 });
  //     return;
  //   }
  //   if (currentCodeTask.fileSelection?.some(f => f.filePath === filePath)) {
  //     this.snackBar.open(`File '${filePath}' is already in the selection.`, 'Close', { duration: 3000 });
  //     return;
  //   }
  //   this.isProcessingAction.set(true);
  //   const codeTaskId = currentCodeTask.id;
  //   this.codeTaskService.updateCodeTask(codeTaskId, { filesToAdd: [filePath] }).pipe(
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
    const currentCodeTask = this.codeTask();
    if (!currentCodeTask || currentCodeTask.status !== 'file_selection_review') {
      console.error('requestSelectionUpdate called in invalid state or codeTask missing:', currentCodeTask?.status);
      this.snackBar.open('Invalid state or codeTask missing', 'Close', { duration: 3000 });
      this.isProcessingAction.set(false);
      return;
    }

    const promptValue = window.prompt("Enter instructions to update file selection:");

    if (promptValue !== null && promptValue.trim() !== '') {
      const codeTaskId = currentCodeTask.id;
      this.codeTaskService.updateFileSelection(codeTaskId, promptValue).pipe(
          finalize(() => this.isProcessingAction.set(false)),
          takeUntilDestroyed(this.destroyRef)
      ).subscribe({
        next: () => {
          this.snackBar.open('File selection update requested...', 'Close', { duration: 3000 });
          this.codeTaskService.getCodeTask(codeTaskId).pipe(take(1)).subscribe();
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
