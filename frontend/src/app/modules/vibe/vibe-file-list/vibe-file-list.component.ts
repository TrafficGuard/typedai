import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip'; // Import MatTooltipModule
import { SelectedFile } from '../vibe.types';

@Component({
  selector: 'vibe-file-list',
  templateUrl: './vibe-file-list.component.html',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatIconModule,
    MatTooltipModule, // Add MatTooltipModule here
  ],
})
export class VibeFileListComponent {
  @Input() files: SelectedFile[] | null | undefined = []; // Allow null/undefined
  @Input() allowDeletion: boolean = true; // Input to control deletion
  @Output() fileDeleted = new EventEmitter<SelectedFile>();

  displayedColumns: string[] = ['filePath', 'reason', 'category', 'actions'];

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
