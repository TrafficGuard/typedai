import { Component, Input, OnInit, inject, SimpleChanges, OnChanges, ChangeDetectionStrategy, ChangeDetectorRef, Output, EventEmitter } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { VibeSession } from '../vibe.types';
import { VibeService } from '../vibe.service';

@Component({
  selector: 'vibe-design-review', // Updated selector for consistency
  templateUrl: './vibe-design-review.component.html',
  styleUrls: ['./vibe-design-review.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink, // Added for file list link
    MatFormFieldModule,
    // MatSelectModule, // Removed
    MatButtonModule,
    MatCardModule,
    MatInputModule,
    MatIconModule,
    // MatProgressSpinnerModule, // Add if using spinner overlay
  ],
  changeDetection: ChangeDetectionStrategy.OnPush, // Use OnPush for better performance
})
export class VibeDesignReviewComponent implements OnInit, OnChanges {
  @Input() session: VibeSession; // Receive session data from parent
  @Output() designSaved = new EventEmitter<string>(); // Emit updated design text on save

  public readonly allowedStatuses: string[] = ['design_review_details', 'updating_design'];

  private fb = inject(FormBuilder);
  private vibeService = inject(VibeService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private cdr = inject(ChangeDetectorRef);

  public designForm: FormGroup;
  public refinementPrompt = new FormControl('');
  public isEditing = false;
  public isLoading = false;
  private initialDesignAnswer: string | null = null;

  private checkSessionStatusAndRedirect(): boolean {
    if (!this.session) {
      // If session is not yet available, don't redirect.
      // ngOnInit or ngOnChanges will handle initialization once session is available.
      return false;
    }

    if (!this.allowedStatuses.includes(this.session.status)) {
      console.warn(`VibeDesignReviewComponent: Session status '${this.session.status}' is not allowed. Redirecting.`);
      this.snackBar.open('Invalid session state for design review. Redirecting...', 'Close', { duration: 3000 });
      this.router.navigate(['/ui/vibe']);
      return true; // Indicates redirection occurred
    }
    return false; // No redirection occurred
  }

  ngOnInit(): void {
    // Call initializeForm first as per requirements
    this.initializeForm();

    // Then check status and redirect if necessary
    if (this.checkSessionStatusAndRedirect()) {
      return; // Stop further initialization if redirected
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['session'] && this.session) {
        // Call checkSessionStatusAndRedirect *before* initializeForm as per requirements
        if (this.checkSessionStatusAndRedirect()) {
            return; // Stop further processing if redirected
        }

        // The existing commented-out status check can be removed as the new helper handles it.

        // Re-initialize form if session changes (and status is valid)
        this.initializeForm();

        // If the session's designAnswer changes externally while editing, reset editing state
        if (this.isEditing && this.session.designAnswer !== this.designForm.get('designAnswer')?.value) {
            this.cancelEdit();
        }
        this.cdr.markForCheck(); // Mark for check as input changed
    } else if (changes['session'] && !this.session) {
        // Session became null/undefined, re-initialize form (it will handle null session)
        this.initializeForm();
        this.cdr.markForCheck();
    }
  }

  private initializeForm(): void {
    this.initialDesignAnswer = this.session?.designAnswer ?? null;
    this.designForm = this.fb.group({
      designAnswer: new FormControl(
        { value: this.initialDesignAnswer ?? '', disabled: !this.isEditing }, // Set initial state based on isEditing
        Validators.required // Keep validation if needed
      ),
    });
    // No need to disable separately if done within FormControl options
  }

  /**
   * Toggles the editing state for the design proposal.
   */
  toggleEdit(): void {
    this.isEditing = !this.isEditing;
    const designAnswerControl = this.designForm.get('designAnswer');
    if (this.isEditing) {
        designAnswerControl?.enable();
    } else {
        designAnswerControl?.disable();
        // Optionally reset changes if needed, or handle via cancelEdit
        // designAnswerControl?.setValue(this.initialDesignAnswer ?? '');
    }
    this.cdr.markForCheck(); // Update view
  }

  /**
   * Cancels the editing process and reverts changes.
   */
  cancelEdit(): void {
    this.isEditing = false;
    const designAnswerControl = this.designForm.get('designAnswer');
    designAnswerControl?.setValue(this.initialDesignAnswer ?? '');
    designAnswerControl?.disable();
    this.cdr.markForCheck(); // Update view
  }

  /**
   * Saves the edited design proposal text.
   */
  saveDesign(): void {
    if (this.designForm.valid && this.isEditing) {
        const updatedDesign = this.designForm.get('designAnswer')?.value;
        this.designSaved.emit(updatedDesign);
        this.initialDesignAnswer = updatedDesign; // Update initial value after save
        this.isEditing = false; // Explicitly set editing to false
        this.designForm.get('designAnswer')?.disable(); // Ensure control is disabled
        this.cdr.markForCheck(); // Update view
    }
  }

  /**
   * Submits the refinement prompt to the backend.
   */
  submitRefinementPrompt(): void {
    const prompt = this.refinementPrompt.value?.trim();
    if (!prompt || this.isLoading || !this.session?.id) {
      return;
    }

    this.isLoading = true;
    this.cdr.markForCheck();
    const sessionId = this.session.id;

    this.vibeService.updateDesignWithPrompt(sessionId, prompt)
      .pipe(finalize(() => {
        this.isLoading = false;
        this.cdr.markForCheck();
      }))
      .subscribe({
        next: () => {
          this.snackBar.open('Refinement request submitted.', 'Close', { duration: 3000 });
          this.refinementPrompt.setValue(''); // Reset prompt input
        },
        error: (err) => {
          const message = err?.message || 'Unknown error submitting refinement prompt.';
          this.snackBar.open(message, 'Close', { duration: 5000 });
          console.error('Error submitting refinement prompt:', err);
        }
      });
  }

  /**
   * Triggers the implementation phase for the current design.
   */
  triggerImplementation(): void {
    if (this.isLoading || !this.session?.id) {
      return;
    }

    this.isLoading = true;
    this.cdr.markForCheck();
    const sessionId = this.session.id;

    this.vibeService.executeDesign(sessionId)
      .pipe(finalize(() => {
        this.isLoading = false;
        this.cdr.markForCheck();
      }))
      .subscribe({
        next: () => {
          // Navigate to the next step, e.g., coding view
          // Adjust the route as necessary based on your application structure
          this.router.navigate(['/ui/vibe', 'coding', sessionId]);
          this.snackBar.open('Design accepted. Starting implementation...', 'Close', { duration: 3000 });
        },
        error: (err) => {
          const message = err?.message || 'Unknown error starting implementation.';
          this.snackBar.open(message, 'Close', { duration: 5000 });
          console.error('Error executing design:', err);
        }
      });
  }

  /**
   * Handles the acceptance of the design. Now triggers implementation directly.
   * Should only be possible when not editing and form is valid.
   */
  acceptDesign(): void {
    // Form validation might be less critical now if only triggering implementation,
    // but keep it if the designAnswer text itself needs validation before proceeding.
    if (this.designForm.valid && !this.isEditing) {
      this.triggerImplementation();
    } else {
        console.warn('Accept design called but form invalid or in edit mode.');
    }
  }
}
