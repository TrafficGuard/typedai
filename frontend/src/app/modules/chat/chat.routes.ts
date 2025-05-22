import { Routes } from '@angular/router';
// ChatComponent will be lazy-loaded
import { ChatsComponent } from 'app/modules/chat/chats/chats.component';
import { ConversationComponent } from 'app/modules/chat/conversation/conversation.component';

export default [
    {
        path: '',
        loadComponent: () => import('./chat.component').then(m => m.ChatComponent),
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
