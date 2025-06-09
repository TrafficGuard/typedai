import { NgClass } from '@angular/common';
import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    EmbeddedViewRef,
    inject,
    Input,
    OnChanges,
    SecurityContext,
    SimpleChanges,
    TemplateRef,
    ViewChild,
    ViewContainerRef,
    ViewEncapsulation,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { FuseHighlightService } from '@fuse/components/highlight/highlight.service';

@Component({
    selector: 'textarea[fuse-highlight]',
    templateUrl: './highlight.component.html',
    styleUrls: ['./highlight.component.scss'],
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    exportAs: 'fuseHighlight',
    imports: [NgClass],
})
export class FuseHighlightComponent implements OnChanges, AfterViewInit {
    private _domSanitizer = inject(DomSanitizer);
    private _elementRef = inject(ElementRef);
    private _fuseHighlightService = inject(FuseHighlightService);
    private _viewContainerRef = inject(ViewContainerRef);

    @Input() code: string;
    @Input() lang: string;
    @ViewChild(TemplateRef) templateRef: TemplateRef<any>;

    highlightedCode: string;
    private _viewRef: EmbeddedViewRef<any>;

    // -----------------------------------------------------------------------------------------------------
    // @ Lifecycle hooks
    // -----------------------------------------------------------------------------------------------------

    /**
     * On changes
     *
     * @param changes
     */
    ngOnChanges(changes: SimpleChanges): void {
        // Code & Lang
        if ('code' in changes || 'lang' in changes) {
            // Return if the viewContainerRef is not available
            if (!this._viewContainerRef.length) {
                return;
            }

            // Highlight and insert the code
            this._highlightAndInsert();
        }
    }

    /**
     * After view init
     */
    ngAfterViewInit(): void {
        // Return if there is no language set
        if (!this.lang) {
            return;
        }

        // If there is no code input, get the code from
        // the textarea
        if (!this.code) {
            // Get the code
            this.code = this._elementRef.nativeElement.value;
        }

        // Highlight and insert
        this._highlightAndInsert();
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Private methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * Highlight and insert the highlighted code
     *
     * @private
     */
    private _highlightAndInsert(): void {
        // Return if the template reference is not available
        if (!this.templateRef) {
            return;
        }

        // Return if the code or language is not defined
        if (!this.code || !this.lang) {
            return;
        }

        // Destroy the component if there is already one
        if (this._viewRef) {
            this._viewRef.destroy();
            this._viewRef = null;
        }

        // Highlight and sanitize the code just in case
        this.highlightedCode = this._domSanitizer.sanitize(
            SecurityContext.HTML,
            this._fuseHighlightService.highlight(this.code, this.lang)
        );

        // Return if the highlighted code is null
        if (this.highlightedCode === null) {
            return;
        }

        // Render and insert the template
        this._viewRef = this._viewContainerRef.createEmbeddedView(
            this.templateRef,
            {
                highlightedCode: this.highlightedCode,
                lang: this.lang,
            }
        );

        // Detect the changes
        this._viewRef.detectChanges();
    }
}
