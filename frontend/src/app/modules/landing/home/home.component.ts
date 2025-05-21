import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'landing-home',
    templateUrl: './home.component.html',
    encapsulation: ViewEncapsulation.None,
    standalone: true,
    imports: [CommonModule, MatButtonModule, RouterLink, MatIconModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingHomeComponent {
    /**
     * Constructor
     */
    constructor() {}
}
