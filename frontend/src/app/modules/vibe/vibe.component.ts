import { Component, inject, OnInit, ViewEncapsulation } from '@angular/core'; // Added ViewEncapsulation
import { ReactiveFormsModule } from '@angular/forms'; // Removed FormBuilder, FormGroup, Validators
import { map, Observable, switchMap } from 'rxjs';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule, RouterOutlet } from '@angular/router';
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
    RouterOutlet, // Keep RouterOutlet if routing within this component is used
    VibeFileListComponent, // Keep the file list component
    VibeDesignProposalComponent, // Add the new design proposal component
  ],
})
export class VibeComponent implements OnInit {
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
   * Handles the fileDeleted event from the VibeFileListComponent.
   * @param file The file that was requested to be deleted.
   */
  handleFileDeleted(file: SelectedFile): void {
    console.log('Delete requested for file:', file.filePath);
    // TODO: Implement actual file deletion logic
    // This might involve:
    // 1. Calling vibeService.updateSession(sessionId, { filesToRemove: [file.filePath] })
    // 2. Updating the local session state or relying on the observable to refresh
    // For now, we just log it. The UI won't update automatically without further changes.

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

  ngOnInit() {
    // Initialize the design form
    this.designForm = this.fb.group({
      variations: [1, Validators.required] // Default to 1 variation, make it required
    });

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
      })
    );

    // Removed: this.codeForm = this.fb.group({ ... });
  }
}
