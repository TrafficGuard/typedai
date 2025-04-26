import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip'; // Import MatTooltipModule
import { SelectedFile } from '../vibe.types';

@Component({
  selector: 'vibe-file-list',
  templateUrl: './vibe-file-list.component.html',
  standalone: true,
  imports: [
    CommonModule,
    MatListModule,
    MatIconModule,
    MatTooltipModule, // Add MatTooltipModule here
  ],
})
export class VibeFileListComponent {
  @Input() files: SelectedFile[] = [];
}
