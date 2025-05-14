import { inject } from '@angular/core';
import {
    ActivatedRouteSnapshot,
    Router,
    RouterStateSnapshot,
    Routes,
} from '@angular/router';
import { ChatComponent } from 'app/modules/chat/chat.component';
import { ChatServiceClient } from './chat.service';
import { ChatsComponent } from 'app/modules/chat/chats/chats.component';
import { ConversationComponent } from 'app/modules/chat/conversation/conversation.component';
import { EmptyConversationComponent } from 'app/modules/chat/empty-conversation/empty-conversation.component';
import { catchError, throwError, switchMap } from 'rxjs';

/**
 * Conversation resolver
 *
 * @param route
 * @param state
 */
const conversationResolver = (
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
) => {
    const chatService = inject(ChatServiceClient);
    const router = inject(Router);

    return chatService.loadChatById(route.paramMap.get('id')).pipe(
        // After loading, switch to an observable of the chat signal's current value
        switchMap(() => chatService.chat), // chat is a signal, switchMap will get its value once loadChatById completes
        // Error here means the requested chat is not available
        catchError((error) => {
            // Log the error
            console.error(error);

            // Get the parent url
            const parentUrl = state.url.split('/').slice(0, -1).join('/');

            // Navigate to there
            router.navigateByUrl(parentUrl).catch(console.error);

            // Throw an error
            return throwError(error);
        })
    );
};

export default [
    {
        path: '',
        component: ChatComponent,
        resolve: {
            chats: () => inject(ChatServiceClient).loadChats(),
        },
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
                        resolve: {
                            conversation: conversationResolver,
                        },
                    },
                ],
            },
        ],
    },
] as Routes;
