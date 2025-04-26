import { Component, inject, OnInit, OnDestroy, ViewEncapsulation } from '@angular/core'; // Added OnDestroy
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { map, Observable, of, startWith, switchMap, take, Subject, takeUntil } from 'rxjs'; // Added take, Subject, takeUntil
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule, RouterOutlet } from '@angular/router';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from "@angular/material/form-field";
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
import { VibeDesignProposalComponent } from './vibe-design-proposal/vibe-design-proposal.component'; // Import the new design proposal component

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
    MatAutocompleteModule, // Add MatAutocompleteModule here
    RouterOutlet, // Keep RouterOutlet if routing within this component is used
    VibeFileListComponent, // Keep the file list component
    VibeDesignProposalComponent,
  ],
})
export class VibeComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>(); // Subject to manage subscription cleanup

  // Form control for the file autocomplete input
  addFileControl = new FormControl('');
  // Full list of files available in the session's workspace
  allFiles: string[] = [];
  // Observable stream of files filtered based on user input
  filteredFiles$: Observable<string[]>;
  private route = inject(ActivatedRoute);
  private vibeService = inject(VibeService);
  // Removed: private fb = inject(FormBuilder);

  session$: Observable<VibeSession>;
  // Removed: public designForm: FormGroup;

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
      takeUntil(this.destroy$) // Clean up subscription
    );

    // Fetch the file system tree for the autocomplete when the session is available
    this.session$.pipe(
      switchMap(session => {
        if (session?.id) {
          return this.vibeService.getFileSystemTree(session.id);
        }
        return of([]); // Return empty array if no session ID or session is null
      }),
      takeUntil(this.destroy$) // Clean up subscription
    ).subscribe((files: string[]) => {
      this.allFiles = files;
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
    const selectedFile = this.addFileControl.value?.trim(); // Trim whitespace

    if (!selectedFile) {
        console.warn('No file selected.');
        return;
    }

    if (!this.allFiles.includes(selectedFile)) {
        console.warn('Invalid file selected or file not found in workspace:', selectedFile);
        // Optionally provide user feedback (e.g., using MatSnackBar)
        return;
    }

    this.session$.pipe(
        take(1), // Get current session state once
        takeUntil(this.destroy$), // Clean up subscription
        switchMap(session => {
            if (!session?.id) {
                console.error('Cannot add file: Session ID is missing.');
                return of(null); // Or throw an error
            }

            // Check if the file is already in the selection to avoid duplicates
            if (session.fileSelection?.some(f => f.filePath === selectedFile)) {
                console.warn(`File ${selectedFile} is already in the session.`);
                // Optionally provide user feedback
                this.addFileControl.setValue(''); // Clear input even if already added
                return of(null); // Prevent API call
            }

            // Call the service to update the session
            return this.vibeService.updateSession(session.id, { filesToAdd: [selectedFile] });
        })
    ).subscribe({
        next: (updatedSession) => {
            if (updatedSession) {
                console.log(`File ${selectedFile} added successfully.`);
                this.addFileControl.setValue(''); // Reset input after successful addition
                // View updates automatically via session$ observable
            }
            // If of(null) was returned (e.g., file already exists), do nothing further here.
        },
        error: (err) => {
            console.error(`Error adding file ${selectedFile}:`, err);
            // Optionally provide user feedback
        }
    });
  }
}
