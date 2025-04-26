import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
// Import other Material modules as needed later (e.g., MatSelectModule, MatRadioModule, MatCheckboxModule)
import { Router } from '@angular/router';
import { VibeService, CreateVibeSessionPayload } from '../vibe.service'; // Import payload type
import { VibeSession } from '../vibe.types';
import { finalize } from 'rxjs';

@Component({
	selector: 'app-new-vibe-wizard',
	standalone: true,
	imports: [
		CommonModule,
		ReactiveFormsModule,
		MatFormFieldModule,
		MatInputModule,
		MatButtonModule,
		// Add other Material modules here later
	],
	templateUrl: './new-vibe-wizard.component.html',
	styleUrl: './new-vibe-wizard.component.scss',
})
export class NewVibeWizardComponent implements OnInit {
	private fb = inject(FormBuilder);
	private vibeService = inject(VibeService);
	private router = inject(Router);

	wizardForm!: FormGroup;
	isSubmitting = false;

	ngOnInit(): void {
		this.wizardForm = this.fb.group({
			title: ['', Validators.required],
			instructions: ['', Validators.required],
			repositorySource: ['local', Validators.required], // Default value, add validation if needed
			repositoryId: ['', Validators.required], // Add validation based on source later
			repositoryName: [null], // Optional
			branch: ['', Validators.required],
			newBranchName: [null], // Optional
			useSharedRepos: [false, Validators.required], // Default value
		});
	}

	onSubmit(): void {
		if (this.wizardForm.invalid || this.isSubmitting) {
			return; // Prevent submission if form is invalid or already submitting
		}

		this.isSubmitting = true;
		// Ensure the payload matches the expected type, handle potential nulls if necessary
		const payload: CreateVibeSessionPayload = {
			...this.wizardForm.value,
			// Explicitly handle nulls if the backend expects undefined for optional fields not provided
			// repositoryName: this.wizardForm.value.repositoryName || undefined,
			// newBranchName: this.wizardForm.value.newBranchName || undefined,
		};

		this.vibeService
			.createVibeSession(payload)
			.pipe(finalize(() => (this.isSubmitting = false))) // Ensure isSubmitting is reset
			.subscribe({
				next: (createdSession: VibeSession) => {
					console.log('Vibe session created:', createdSession);
					// Navigate to a relevant view, e.g., the session detail or initialization step
					// Using placeholder '/vibe/:id' for now, adjust as needed
					this.router.navigate(['/vibe', createdSession.id]);
					// Requirement specified '/vibe/initialise/:id', adjust if that route exists/is planned
					// this.router.navigate(['/vibe', 'initialise', createdSession.id]);
				},
				error: (err) => {
					console.error('Error creating Vibe session:', err);
					// TODO: Add user-friendly error handling (e.g., snackbar)
				},
			});
	}
}
