import {ChangeDetectionStrategy, Component, ViewEncapsulation} from "@angular/core";
import {MatButtonModule} from "@angular/material/button";
import {MatIconModule} from "@angular/material/icon";
import {MatTooltip} from "@angular/material/tooltip";

@Component({
    selector: 'clipboard-button',
    template: `<button mat-icon-button
                       [matTooltip]="'Copy to clipboard'"
                       class="mat-primary clipboard-button"
                       aria-label="Copy to clipboard">
        <mat-icon [svgIcon]="'content_paste'" class="icon-size-4 -mt-6 -mr-6"></mat-icon>
    </button>`,
    styles: `button.clipboard-button {
      /* position: absolute; */ /* Removed */
      /* z-index: 1; */ /* Removed */
      opacity: 30%;
    }
    button.clipboard-button:hover {
      opacity: 100%;
    }`,
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [
        MatIconModule,
        MatButtonModule,
        MatTooltip
    ],
})
export class ClipboardButtonComponent {
    // @Input() offset: number = -0.6 // Removed
}
