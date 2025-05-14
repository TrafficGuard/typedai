import { BooleanInput, coerceBooleanProperty } from '@angular/cdk/coercion';
import { Platform } from '@angular/cdk/platform';
import {
    Directive,
    ElementRef,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    SimpleChanges,
    inject,
} from '@angular/core';
import {
    ScrollbarGeometry,
    ScrollbarPosition,
} from '@fuse/directives/scrollbar/scrollbar.types';
import { merge } from 'lodash-es';
import PerfectScrollbar from 'perfect-scrollbar';
import { Subject, debounceTime, fromEvent, takeUntil } from 'rxjs';

/**
 * Wrapper directive for the Perfect Scrollbar: https://github.com/mdbootstrap/perfect-scrollbar
 */
@Directive({
    selector: '[fuseScrollbar]',
    exportAs: 'fuseScrollbar',
    standalone: true,
})
export class FuseScrollbarDirective implements OnChanges, OnInit, OnDestroy {
    /* eslint-disable @typescript-eslint/naming-convention */
    static ngAcceptInputType_fuseScrollbar: BooleanInput;
    /* eslint-enable @typescript-eslint/naming-convention */

    private _elementRef = inject(ElementRef);
    private _platform = inject(Platform);

    @Input() fuseScrollbar: boolean = true;
    @Input() fuseScrollbarOptions: PerfectScrollbar.Options;

    private _animation: number;
    private _options: PerfectScrollbar.Options;
    private _ps: PerfectScrollbar;
    private _unsubscribeAll: Subject<any> = new Subject<any>();

    // -----------------------------------------------------------------------------------------------------
    // @ Accessors
    // -----------------------------------------------------------------------------------------------------

    /**
     * Getter for _elementRef
     */
    get elementRef(): ElementRef {
        return this._elementRef;
    }

    /**
     * Getter for _ps
     */
    get ps(): PerfectScrollbar | null {
        return this._ps;
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
        // Enabled
        if ('fuseScrollbar' in changes) {
            // Interpret empty string as 'true'
            this.fuseScrollbar = coerceBooleanProperty(
                changes.fuseScrollbar.currentValue
            );

            // If enabled, init the directive
            if (this.fuseScrollbar) {
                this._init();
            }
            // Otherwise destroy it
            else {
                this._destroy();
            }
        }

        // Scrollbar options
        if ('fuseScrollbarOptions' in changes) {
            // Merge the options
            this._options = merge(
                {},
                this._options,
                changes.fuseScrollbarOptions.currentValue
            );

            // Return if not initialized
            if (!this._ps) {
                return;
            }

            // Destroy and re-init the PerfectScrollbar to update its options
            setTimeout(() => {
                this._destroy();
            });

            setTimeout(() => {
                this._init();
            });
        }
    }

    /**
     * On init
     */
    ngOnInit(): void {
        // Subscribe to window resize event
        fromEvent(window, 'resize')
            .pipe(takeUntil(this._unsubscribeAll), debounceTime(150))
            .subscribe(() => {
                // Update the PerfectScrollbar
                this.update();
            });
    }

