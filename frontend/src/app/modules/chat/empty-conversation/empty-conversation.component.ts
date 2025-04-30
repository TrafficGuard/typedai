import {
    ChangeDetectionStrategy,
    Component,
    ViewEncapsulation,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
    selector: 'chat-empty-conversation',
    templateUrl: './empty-conversation.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [MatIconModule],
})
export class EmptyConversationComponent {

}
