
export interface AssistantChat {
    id: string;
    title: string;
    contactId?: string;
    unreadCount?: number;
    lastMessage?: string;
    lastMessageAt?: string;
    messages?: {
        id?: string;
        chatId?: string;
        contactId?: string;
        isMine?: boolean;
        value?: string;
        llmId?: string;
        createdAt?: string;
    }[];
}
