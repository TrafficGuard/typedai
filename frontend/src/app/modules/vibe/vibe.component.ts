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


}
