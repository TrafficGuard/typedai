import { Component, type OnInit, ViewEncapsulation } from '@angular/core';
import { FormsModule, ReactiveFormsModule, type UntypedFormBuilder, type UntypedFormGroup, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { fuseAnimations } from '@fuse/animations';
import { FuseAlertComponent, type FuseAlertType } from '@fuse/components/alert';
import { AuthService } from 'app/core/auth/auth.service';

@Component({
	selector: 'sign-in-classic',
	templateUrl: './sign-in.component.html',
	encapsulation: ViewEncapsulation.None,
	animations: fuseAnimations,
	standalone: true,
	imports: [
		RouterLink,
		FuseAlertComponent,
		FormsModule,
		ReactiveFormsModule,
		MatFormFieldModule,
		MatInputModule,
		MatButtonModule,
		MatIconModule,
		MatCheckboxModule,
		MatProgressSpinnerModule,
		FuseAlertComponent,
	],
})
export class AuthSignInComponent implements OnInit {
	alert: { type: FuseAlertType; message: string } = {
		type: 'success',
		message: '',
	};
	signInForm: UntypedFormGroup;
	showAlert = false;

	/**
	 * Constructor
	 */
	constructor(
		private _activatedRoute: ActivatedRoute,
		private _authService: AuthService,
		private _formBuilder: UntypedFormBuilder,
		private _router: Router,
	) {}

	// -----------------------------------------------------------------------------------------------------
	// @ Lifecycle hooks
	// -----------------------------------------------------------------------------------------------------

	/**
	 * On init
	 */
	ngOnInit(): void {
		// Create the form
		this.signInForm = this._formBuilder.group({
			email: ['', [Validators.required, Validators.email]],
			password: ['', Validators.required],
			rememberMe: [''],
		});
	}

	// -----------------------------------------------------------------------------------------------------
	// @ Public methods
	// -----------------------------------------------------------------------------------------------------

	/**
	 * Sign in
	 */
	signIn(): void {
		if (this.signInForm.invalid) return;

		// Disable the form
		this.signInForm.disable();

		// Hide the alert
		this.showAlert = false;

		// Sign in
		this._authService.signIn(this.signInForm.value).subscribe({
			next: () => {
				// Set the redirect url.
				// The '/signed-in-redirect' is a dummy url to catch the request and redirect the user
				// to the correct page after a successful sign in. This way, that url can be set via
				// routing file and we don't have to touch here.
				const redirectURL = this._activatedRoute.snapshot.queryParamMap.get('redirectURL') || '/ui/signed-in-redirect';

				// Navigate to the redirect url
				this._router.navigateByUrl(redirectURL).catch(console.error);
			},
			error: (response) => {
				console.log(`_authService.signIn error ${JSON.stringify(response)}`);
				// TODO Auth service should map to return the data
				const message = response.error?.data?.error;
				// Re-enable the form
				this.signInForm.enable();

				// Reset the form
				this.signInForm.reset();

				// Set the alert
				this.alert = {
					type: 'error',
					message: message || 'Wrong email or password',
				};

				// Show the alert
				this.showAlert = true;
			},
		});
	}
}
