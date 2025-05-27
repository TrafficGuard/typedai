import { Component, OnInit, ViewChild, ViewEncapsulation, computed } from '@angular/core';
import {
    FormsModule,
    NgForm,
    ReactiveFormsModule,
    UntypedFormBuilder,
    UntypedFormGroup,
    Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { fuseAnimations } from '@fuse/animations';
import { FuseAlertComponent, FuseAlertType } from '@fuse/components/alert';
import { AuthService } from 'app/core/auth/auth.service';
import { UserService } from 'app/core/user/user.service';

@Component({
    selector: 'auth-unlock-session',
    templateUrl: './unlock-session.component.html',
    encapsulation: ViewEncapsulation.None,
    animations: fuseAnimations,
    imports: [
        FuseAlertComponent,
        FormsModule,
        ReactiveFormsModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        RouterLink,
    ],
})
export class AuthUnlockSessionComponent implements OnInit {
    @ViewChild('unlockSessionNgForm') unlockSessionNgForm: NgForm;

    alert: { type: FuseAlertType; message: string } = {
        type: 'success',
        message: '',
    };
    showAlert: boolean = false;
    unlockSessionForm: UntypedFormGroup;

    private userData = computed(() => {
        const userState = this._userService.userEntityState();
        return userState.status === 'success' ? userState.data : null;
    });

    readonly name = computed(() => this.userData()?.name || '');
    private readonly email = computed(() => this.userData()?.email || '');

    /**
     * Constructor
     */
    constructor(
        private _activatedRoute: ActivatedRoute,
        private _authService: AuthService,
        private _formBuilder: UntypedFormBuilder,
        private _router: Router,
        private _userService: UserService
    ) {}

    // -----------------------------------------------------------------------------------------------------
    // @ Lifecycle hooks
    // -----------------------------------------------------------------------------------------------------

    /**
     * On init
     */
    ngOnInit(): void {
        // Create the form using computed values
        this.unlockSessionForm = this._formBuilder.group({
            name: [
                {
                    value: this.name(),
                    disabled: true,
                },
            ],
            password: ['', Validators.required],
        });
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * Unlock
     */
    unlock(): void {
        // Return if the form is invalid
        if (this.unlockSessionForm.invalid) {
            return;
        }

        // Disable the form
        this.unlockSessionForm.disable();

        // Hide the alert
        this.showAlert = false;

        this._authService
            .unlockSession({
                email: this.email() ?? '',
                password: this.unlockSessionForm.get('password').value,
            })
            .subscribe(
                () => {
                    // Set the redirect url.
                    // The '/signed-in-redirect' is a dummy url to catch the request and redirect the user
                    // to the correct page after a successful sign in. This way, that url can be set via
                    // routing file and we don't have to touch here.
                    const redirectURL =
                        this._activatedRoute.snapshot.queryParamMap.get(
                            'redirectURL'
                        ) || '/signed-in-redirect';

                    // Navigate to the redirect url
                    this._router.navigateByUrl(redirectURL).catch(console.error);
                },
                (response) => {
                    // Re-enable the form
                    this.unlockSessionForm.enable();

                    // Reset the form
                    this.unlockSessionNgForm.resetForm({
                        name: {
                            value: this.name(),
                            disabled: true,
                        },
                    });

                    // Set the alert
                    this.alert = {
                        type: 'error',
                        message: 'Invalid password',
                    };

                    // Show the alert
                    this.showAlert = true;
                }
            );
    }
}
