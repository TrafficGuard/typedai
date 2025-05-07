import { Component, Input, Output, EventEmitter, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Observable, Subject } from 'rxjs';
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
  ],
})
export class VibeFileListComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  @Input() session: VibeSession | null = null;
  @Input() allFiles: string[] = [];
  @Input() rootNode: FileSystemNode | null = null;

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

  ngOnInit(): void {
    this.filteredFiles$ = this.addFileControl.valueChanges.pipe(
      startWith(''),
      map(value => this._filterFiles(value || '')),
      takeUntil(this.destroy$)
    );
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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
  
}
