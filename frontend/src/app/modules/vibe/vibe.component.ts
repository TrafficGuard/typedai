import { Component, inject, OnInit } from '@angular/core'; // Import inject
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { map, Observable, switchMap } from 'rxjs'; // Import switchMap and map
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule, RouterOutlet } from '@angular/router'; // Import ActivatedRoute
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule } from "@angular/material/select";
import { MatCardModule } from "@angular/material/card";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list'; // Import MatListModule
import { VibeService } from './vibe.service';
import { VibeSession } from './vibe.types'; // Import VibeSession type
import type { SelectedFile } from '#swe/discovery/selectFilesAgent'; // Import SelectedFile type
// Removed VibeListComponent import

@Component({
  selector: 'vibe-detail', // Changed selector to be more specific
  templateUrl: './vibe.component.html',
  styleUrls: ['./vibe.component.scss'],
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
    MatListModule, // Add MatListModule here
    RouterOutlet,
    // Removed VibeListComponent
  ],
})
export class VibeComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private vibeService = inject(VibeService);

  session$: Observable<VibeSession>;

  // Remove constructor if fb is no longer needed, or keep if form is added later
  // constructor(private fb: FormBuilder) {}

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
  }


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
      // Add map operator here to sort files within the stream
      map((session) => {
        if (session?.fileSelection) {
          // Sort the files and update the session object in the stream
          session.fileSelection = this.sortFiles(session.fileSelection);
        }
        return session; // Return the potentially modified session
      })
    );

    // Remove the old form initialization
    // this.codeForm = this.fb.group({ ... });
  }
}
