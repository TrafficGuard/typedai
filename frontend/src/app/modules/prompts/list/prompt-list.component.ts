import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common'; // Add DatePipe
import { RouterModule } from '@angular/router';
import { PromptsService } from '../prompts.service';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip'; // For tooltips
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner'; // For loading
import { finalize } from 'rxjs';
import { PromptPreview } from '#shared/model/prompts.model';


@Component({
  selector: 'app-prompt-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    DatePipe, // Add DatePipe
    MatListModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './prompt-list.component.html',
  styleUrls: ['./prompt-list.component.scss']
})
export class PromptListComponent implements OnInit {
  private promptsService = inject(PromptsService);

  prompts = this.promptsService.prompts;
  isLoading = signal(true);

  ngOnInit(): void {
    this.promptsService.loadPrompts().pipe(
      finalize(() => this.isLoading.set(false))
    ).subscribe({
       error: (err) => console.error('Failed to load prompts', err)
    });
  }

  deletePrompt(event: MouseEvent, promptId: string): void {
    event.stopPropagation(); // Prevent navigation if on a clickable list item
    // Placeholder for actual deletion logic with confirmation
    if (confirm('Are you sure you want to delete this prompt? (Placeholder)')) {
      console.log('Attempting to delete prompt (placeholder):', promptId);
      // this.promptsService.deletePrompt(promptId).subscribe(...);
    }
  }
}
