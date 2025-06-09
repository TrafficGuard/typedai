import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, ViewEncapsulation } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
	selector: 'clipboard-button',
	template: `<button mat-icon-button
                       [matTooltip]="'Copy to clipboard'"
                       class="mat-primary clipboard-button"
                       [ngClass]="marginClass"
                       aria-label="Copy to clipboard">
        <mat-icon [svgIcon]="'content_paste'" class="icon-size-4"></mat-icon>
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
	imports: [MatIconModule, MatButtonModule, MatTooltipModule, NgClass],
})
export class ClipboardButtonComponent {
	@Input() marginClass = '';
}
