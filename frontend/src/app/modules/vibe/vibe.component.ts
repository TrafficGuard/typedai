import { Component, inject, OnInit } from '@angular/core'; // Import inject
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, switchMap } from 'rxjs'; // Import switchMap
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule, RouterOutlet } from '@angular/router'; // Import ActivatedRoute
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule } from "@angular/material/select";
import { MatCardModule } from "@angular/material/card";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { VibeService } from './vibe.service';
import { VibeSession } from './vibe.types'; // Import VibeSession type
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
    );

    // Remove the old form initialization
    // this.codeForm = this.fb.group({ ... });
  }
}
