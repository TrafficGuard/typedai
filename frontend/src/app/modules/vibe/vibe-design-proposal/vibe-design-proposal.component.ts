import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule } from "@angular/material/select";
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card'; // Import MatCardModule
import { VibeSession } from '../vibe.types'; // Adjust path as necessary

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
    MatCardModule, // Add MatCardModule here
  ],
})
export class VibeDesignProposalComponent implements OnInit {
  @Input() session: VibeSession; // Receive session data from parent
  @Output() designAccepted = new EventEmitter<number>(); // Emit variations count on accept

  private fb = inject(FormBuilder);
  public designForm: FormGroup;

  ngOnInit(): void {
    // Initialize the design form
    this.designForm = this.fb.group({
      variations: [1, Validators.required] // Default to 1 variation, make it required
    });
  }

  /**
   * Handles the acceptance of the design and emits the selected variations count.
   */
  acceptDesign(): void {
    if (this.designForm.valid) {
      const variations = this.designForm.get('variations')?.value;
      console.log('Accept button clicked in VibeDesignProposalComponent. Variations:', variations);
      this.designAccepted.emit(variations);
    }
  }
}
