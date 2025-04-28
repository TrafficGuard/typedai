import { Component, EventEmitter, Input, OnInit, Output, inject, SimpleChanges, OnChanges } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule } from "@angular/material/select";
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatInputModule } from '@angular/material/input'; // Import MatInputModule
import { MatIconModule } from '@angular/material/icon'; // Import MatIconModule
import { VibeSession } from '../vibe.types';

@Component({
  selector: 'vibe-design-proposal',
  templateUrl: './vibe-design-proposal.component.html',
  styleUrls: ['./vibe-design-proposal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatButtonModule,
    MatCardModule,
    MatInputModule, // Add MatInputModule here
    MatIconModule, // Add MatIconModule here
  ],
})
export class VibeDesignProposalComponent implements OnInit, OnChanges {
  @Input() session: VibeSession; // Receive session data from parent
  @Output() designAccepted = new EventEmitter<number>(); // Emit variations count on accept
  @Output() designSaved = new EventEmitter<string>(); // Emit updated design text on save

  private fb = inject(FormBuilder);
  public designForm: FormGroup;
  public isEditing = false;
  private initialDesignAnswer: string | null = null;

  ngOnInit(): void {
    // Initialize the design form
    this.initializeForm();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['session'] && this.session?.designAnswer) {
        this.initializeForm();
        // If the session data changes externally while editing, reset editing state
        if (this.isEditing && this.session.designAnswer !== this.designForm.get('designAnswer')?.value) {
            this.cancelEdit();
        }
    }
  }

  private initializeForm(): void {
    this.initialDesignAnswer = this.session?.designAnswer ?? null;
    this.designForm = this.fb.group({
      variations: [1, Validators.required], // Default to 1 variation, make it required
      designAnswer: new FormControl(this.initialDesignAnswer ?? ''), // Add control for design text
    });
    // Disable designAnswer control initially
    this.designForm.get('designAnswer')?.disable();
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
  }

  /**
   * Cancels the editing process and reverts changes.
   */
  cancelEdit(): void {
    this.isEditing = false;
    const designAnswerControl = this.designForm.get('designAnswer');
    designAnswerControl?.setValue(this.initialDesignAnswer ?? '');
    designAnswerControl?.disable();
  }

  /**
   * Saves the edited design proposal text.
   */
  saveDesign(): void {
    if (this.designForm.valid && this.isEditing) {
        const updatedDesign = this.designForm.get('designAnswer')?.value;
        this.designSaved.emit(updatedDesign);
        this.initialDesignAnswer = updatedDesign; // Update initial value after save
        this.toggleEdit(); // Exit edit mode
    }
  }


  /**
   * Handles the acceptance of the design and emits the selected variations count.
   * Should only be possible when not editing.
   */
  acceptDesign(): void {
    if (this.designForm.valid && !this.isEditing) {
      const variations = this.designForm.get('variations')?.value;
      console.log('Accept button clicked in VibeDesignProposalComponent. Variations:', variations);
      this.designAccepted.emit(variations);
    }
  }
}
