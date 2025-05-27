import { Component, inject, OnInit, OnDestroy, ViewEncapsulation, computed } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { Observable, switchMap, take, Subject, takeUntil, finalize, tap, map, startWith } from 'rxjs';
import { MatDialogModule } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from "@angular/material/select";
import { MatCardModule } from "@angular/material/card";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VibeServiceClient } from './vibe-service-client.service';
import { VibeFileListComponent } from './vibe-file-list/vibe-file-list.component';
import {
  MatAccordion,
  MatExpansionPanel,
  MatExpansionPanelDescription,
  MatExpansionPanelHeader, MatExpansionPanelTitle
} from "@angular/material/expansion";
import {FileSystemNode} from "#shared/services/fileSystemService";
import {VibeSession} from "#shared/model/vibe.model";

@Component({
  selector: 'vibe-detail',
  templateUrl: './vibe.component.html',
  styleUrls: ['./vibe.component.scss'],
  encapsulation: ViewEncapsulation.None,
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatIconModule,
    MatCardModule,
    MatProgressBarModule,
    MatInputModule,
    MatButtonModule,
    MatListModule,
    MatTooltipModule,
    MatAutocompleteModule,
    VibeFileListComponent,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatAccordion,
    MatExpansionPanel,
    MatExpansionPanelDescription,
    MatExpansionPanelHeader,
    MatExpansionPanelTitle,
  ],
})
export class VibeComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  fileUpdateInstructionsControl = new FormControl('');
  // Full list of files available in the session's workspace
  rootNode: FileSystemNode;
  allFiles: string[] = [];
  // filteredFiles$: Observable<string[]>; // Removed

  private vibeService = inject(VibeServiceClient);
  private route = inject(ActivatedRoute);
  private snackBar = inject(MatSnackBar);

  readonly sessionState = this.vibeService.currentSessionState;
  
  // Observable for backward compatibility with template
  readonly session$ = this.vibeService.currentSession$;
  
  // Computed property for current session
  readonly currentSession = computed(() => {
    const state = this.sessionState();
    return state.status === 'success' ? state.data : null;
  });
  
  isProcessingAction: boolean = false;
  private sessionId: string | null = null;

  ngOnInit() {
    this.route.paramMap.pipe(
      takeUntil(this.destroy$)
    ).subscribe(params => {
      this.sessionId = params.get('id');
      if (this.sessionId) {
        this.vibeService.loadSession(this.sessionId);
      } else {
        console.error('Vibe Session ID not found in route parameters');
      }
    });
  }


  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  public handleSelectionResetRequested(): void {
    const session = this.currentSession();
    if (!session) {
      console.error('VibeComponent: Cannot handle selection reset, currentSession is null.');
      this.snackBar.open('Error: Session data not available.', 'Close', { duration: 3000 });
      return;
    }
    if (this.isProcessingAction) {
      console.warn('VibeComponent: Action already in progress, reset request ignored.');
      this.snackBar.open('Please wait, another action is in progress.', 'Close', { duration: 3000 });
      return;
    }

    console.log(`VibeComponent: Selection reset requested for session ID: ${session.id}.`);
    this.isProcessingAction = true;

    this.vibeService.resetFileSelection(session.id).pipe(
      take(1), // Ensure the subscription is automatically unsubscribed after one emission
      finalize(() => {
        this.isProcessingAction = false;
      }),
      takeUntil(this.destroy$) // Ensure cleanup on component destruction
    ).subscribe({
      next: () => {
        console.log(`VibeComponent: File selection reset successfully initiated for session ${session.id}.`);
        this.snackBar.open('File selection reset successfully. Session will refresh.', 'Close', { duration: 3500 });
        // The session should ideally refresh via the existing polling/SSE mechanism in getVibeSession
        // or by explicitly calling getVibeSession if needed.
      },
      error: (err) => {
        console.error(`VibeComponent: Error resetting file selection for session ${session.id}:`, err);
        this.snackBar.open(`Error resetting file selection: ${err.message || 'Unknown error'}`, 'Close', { duration: 5000 });
      }
    });
  }
}
