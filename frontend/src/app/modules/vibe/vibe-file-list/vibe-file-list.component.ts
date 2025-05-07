import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip'; // Import MatTooltipModule
import { SelectedFile, VibeSession } from '../vibe.types';

@Component({
  selector: 'vibe-file-list',
  templateUrl: './vibe-file-list.component.html',
  styleUrls: ['./vibe-file-list.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatIconModule,
    MatTooltipModule, // Add MatTooltipModule here
  ],
})
export class VibeFileListComponent {
  @Input() session: VibeSession | null = null;
  @Output() fileDeleted = new EventEmitter<SelectedFile>();

  displayedColumns: string[] = ['filePath', 'reason', 'category', 'actions'];

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
}
