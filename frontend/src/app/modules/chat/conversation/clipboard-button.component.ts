import {ChangeDetectionStrategy, Component, Input, ViewEncapsulation} from "@angular/core"; // Added Input
import {MatButtonModule} from "@angular/material/button";
import {MatIconModule} from "@angular/material/icon";
import {MatTooltip} from "@angular/material/tooltip";
import {NgClass} from "@angular/common"; // Import NgClass

@Component({
    selector: 'clipboard-button',
    template: `<button mat-icon-button
                       [matTooltip]="'Copy to clipboard'"
                       class="mat-primary clipboard-button"
                       [ngClass]="marginClass" // Added
                       aria-label="Copy to clipboard">
        <mat-icon [svgIcon]="'content_paste'" class="icon-size-4"></mat-icon> <!-- Removed -mt-6 -mr-6 -->
    </button>`,
    styles: `button.clipboard-button {
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
        MatTooltip,
        NgClass // Added NgClass to imports
    ],
})
export class ClipboardButtonComponent {
    @Input() marginClass: string = ''; // Added
}
