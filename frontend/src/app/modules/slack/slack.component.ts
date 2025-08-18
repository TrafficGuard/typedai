import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

@Component({
    selector   : 'slack',
    templateUrl: './slack.component.html',
    standalone : true,
    imports    : [MatButtonModule],
})
export class SlackComponent
{
}
