export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  online: boolean;
  lastSeen: string;
  isFriend?: boolean;
  hasPending?: boolean;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  type: 'text' | 'voice' | 'system' | 'file';
  replyTo: string | null;
  readBy: string[];
  createdAt: string;
  sender?: User;
  encrypted?: boolean;
  attachment?: {
    url: string;
    filename: string;
    size: number;
    mimetype: string;
  };
}

export interface Chat {
  id: string;
  type: 'dm' | 'group';
  name: string | null;
  avatar: string | null;
  members: User[];
  lastMessage: Message | null;
  unreadCount: number;
  createdAt: string;
  createdBy: string;
}

export interface FriendRequest {
  id: string;
  fromId: string;
  toId: string;
  status: string;
  createdAt: string;
  from?: User;
  to?: User;
}

export interface Call {
  callId: string;
  caller?: User;
  type: 'incoming' | 'outgoing' | 'group';
  status: 'ringing' | 'active' | 'ended';
  startTime?: number;
  isGroup?: boolean;
  participants?: User[];
  /** URL комнаты Daily.co для подключения */
  roomUrl?: string;
}

export type Theme = 'light' | 'dark' | 'midnight';
export type View = 'chats' | 'friends' | 'settings';
