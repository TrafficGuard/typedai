import { Routes } from '@angular/router';
import { ChatComponent } from 'app/modules/chat/chat.component';
import { ChatsComponent } from 'app/modules/chat/chats.component';
import { ConversationComponent } from 'app/modules/chat/conversation/conversation.component';

export default [
    {
        path: '',
        component: ChatComponent,
        children: [
            {
                path: '',
                component: ChatsComponent,
                children: [
                    {
                        path: '',
                        pathMatch: 'full',
                        redirectTo: 'new',
                    },
                    {
                        path: ':id',
                        component: ConversationComponent,
                    },
                ],
            },
        ],
    },
] as Routes;
