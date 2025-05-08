import { Component, inject, OnInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms'; // FormControl removed from here as it's not directly used for addFileControl anymore
import { Observable, of, switchMap, take, Subject, takeUntil, finalize, tap, map, startWith } from 'rxjs'; // map, startWith might be needed if other autocompletes exist
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { VibeFileTreeSelectDialogComponent } from './vibe-file-tree-select-dialog/vibe-file-tree-select-dialog.component';
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
import { VibeService } from './vibe.service';
import {VibeSession, SelectedFile, type FileSystemNode} from './vibe.types';
import { VibeFileListComponent } from './vibe-file-list/vibe-file-list.component';
import { VibeDesignReviewComponent } from './vibe-design-review/vibe-design-review.component';
import {MatChip, MatChipListbox} from "@angular/material/chips";
import {
  MatAccordion,
  MatExpansionPanel,
  MatExpansionPanelDescription,
  MatExpansionPanelHeader, MatExpansionPanelTitle
} from "@angular/material/expansion";

@Component({
  selector: 'vibe-detail',
  templateUrl: './vibe.component.html',
  styleUrls: ['./vibe.component.scss'],
  encapsulation: ViewEncapsulation.None, // Added encapsulation if needed, adjust as per project style
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
    RouterOutlet,
    VibeFileListComponent,
    VibeDesignReviewComponent,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatChip,
    MatChipListbox,
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

  session$: Observable<VibeSession>;
  private vibeService = inject(VibeService);
  currentSession: VibeSession | null = null; // Store the current session
  isProcessingAction: boolean = false; // Flag for loading state

  // constructor() {}
  private route = inject(ActivatedRoute);
  private snackBar = inject(MatSnackBar);


  ngOnInit() {
    this.session$ = this.route.paramMap.pipe(
        switchMap((params) => {
          const sessionId = params.get('id');
          if (!sessionId) {
            // Handle error case - perhaps redirect or show an error message
            console.error('Vibe Session ID not found in route parameters');
            // For now, return an empty observable or throw an error
            return new Observable<VibeSession>(); // Or throwError(() => new Error('Session ID missing'))
          }
          return this.vibeService.getVibeSession(sessionId);
        }),
        tap(session => this.currentSession = session), // Store the current session
        takeUntil(this.destroy$)
    );
  }


  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  public handleSelectionResetRequested(): void {
    if (!this.currentSession) {
      console.error('VibeComponent: Cannot handle selection reset, currentSession is null.');
      this.snackBar.open('Error: Session data not available.', 'Close', { duration: 3000 });
      return;
    }
    if (this.isProcessingAction) {
      console.warn('VibeComponent: Action already in progress, reset request ignored.');
      this.snackBar.open('Please wait, another action is in progress.', 'Close', { duration: 3000 });
      return;
    }

    console.log(`VibeComponent: Selection reset requested for session ID: ${this.currentSession.id}.`);
    this.isProcessingAction = true;

    this.vibeService.resetFileSelection(this.currentSession.id).pipe(
      take(1), // Ensure the subscription is automatically unsubscribed after one emission
      finalize(() => {
        this.isProcessingAction = false;
      }),
      takeUntil(this.destroy$) // Ensure cleanup on component destruction
    ).subscribe({
      next: () => {
        console.log(`VibeComponent: File selection reset successfully initiated for session ${this.currentSession?.id}.`);
        this.snackBar.open('File selection reset successfully. Session will refresh.', 'Close', { duration: 3500 });
        // The session should ideally refresh via the existing polling/SSE mechanism in getVibeSession
        // or by explicitly calling getVibeSession if needed.
      },
      error: (err) => {
        console.error(`VibeComponent: Error resetting file selection for session ${this.currentSession?.id}:`, err);
        this.snackBar.open(`Error resetting file selection: ${err.message || 'Unknown error'}`, 'Close', { duration: 5000 });
      }
    });
  }
}
