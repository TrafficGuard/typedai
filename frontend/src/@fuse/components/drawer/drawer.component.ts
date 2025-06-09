import {
    animate,
    AnimationBuilder,
    AnimationPlayer,
    style,
} from '@angular/animations';
import { BooleanInput, coerceBooleanProperty } from '@angular/cdk/coercion';
import {
    Component,
    ElementRef,
    EventEmitter,
    HostBinding,
    HostListener,
    inject,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    Output,
    Renderer2,
    SimpleChanges,
    ViewEncapsulation,
} from '@angular/core';
import { FuseDrawerService } from '@fuse/components/drawer/drawer.service';
import {
    FuseDrawerMode,
    FuseDrawerPosition,
} from '@fuse/components/drawer/drawer.types';
import { FuseUtilsService } from '@fuse/services/utils/utils.service';

@Component({
    selector: 'fuse-drawer',
    templateUrl: './drawer.component.html',
    styleUrls: ['./drawer.component.scss'],
    encapsulation: ViewEncapsulation.None,
    exportAs: 'fuseDrawer',
    standalone: true,
})
export class FuseDrawerComponent implements OnChanges, OnInit, OnDestroy {
    /* eslint-disable @typescript-eslint/naming-convention */
    static ngAcceptInputType_fixed: BooleanInput;
    static ngAcceptInputType_opened: BooleanInput;
    static ngAcceptInputType_transparentOverlay: BooleanInput;
    /* eslint-enable @typescript-eslint/naming-convention */

    private _animationBuilder = inject(AnimationBuilder);
    private _elementRef = inject(ElementRef);
    private _renderer2 = inject(Renderer2);
    private _fuseDrawerService = inject(FuseDrawerService);
    private _fuseUtilsService = inject(FuseUtilsService);

    @Input() fixed: boolean = false;
    @Input() mode: FuseDrawerMode = 'side';
    @Input() name: string = this._fuseUtilsService.randomId();
    @Input() opened: boolean = false;
    @Input() position: FuseDrawerPosition = 'left';
    @Input() transparentOverlay: boolean = false;
    @Output() readonly fixedChanged: EventEmitter<boolean> =
        new EventEmitter<boolean>();
    @Output() readonly modeChanged: EventEmitter<FuseDrawerMode> =
        new EventEmitter<FuseDrawerMode>();
    @Output() readonly openedChanged: EventEmitter<boolean> =
        new EventEmitter<boolean>();
    @Output() readonly positionChanged: EventEmitter<FuseDrawerPosition> =
        new EventEmitter<FuseDrawerPosition>();

    private _animationsEnabled: boolean = false;
    private readonly _handleOverlayClick = (): void => this.close();
    private _hovered: boolean = false;
    private _overlay: HTMLElement;
    private _player: AnimationPlayer;

    // -----------------------------------------------------------------------------------------------------
    // @ Accessors
    // -----------------------------------------------------------------------------------------------------

    /**
     * Host binding for component classes
     */
    @HostBinding('class') get classList(): any {
        /* eslint-disable @typescript-eslint/naming-convention */
        return {
            'fuse-drawer-animations-enabled': this._animationsEnabled,
            'fuse-drawer-fixed': this.fixed,
            'fuse-drawer-hover': this._hovered,
            [`fuse-drawer-mode-${this.mode}`]: true,
            'fuse-drawer-opened': this.opened,
            [`fuse-drawer-position-${this.position}`]: true,
        };
        /* eslint-enable @typescript-eslint/naming-convention */
    }

