import { Component, inject, OnInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { map, Observable, of, startWith, switchMap, take, Subject, takeUntil, finalize, tap } from 'rxjs';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSnackBar } from '@angular/material/snack-bar'; // Added MatSnackBar
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner'; // Added MatProgressSpinnerModule
import { MatSelectModule } from "@angular/material/select";
import { MatCardModule } from "@angular/material/card";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { VibeService } from './vibe.service';
import { VibeSession, SelectedFile } from './vibe.types';
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
    MatTooltipModule, // Add MatTooltipModule
    MatAutocompleteModule,
    RouterOutlet,
    VibeFileListComponent,
    VibeDesignReviewComponent,
    MatProgressSpinnerModule, // Add MatProgressSpinnerModule here
  ],
})
export class VibeComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Form control for the file autocomplete input
  addFileControl = new FormControl('');
  // Full list of files available in the session's workspace
  allFiles: string[] = [];
  filteredFiles$: Observable<string[]>;
  private route = inject(ActivatedRoute);
  private vibeService = inject(VibeService);
  private snackBar = inject(MatSnackBar); // Inject MatSnackBar

  session$: Observable<VibeSession>;
  currentSession: VibeSession | null = null; // Store the current session
  isProcessingAction: boolean = false; // Flag for loading state

  // constructor() {}

  /**
   * Sorts files: writable files first, then alphabetically by path.
   * @param files Array of SelectedFile objects.
   * @returns Sorted array of SelectedFile objects.
   */
  sortFiles(files: SelectedFile[]): SelectedFile[] {
    if (!files) return [];
    return files.sort((a, b) => {
      // Prioritize writable files (!readOnly means writable)
      const readOnlyCompare = (!a.readOnly ? 1 : 0) - (!b.readOnly ? 1 : 0);
      if (readOnlyCompare !== 0) {
        // If one is read-only and the other isn't, sort by that first (writable first)
        // We multiply by -1 because we want writable (true, represented as 1) to come before read-only (false, represented as 0).
        // So, 1 - 0 = 1. We want this case to be negative for sorting. 0 - 1 = -1. We want this case to be positive.
        return readOnlyCompare * -1;
      }
      // If both are read-only or both are writable, sort by filePath
      return a.filePath.localeCompare(b.filePath);
    });
  } // Closing brace for sortFiles method was missing in the previous snippet, assuming it's here.

  /**
   * Handles the fileDeleted event from the VibeFileListComponent.
   * @param file The file that was requested to be deleted.
   */
  handleFileDeleted(file: SelectedFile): void {
    console.log('Delete requested for file:', file.filePath);
    this.session$.pipe(
      take(1), // Take the current session value once
      takeUntil(this.destroy$), // Clean up subscription
      switchMap(session => {
        if (!session?.id) {
          console.error('Cannot delete file: Session ID is missing.');
          return of(null); // Or throw an error
        }
        // Call the service to update the session
        return this.vibeService.updateSession(session.id, { filesToRemove: [file.filePath] });
      })
    ).subscribe({
      next: (updatedSession) => {
        if (updatedSession) {
          console.log(`File ${file.filePath} removed successfully.`);
          // The session$ observable will automatically update the view
          // because updateSession in the service updates the BehaviorSubject.
        }
      },
      error: (err) => console.error(`Error removing file ${file.filePath}:`, err)
    });

    // Example of how you *might* update the observable if it were a BehaviorSubject
    // or if you refetch, but this is just illustrative:
    /*
    this.session$ = this.session$.pipe(
        map(session => {
            if (session?.fileSelection) {
                session.fileSelection = session.fileSelection.filter(f => f.filePath !== file.filePath);
            }
            return session;
        })
    );
    */
     // Or trigger a refetch if the service supports it easily
     // this.vibeService.getVibeSession(this.currentSessionId).subscribe(...) // simplified
  }

  /**
   * Handles the designAccepted event from the VibeDesignProposalComponent.
   * @param variations The number of variations selected by the user.
   */
  handleDesignAccepted(variations: number): void {
    console.log('Design accepted in VibeComponent with variations:', variations);
    // TODO: Implement logic to proceed with the selected variations
    // This might involve calling vibeService.updateSession(...) or similar
    // Example:
    // this.session$.pipe(take(1)).subscribe(session => {
    //   if (session) {
    //     this.vibeService.proceedWithDesign(session.id, variations).subscribe(...);
    //   }
    // });
  }


  ngOnInit() {
    // Removed: designForm initialization

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
      // Add map operator here to sort files within the stream
      map((session) => {
        if (session?.fileSelection) {
          // Sort the files and update the session object in the stream
          session.fileSelection = this.sortFiles(session.fileSelection);
        }
        return session; // Return the potentially modified session
      }),
      tap(session => this.currentSession = session), // Store the current session
      takeUntil(this.destroy$)
    );

    // Fetch the file system tree for the autocomplete when the session is available
    this.session$.pipe(
      // Use take(1) or first() if you only need the initial session's tree
      // If the tree can change, keep switchMap but ensure it handles null session
      switchMap(session => {
        if (session?.id) {
          // Fetch the file tree as a single string
          return this.vibeService.getFileSystemTree(session.id);
        }
        // Return an empty string observable if no session ID
        return of('');
      }),
      takeUntil(this.destroy$) // Clean up subscription
    ).subscribe((fileListString: string) => {
        // Split the newline-separated string into an array of file paths
        this.allFiles = fileListString ? fileListString.split('\n').filter(f => f.trim() !== '') : [];
      // Initialize or re-initialize the filtered files observable
      if (!this.filteredFiles$) {
        this.filteredFiles$ = this.addFileControl.valueChanges.pipe(
          startWith(''),
          map(value => this._filterFiles(value || '')),
          takeUntil(this.destroy$) // Clean up inner subscription
        );
      }
    });

    // Initialize filteredFiles$ here if not done above, ensuring it's set up
    if (!this.filteredFiles$) {
       this.filteredFiles$ = this.addFileControl.valueChanges.pipe(
         startWith(''),
         map(value => this._filterFiles(value || '')),
         takeUntil(this.destroy$) // Clean up inner subscription
       );
    }

    // Removed: this.codeForm = this.fb.group({ ... });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Filters the list of all files based on the input value.
   * @param value The current value from the autocomplete input.
   * @returns A filtered array of file paths.
   */
  private _filterFiles(value: string): string[] {
    const filterValue = value.toLowerCase();
    return this.allFiles.filter(file => file.toLowerCase().includes(filterValue));
  }

  /**
   * Handles adding the selected file from the autocomplete.
   */
  handleAddFile(): void {
    const selectedFile = this.addFileControl.value?.trim();

    if (!selectedFile) {
      console.warn('Attempted to add an empty file path.');
      this.snackBar.open('Please select a valid file path.', 'Close', { duration: 3000 });
      return;
    }

    if (!this.currentSession?.id) {
      console.error('Cannot add file: Session ID is missing.');
      this.snackBar.open('Cannot add file: Session is not loaded.', 'Close', { duration: 3000 });
      return;
    }

    this.isProcessingAction = true;
    const sessionId = this.currentSession.id;

    this.vibeService.updateSession(sessionId, { filesToAdd: [selectedFile] }).pipe(
      take(1), // Take only the first response
      finalize(() => this.isProcessingAction = false), // Ensure loading state is reset
      takeUntil(this.destroy$) // Clean up subscription on component destroy
    ).subscribe({
      next: () => {
        console.log(`File ${selectedFile} add request sent.`);
        this.snackBar.open('File add request sent. Session will update.', 'Close', { duration: 3000 });
        this.addFileControl.setValue(''); // Reset input after successful request
        // No need to manually trigger refresh, service update should handle it via BehaviorSubject
      },
      error: (err) => {
        console.error(`Error adding file ${selectedFile}:`, err);
        this.snackBar.open(`Error adding file: ${err.message || 'Unknown error'}`, 'Close', { duration: 5000 });
      }
    });
  }

  /**
   * Approves the current file selection and triggers design generation.
   */
  approveSelection(): void {
    this.isProcessingAction = true;
    if (!this.currentSession || this.currentSession.status !== 'file_selection_review') {
      console.error('approveSelection called in invalid state or session missing:', this.currentSession?.status);
      this.snackBar.open('Invalid state or session missing', 'Close', { duration: 3000 });
      this.isProcessingAction = false;
      return;
    }

    const sessionId = this.currentSession.id; // Capture session ID

    this.vibeService.approveFileSelection(sessionId).pipe(
      finalize(() => this.isProcessingAction = false),
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        console.log('File selection approved successfully.');
        this.snackBar.open('File selection approved. Generating design...', 'Close', { duration: 3000 });
        // Trigger session refresh
        this.vibeService.getVibeSession(sessionId).pipe(take(1)).subscribe();
      },
      error: (err) => {
        console.error('Error approving file selection:', err);
        this.snackBar.open(`Error approving selection: ${err.message || 'Unknown error'}`, 'Close', { duration: 5000 });
      }
    });
  }

  /**
   * Requests an update to the file selection based on user prompt.
   */
  requestSelectionUpdate(): void {
    this.isProcessingAction = true;
    if (!this.currentSession || this.currentSession.status !== 'file_selection_review') {
      console.error('requestSelectionUpdate called in invalid state or session missing:', this.currentSession?.status);
      this.snackBar.open('Invalid state or session missing', 'Close', { duration: 3000 });
      this.isProcessingAction = false;
      return;
    }

    const prompt = window.prompt("Enter instructions to update file selection:");

    if (prompt !== null && prompt.trim() !== '') {
      const sessionId = this.currentSession.id; // Capture session ID
      this.vibeService.updateFileSelection(sessionId, prompt).pipe(
        finalize(() => this.isProcessingAction = false),
        takeUntil(this.destroy$)
      ).subscribe({
        next: () => {
          console.log('File selection update requested successfully.');
          this.snackBar.open('File selection update requested...', 'Close', { duration: 3000 });
          // Trigger session refresh
          this.vibeService.getVibeSession(sessionId).pipe(take(1)).subscribe();
        },
        error: (err) => {
          console.error('Error requesting file selection update:', err);
          this.snackBar.open(`Error requesting update: ${err.message || 'Unknown error'}`, 'Close', { duration: 5000 });
        }
      });
    } else {
      // User cancelled or entered empty prompt
      console.log('File selection update cancelled by user.');
      this.isProcessingAction = false;
    }
  }
}