    /**
     * On destroy
     */
    ngOnDestroy(): void {
        this._destroy();

        // Unsubscribe from all subscriptions
        this._unsubscribeAll.next(null);
        this._unsubscribeAll.complete();
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * Is enabled
     */
    isEnabled(): boolean {
        return this.fuseScrollbar;
    }

    /**
     * Update the scrollbar
     */
    update(): void {
        // Return if not initialized
        if (!this._ps) {
            return;
        }

        // Update the PerfectScrollbar
        this._ps.update();
    }

    /**
     * Destroy the scrollbar
     */
    destroy(): void {
        this.ngOnDestroy();
    }

    /**
     * Returns the geometry of the scrollable element
     *
     * @param prefix
     */
    geometry(prefix: string = 'scroll'): ScrollbarGeometry {
        return new ScrollbarGeometry(
            this._elementRef.nativeElement[prefix + 'Left'],
            this._elementRef.nativeElement[prefix + 'Top'],
            this._elementRef.nativeElement[prefix + 'Width'],
            this._elementRef.nativeElement[prefix + 'Height']
        );
    }

    /**
     * Returns the position of the scrollable element
     *
     * @param absolute
     */
    position(absolute: boolean = false): ScrollbarPosition {
        let scrollbarPosition;

        if (!absolute && this._ps) {
            scrollbarPosition = new ScrollbarPosition(
                this._ps.reach.x || 0,
                this._ps.reach.y || 0
            );
        } else {
            scrollbarPosition = new ScrollbarPosition(
                this._elementRef.nativeElement.scrollLeft,
                this._elementRef.nativeElement.scrollTop
            );
        }

        return scrollbarPosition;
    }

    /**
     * Scroll to
     *
     * @param x
     * @param y
     * @param speed
     */
    scrollTo(x: number, y?: number, speed?: number): void {
        if (y == null && speed == null) {
            this.animateScrolling('scrollTop', x, speed);
        } else {
            if (x != null) {
                this.animateScrolling('scrollLeft', x, speed);
            }

            if (y != null) {
                this.animateScrolling('scrollTop', y, speed);
            }
        }
    }

    /**
     * Scroll to X
     *
     * @param x
     * @param speed
     */
    scrollToX(x: number, speed?: number): void {
        this.animateScrolling('scrollLeft', x, speed);
    }

    /**
     * Scroll to Y
     *
     * @param y
     * @param speed
     */
    scrollToY(y: number, speed?: number): void {
        this.animateScrolling('scrollTop', y, speed);
    }

    /**
     * Scroll to top
     *
     * @param offset
     * @param speed
     */
    scrollToTop(offset: number = 0, speed?: number): void {
        this.animateScrolling('scrollTop', offset, speed);
    }

    /**
     * Scroll to bottom
     *
     * @param offset
     * @param speed
     */
    scrollToBottom(offset: number = 0, speed?: number): void {
        const top =
            this._elementRef.nativeElement.scrollHeight -
            this._elementRef.nativeElement.clientHeight;
        this.animateScrolling('scrollTop', top - offset, speed);
    }

    /**
     * Scroll to left
     *
     * @param offset
     * @param speed
     */
    scrollToLeft(offset: number = 0, speed?: number): void {
        this.animateScrolling('scrollLeft', offset, speed);
    }

    /**
     * Scroll to right
     *
     * @param offset
     * @param speed
     */
    scrollToRight(offset: number = 0, speed?: number): void {
        const left =
            this._elementRef.nativeElement.scrollWidth -
            this._elementRef.nativeElement.clientWidth;
        this.animateScrolling('scrollLeft', left - offset, speed);
    }

    /**
     * Scroll to element
     *
     * @param qs
     * @param offset
     * @param ignoreVisible If true, scrollToElement won't happen if element is already inside the current viewport
     * @param speed
     */
    scrollToElement(
        qs: string,
        offset: number = 0,
        ignoreVisible: boolean = false,
        speed?: number
    ): void {
        const element = this._elementRef.nativeElement.querySelector(qs);

        if (!element) {
            return;
        }

        const elementPos = element.getBoundingClientRect();
        const scrollerPos =
            this._elementRef.nativeElement.getBoundingClientRect();

        if (this._elementRef.nativeElement.classList.contains('ps--active-x')) {
            if (
                ignoreVisible &&
                elementPos.right <= scrollerPos.right - Math.abs(offset)
            ) {
                return;
            }

            const currentPos = this._elementRef.nativeElement['scrollLeft'];
            const position = elementPos.left - scrollerPos.left + currentPos;

            this.animateScrolling('scrollLeft', position + offset, speed);
        }

        if (this._elementRef.nativeElement.classList.contains('ps--active-y')) {
            if (
                ignoreVisible &&
                elementPos.bottom <= scrollerPos.bottom - Math.abs(offset)
            ) {
                return;
            }

            const currentPos = this._elementRef.nativeElement['scrollTop'];
            const position = elementPos.top - scrollerPos.top + currentPos;

            this.animateScrolling('scrollTop', position + offset, speed);
        }
    }

    /**
     * Animate scrolling
     *
     * @param target
     * @param value
     * @param speed
     */
    animateScrolling(target: string, value: number, speed?: number): void {
        if (this._animation) {
            window.cancelAnimationFrame(this._animation);
            this._animation = null;
        }

        if (!speed || typeof window === 'undefined') {
            this._elementRef.nativeElement[target] = value;
        } else if (value !== this._elementRef.nativeElement[target]) {
            let newValue = 0;
            let scrollCount = 0;

            let oldTimestamp = performance.now();
            let oldValue = this._elementRef.nativeElement[target];

            const cosParameter = (oldValue - value) / 2;

            const step = (newTimestamp: number): void => {
                scrollCount +=
                    Math.PI / (speed / (newTimestamp - oldTimestamp));
                newValue = Math.round(
                    value + cosParameter + cosParameter * Math.cos(scrollCount)
                );

                // Only continue animation if scroll position has not changed
                if (this._elementRef.nativeElement[target] === oldValue) {
                    if (scrollCount >= Math.PI) {
                        this.animateScrolling(target, value, 0);
                    } else {
                        this._elementRef.nativeElement[target] = newValue;

                        // On a zoomed out page the resulting offset may differ
                        oldValue = this._elementRef.nativeElement[target];
                        oldTimestamp = newTimestamp;

                        this._animation = window.requestAnimationFrame(step);
                    }
                }
            };

            window.requestAnimationFrame(step);
        }
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Private methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * Initialize
     *
     * @private
     */
    private _init(): void {
        // Return if already initialized
        if (this._ps) {
            return;
        }

        // Return if on mobile or not on browser
        if (
            this._platform.ANDROID ||
            this._platform.IOS ||
            !this._platform.isBrowser
        ) {
            this.fuseScrollbar = false;
            return;
        }

        // Initialize the PerfectScrollbar
        this._ps = new PerfectScrollbar(this._elementRef.nativeElement, {
            ...this._options,
        });
    }

    /**
     * Destroy
     *
     * @private
     */
    private _destroy(): void {
        // Return if not initialized
        if (!this._ps) {
            return;
        }

        // Destroy the PerfectScrollbar
        this._ps.destroy();

        // Clean up
        this._ps = null;
    }
}
