import {
    ChangeDetectionStrategy,
    Component,
    ViewEncapsulation,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {QuickChatComponent} from "../../layout/common/quick-chat/quick-chat.component";

@Component({
    selector: 'chat',
    templateUrl: './chat.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [CommonModule, RouterOutlet, QuickChatComponent],
})
export class ChatComponent {}
