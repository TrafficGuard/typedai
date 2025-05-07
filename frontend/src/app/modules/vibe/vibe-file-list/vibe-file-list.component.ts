import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { SelectedFile, VibeSession } from '../vibe.types';
import { VibeEditReasonDialogComponent } from '../vibe-edit-reason-dialog.component';

import { MatSelectModule } from '@angular/material/select';

@Component({
  selector: 'vibe-file-list',
  templateUrl: './vibe-file-list.component.html',
  styleUrls: ['./vibe-file-list.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatIconModule,
    MatTooltipModule,
    MatDialogModule, // Add MatDialogModule here
    VibeEditReasonDialogComponent, // Import the dialog component
    MatSelectModule,
  ],
})
export class VibeFileListComponent {
  @Input() session: VibeSession | null = null;
  @Output() fileDeleted = new EventEmitter<SelectedFile>();
  @Output() reasonUpdated = new EventEmitter<{ file: SelectedFile, newReason: string }>();
  @Output() categoryUpdated = new EventEmitter<{ file: SelectedFile, newCategory: string }>();

  displayedColumns: string[] = ['filePath', 'reason', 'category', 'actions'];
  public dialog = inject(MatDialog);
  public editingCategoryFilePath: string | null = null;
  public availableCategories: string[] = ['edit', 'reference', 'style_example', 'unknown'];

  /**
   * Checks if the current session status makes the file list read-only.
   * @returns True if the session status is 'file_selection_review' or 'updating_file_selection', false otherwise.
   */
  public get isReadOnly(): boolean {
    return this.session?.status === 'file_selection_review' || this.session?.status === 'updating_file_selection';
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
  onCategoryChange(file: SelectedFile, newCategory: string): void {
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
}
