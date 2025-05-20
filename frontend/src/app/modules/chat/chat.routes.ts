import { Routes } from '@angular/router';
import { ChatComponent } from 'app/modules/chat/chat.component';
import { ChatsComponent } from 'app/modules/chat/chats.component';
import { ConversationComponent } from 'app/modules/chat/conversation/conversation.component';
import { EmptyConversationComponent } from 'app/modules/chat/empty-conversation/empty-conversation.component';

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
                        component: EmptyConversationComponent,
                    },
                    {
                        path: ':id',
                        component: ConversationComponent,
                        // It's generally better to load chat data within the component
                        // or use the resolver to ensure data is ready.
                        // If the resolver handles chat loading, this effect in ConversationComponent
                        // might become redundant or could be simplified.
                        // For now, keeping as is, but this is an area for potential refactor.
                    },
                ],
            },
        ],
    },
] as Routes;