    /**
     * Host binding for component inline styles
     */
    @HostBinding('style') get styleList(): any {
        return {
            visibility: this.opened ? 'visible' : 'hidden',
        };
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Decorated methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * On mouseenter
     *
     * @private
     */
    @HostListener('mouseenter')
    private _onMouseenter(): void {
        // Enable the animations
        this._enableAnimations();

        // Set the hovered
        this._hovered = true;
    }

    /**
     * On mouseleave
     *
     * @private
     */
    @HostListener('mouseleave')
    private _onMouseleave(): void {
        // Enable the animations
        this._enableAnimations();

        // Set the hovered
        this._hovered = false;
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Lifecycle hooks
    // -----------------------------------------------------------------------------------------------------

    /**
     * On changes
     *
     * @param changes
     */
    ngOnChanges(changes: SimpleChanges): void {
        // Fixed
        if ('fixed' in changes) {
            // Coerce the value to a boolean
            this.fixed = coerceBooleanProperty(changes.fixed.currentValue);

            // Execute the observable
            this.fixedChanged.next(this.fixed);
        }

        // Mode
        if ('mode' in changes) {
            // Get the previous and current values
            const previousMode = changes.mode.previousValue;
            const currentMode = changes.mode.currentValue;

            // Disable the animations
            this._disableAnimations();

            // If the mode changes: 'over -> side'
            if (previousMode === 'over' && currentMode === 'side') {
                // Hide the overlay
                this._hideOverlay();
            }

            // If the mode changes: 'side -> over'
            if (previousMode === 'side' && currentMode === 'over') {
                // If the drawer is opened
                if (this.opened) {
                    // Show the overlay
                    this._showOverlay();
                }
            }

            // Execute the observable
            this.modeChanged.next(currentMode);

            // Enable the animations after a delay
            // The delay must be bigger than the current transition-duration
            // to make sure nothing will be animated while the mode is changing
            setTimeout(() => {
                this._enableAnimations();
            }, 500);
        }

        // Opened
        if ('opened' in changes) {
            // Coerce the value to a boolean
            const open = coerceBooleanProperty(changes.opened.currentValue);

            // Open/close the drawer
            this._toggleOpened(open);
        }

        // Position
        if ('position' in changes) {
            // Execute the observable
            this.positionChanged.next(this.position);
        }

        // Transparent overlay
        if ('transparentOverlay' in changes) {
            // Coerce the value to a boolean
            this.transparentOverlay = coerceBooleanProperty(
                changes.transparentOverlay.currentValue
            );
        }
    }

    /**
     * On init
     */
    ngOnInit(): void {
        // Register the drawer
        this._fuseDrawerService.registerComponent(this.name, this);
    }

    /**
     * On destroy
     */
    ngOnDestroy(): void {
        // Finish the animation
        if (this._player) {
            this._player.finish();
        }

        // Deregister the drawer from the registry
        this._fuseDrawerService.deregisterComponent(this.name);
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * Open the drawer
     */
    open(): void {
        // Return if the drawer has already opened
        if (this.opened) {
            return;
        }

        // Open the drawer
        this._toggleOpened(true);
    }

    /**
     * Close the drawer
     */
    close(): void {
        // Return if the drawer has already closed
        if (!this.opened) {
            return;
        }

        // Close the drawer
        this._toggleOpened(false);
    }

    /**
     * Toggle the drawer
     */
    toggle(): void {
        if (this.opened) {
            this.close();
        } else {
            this.open();
        }
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Private methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * Enable the animations
     *
     * @private
     */
    private _enableAnimations(): void {
        // Return if the animations are already enabled
        if (this._animationsEnabled) {
            return;
        }

        // Enable the animations
        this._animationsEnabled = true;
    }

    /**
     * Disable the animations
     *
     * @private
     */
    private _disableAnimations(): void {
        // Return if the animations are already disabled
        if (!this._animationsEnabled) {
            return;
        }

        // Disable the animations
        this._animationsEnabled = false;
    }

    /**
     * Show the backdrop
     *
     * @private
     */
    private _showOverlay(): void {
        // Create the backdrop element
        this._overlay = this._renderer2.createElement('div');

        // Add a class to the backdrop element
        this._overlay.classList.add('fuse-drawer-overlay');

        // Add a class depending on the fixed option
        if (this.fixed) {
            this._overlay.classList.add('fuse-drawer-overlay-fixed');
        }

        // Add a class depending on the transparentOverlay option
        if (this.transparentOverlay) {
            this._overlay.classList.add('fuse-drawer-overlay-transparent');
        }

        // Append the backdrop to the parent of the drawer
        this._renderer2.appendChild(
            this._elementRef.nativeElement.parentElement,
            this._overlay
        );

        // Create enter animation and attach it to the player
        this._player = this._animationBuilder
            .build([
                style({ opacity: 0 }),
                animate(
                    '300ms cubic-bezier(0.25, 0.8, 0.25, 1)',
                    style({ opacity: 1 })
                ),
            ])
            .create(this._overlay);

        // Play the animation
        this._player.play();

        // Add an event listener to the overlay
        this._overlay.addEventListener('click', this._handleOverlayClick);
    }

    /**
     * Hide the backdrop
     *
     * @private
     */
    private _hideOverlay(): void {
        if (!this._overlay) {
            return;
        }

        // Create the leave animation and attach it to the player
        this._player = this._animationBuilder
            .build([
                animate(
                    '300ms cubic-bezier(0.25, 0.8, 0.25, 1)',
                    style({ opacity: 0 })
                ),
            ])
            .create(this._overlay);

        // Play the animation
        this._player.play();

        // Once the animation is done...
        this._player.onDone(() => {
            // If the overlay still exists...
            if (this._overlay) {
                // Remove the event listener
                this._overlay.removeEventListener(
                    'click',
                    this._handleOverlayClick
                );

                // Remove the overlay
                this._overlay.parentNode.removeChild(this._overlay);
                this._overlay = null;
            }
        });
    }

    /**
     * Open/close the drawer
     *
     * @param open
     * @private
     */
    private _toggleOpened(open: boolean): void {
        // Set the opened
        this.opened = open;

        // Enable the animations
        this._enableAnimations();

        // If the mode is 'over'
        if (this.mode === 'over') {
            // If the drawer opens, show the overlay
            if (open) {
                this._showOverlay();
            }
            // Otherwise, close the overlay
            else {
                this._hideOverlay();
            }
        }

        // Execute the observable
        this.openedChanged.next(open);
    }
}
