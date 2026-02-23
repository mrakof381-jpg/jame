import { create } from 'zustand';
import type { User, Chat, Message, FriendRequest, Call, Theme, View } from './types';
import { connectSocket, disconnectSocket, isListenersAttached, setListenersAttached, waitForConnect, SERVER_URL } from './socket';
import type { Socket } from 'socket.io-client';
import { encryptionManager } from './utils/encryptionManager';

interface AppState {
  // Auth
  currentUser: User | null;
  isAuthenticated: boolean;
  authError: string | null;
  authLoading: boolean;

  // Data
  friends: User[];
  chats: Chat[];
  messages: Record<string, Message[]>;
  pendingRequests: FriendRequest[];
  sentRequests: FriendRequest[];
  searchResults: User[];

  // UI
  activeChat: string | null;
  activeChatData: Chat | null;
  theme: Theme;
  view: View;
  showMobileChat: boolean;
  typingUsers: Record<string, User[]>;
  currentCall: Call | null;
  callDuration: number;
  replyTo: Message | null;
  groupCallParticipants: User[];
  remoteStreams: Map<string, MediaStream>;
  localVideoStream: MediaStream | null;
  callError: string | null;
  profileFriend: User | null;

  // Connection
  connected: boolean;
  socket: Socket | null;

  // Media (AudioContext, vibrate требуют user gesture)
  userInteracted: boolean;
  setUserInteracted: () => void;

  // Actions
  checkAuth: () => void;
  register: (username: string, password: string, displayName: string) => void;
  login: (username: string, password: string) => void;
  logout: () => void;
  searchUsers: (query: string) => void;
  sendFriendRequest: (username: string) => Promise<string | null>;
  acceptFriendRequest: (requestId: string) => void;
  declineFriendRequest: (requestId: string) => void;
  removeFriend: (friendId: string) => void;
  createChat: (type: 'dm' | 'group', memberIds: string[], name?: string) => Promise<Chat | null>;
  openChat: (chatId: string) => void;
  closeChat: () => void;
  updateChat: (chatId: string, updates: { name?: string; avatar?: string | null }) => void;
  addChatMembers: (chatId: string, memberIds: string[]) => void;
  leaveChat: (chatId: string) => void;
  hideChat: (chatId: string) => void;
  deleteChat: (chatId: string) => void;
  sendMessage: (chatId: string, text: string, replyTo?: string, type?: 'text' | 'voice') => void;
  deleteMessage: (chatId: string, messageId: string) => void;
  setTyping: (chatId: string, isTyping: boolean) => void;
  markAsRead: (chatId: string) => void;
  setTheme: (theme: Theme) => void;
  setView: (view: View) => void;
  startCall: (targetUserId: string) => void;
  startGroupCall: (participantIds: string[]) => void;
  acceptGroupCall: (callId: string) => void;
  acceptCall: () => void;
  declineCall: () => void;
  endCall: () => void;
  updateProfile: (displayName: string, bio: string, avatar?: string) => void;
  setReplyTo: (msg: Message | null) => void;
  clearSearchResults: () => void;
  clearCallError: () => void;
  setProfileFriend: (user: User | null) => void;
  toggleMute: (muted: boolean) => void;
  toggleVideo: () => Promise<void>;
  sendFile: (chatId: string, file: File, replyTo?: string) => Promise<void>;
}

export const useStore = create<AppState>((set, get) => {
  function setupListeners(socket: Socket) {
    socket.on('connect', () => {
      set({ connected: true });
      console.log('✅ Connected to server');
    });

    socket.on('disconnect', () => {
      set({ connected: false });
      console.log('❌ Disconnected from server');
    });
    
    console.log('🔧 Socket listeners attached');

    socket.on('forceDisconnect', () => {
      set({ isAuthenticated: false, currentUser: null });
      disconnectSocket();
    });

    socket.on('newMessage', async ({ message }: { message: Message }) => {
      const state = get();
      
      // Skip messages from ourselves (already added via optimistic update)
      if (message.senderId === state.currentUser?.id) return;
      
      const chatId = message.chatId;
      const currentMsgs = state.messages[chatId] || [];
      
      const exists = currentMsgs.some(m => m.id === message.id);
      if (exists) return;

      // Always use plaintext text as fallback, try to decrypt encryptedText
      let displayText = message.text;
      let isEncrypted = false;
      
      if ((message as Message & { encryptedText?: string }).encryptedText) {
        try {
          const decrypted = await encryptionManager.decrypt((message as Message & { encryptedText: string }).encryptedText, chatId);
          // Only use decrypted if it's different from the plaintext (means decryption actually worked)
          if (decrypted !== (message as Message & { encryptedText: string }).encryptedText) {
            displayText = decrypted;
            isEncrypted = true;
          }
        } catch {
          // Keep plaintext on error
          isEncrypted = false;
        }
      }

      const decryptedMessage = { ...message, text: displayText, encrypted: isEncrypted };

      const filteredMsgs = currentMsgs.filter(m => 
        !(m.id.startsWith('temp_') && m.createdAt === message.createdAt && m.senderId === message.senderId)
      );

      set({
        messages: { ...state.messages, [chatId]: [...filteredMsgs, decryptedMessage] },
        chats: state.chats.map(c => {
          if (c.id === chatId) {
            const isActive = state.activeChat === chatId;
            return {
              ...c,
              lastMessage: decryptedMessage,
              unreadCount: isActive ? c.unreadCount : c.unreadCount + (message.senderId !== state.currentUser?.id ? 1 : 0),
            };
          }
          return c;
        }).sort((a, b) => {
          const at = a.lastMessage?.createdAt || a.createdAt;
          const bt = b.lastMessage?.createdAt || b.createdAt;
          return new Date(bt).getTime() - new Date(at).getTime();
        }),
      });

      // Auto mark as read if chat is open
      if (state.activeChat === chatId && message.senderId !== state.currentUser?.id) {
        socket.emit('markAsRead', { chatId });
      }
    });

    socket.on('messageDeleted', ({ chatId, messageId }: { chatId: string; messageId: string }) => {
      const state = get();
      const msgs = (state.messages[chatId] || []).filter(m => m.id !== messageId);
      set({ messages: { ...state.messages, [chatId]: msgs } });
    });

    socket.on('messagesRead', ({ chatId, userId }: { chatId: string; userId: string }) => {
      const state = get();
      const msgs = (state.messages[chatId] || []).map(m => {
        if (!m.readBy.includes(userId)) {
          return { ...m, readBy: [...m.readBy, userId] };
        }
        return m;
      });
      set({ messages: { ...state.messages, [chatId]: msgs } });
    });

    socket.on('chatCreated', ({ chat }: { chat: Chat }) => {
      const state = get();
      if (!state.chats.find(c => c.id === chat.id)) {
        set({ chats: [chat, ...state.chats] });
      }
    });

    socket.on('chatUpdated', ({ chat }: { chat: Chat }) => {
      const state = get();
      set({
        chats: state.chats.map(c => c.id === chat.id ? chat : c),
        activeChatData: state.activeChat === chat.id ? chat : state.activeChatData,
      });
    });

    socket.on('chatLeft', ({ chatId }: { chatId: string }) => {
      const state = get();
      set({
        chats: state.chats.filter(c => c.id !== chatId),
        activeChat: state.activeChat === chatId ? null : state.activeChat,
        activeChatData: state.activeChat === chatId ? null : state.activeChatData,
        showMobileChat: state.activeChat === chatId ? false : state.showMobileChat,
        messages: Object.fromEntries(Object.entries(state.messages).filter(([id]) => id !== chatId)),
      });
    });

    socket.on('chatDeleted', ({ chatId }: { chatId: string }) => {
      const state = get();
      set({
        chats: state.chats.filter(c => c.id !== chatId),
        activeChat: state.activeChat === chatId ? null : state.activeChat,
        activeChatData: state.activeChat === chatId ? null : state.activeChatData,
        showMobileChat: state.activeChat === chatId ? false : state.showMobileChat,
        messages: Object.fromEntries(Object.entries(state.messages).filter(([id]) => id !== chatId)),
      });
    });

    socket.on('chatHidden', ({ chatId }: { chatId: string }) => {
      const state = get();
      set({
        chats: state.chats.filter(c => c.id !== chatId),
        activeChat: state.activeChat === chatId ? null : state.activeChat,
        activeChatData: state.activeChat === chatId ? null : state.activeChatData,
        showMobileChat: state.activeChat === chatId ? false : state.showMobileChat,
        messages: Object.fromEntries(Object.entries(state.messages).filter(([id]) => id !== chatId)),
      });
    });

    socket.on('friendRequestReceived', (request: FriendRequest) => {
      const state = get();
      const exists = state.pendingRequests.some(r => r.id === request.id);
      if (!exists) {
        set({ pendingRequests: [...state.pendingRequests, request] });
      }
    });

    socket.on('friendRequestAccepted', ({ friend }: { friend: User }) => {
      const state = get();
      const alreadyFriend = state.friends.some(f => f.id === friend.id);
      if (!alreadyFriend) {
        set({
          friends: [...state.friends, friend],
          sentRequests: state.sentRequests.filter(r => r.toId !== friend.id),
        });
      }
    });

    socket.on('friendRemoved', ({ userId }: { userId: string }) => {
      const state = get();
      set({ friends: state.friends.filter(f => f.id !== userId) });
    });

    socket.on('userOnline', ({ userId }: { userId: string }) => {
      const state = get();
      set({
        friends: state.friends.map(f => f.id === userId ? { ...f, online: true } : f),
        chats: state.chats.map(c => ({
          ...c,
          members: c.members.map(m => m.id === userId ? { ...m, online: true } : m),
        })),
      });
    });

    socket.on('userOffline', ({ userId, lastSeen }: { userId: string; lastSeen: string }) => {
      const state = get();
      set({
        friends: state.friends.map(f => f.id === userId ? { ...f, online: false, lastSeen } : f),
        chats: state.chats.map(c => ({
          ...c,
          members: c.members.map(m => m.id === userId ? { ...m, online: false, lastSeen } : m),
        })),
      });
    });

    socket.on('userUpdated', ({ user }: { user: User }) => {
      const state = get();
      set({
        friends: state.friends.map(f => f.id === user.id ? { ...f, ...user } : f),
      });
    });

    socket.on('userTyping', ({ chatId, user, isTyping }: { chatId: string; user: User; isTyping: boolean }) => {
      const state = get();
      const current = state.typingUsers[chatId] || [];
      if (isTyping) {
        if (!current.find(u => u.id === user.id)) {
          set({ typingUsers: { ...state.typingUsers, [chatId]: [...current, user] } });
        }
      } else {
        set({ typingUsers: { ...state.typingUsers, [chatId]: current.filter(u => u.id !== user.id) } });
      }
    });

    socket.on('incomingCall', ({ callId, caller, roomUrl }: { callId: string; caller: User; roomUrl?: string }) => {
      set({ currentCall: { callId, caller, type: 'incoming', status: 'ringing', roomUrl } });
    });

    socket.on('incomingGroupCall', ({ callId, caller, participants, roomUrl }: { callId: string; caller: User; participants: User[]; roomUrl?: string }) => {
      set({ 
        currentCall: { 
          callId, 
          caller, 
          type: 'group', 
          status: 'ringing',
          isGroup: true,
          participants,
          roomUrl
        },
        groupCallParticipants: participants
      });
    });

    socket.on('groupCallJoined', ({ callId, participants }: { callId: string; userId: string; participants: User[] }) => {
      const state = get();
      if (state.currentCall?.callId === callId) {
        set({ groupCallParticipants: participants });
      }
    });

    socket.on('groupCallLeft', ({ callId, userId, participants }: { callId: string; userId: string; participants?: User[] }) => {
      const state = get();
      if (state.currentCall?.callId === callId) {
        if (participants) {
          set({ groupCallParticipants: participants });
        } else {
          set({ groupCallParticipants: state.groupCallParticipants.filter(p => p.id !== userId) });
        }
      }
    });

    socket.on('callAccepted', ({ callId }: { callId: string }) => {
      const state = get();
      if (!state.currentCall || state.currentCall.callId !== callId) return;
      set({ currentCall: { ...state.currentCall, status: 'active', startTime: Date.now() } });
    });

    socket.on('callDeclined', () => {
      set({ currentCall: null, groupCallParticipants: [], remoteStreams: new Map(), localVideoStream: null });
    });

    socket.on('callExpired', () => {
      set({ currentCall: null, groupCallParticipants: [], remoteStreams: new Map(), localVideoStream: null });
    });

    socket.on('callEnded', () => {
      set({ currentCall: null, callDuration: 0, groupCallParticipants: [], remoteStreams: new Map(), localVideoStream: null });
    });

    socket.on('call:signal', () => {
      // Не используется с Daily.co
    });
  }

  return {
    currentUser: null,
    isAuthenticated: false,
    authError: null,
    authLoading: false,
    friends: [],
    chats: [],
    messages: {},
    pendingRequests: [],
    sentRequests: [],
    searchResults: [],
    activeChat: null,
    activeChatData: null,
    theme: (localStorage.getItem('theme') as Theme) || 'dark',
    view: 'chats',
    showMobileChat: false,
    typingUsers: {},
    currentCall: null,
    callDuration: 0,
    connected: false,
    socket: null,
    replyTo: null,
    groupCallParticipants: [],
    remoteStreams: new Map(),
    localVideoStream: null,
    callError: null,
    profileFriend: null,
    userInteracted: false,
    setUserInteracted: () => set({ userInteracted: true }),

    register: async (username, password, displayName) => {
      set({ authLoading: true, authError: null });
      const socket = connectSocket();
      if (!isListenersAttached()) {
        setupListeners(socket);
        setListenersAttached(true);
      }
      set({ socket });

      await waitForConnect(socket);

      socket.emit('register', { username, password, displayName }, (res: { user?: User; token?: string; error?: string }) => {
        if (res.error) {
          set({ authError: res.error, authLoading: false });
        } else if (res.user && res.token) {
          localStorage.setItem('authToken', res.token);
          set({ currentUser: res.user, isAuthenticated: true, authLoading: false });
          socket.emit('getInitialData', {}, (data: { friends: User[]; chats: Chat[]; pendingRequests: FriendRequest[]; sentRequests: FriendRequest[] }) => {
            set({ friends: data.friends, chats: data.chats, pendingRequests: data.pendingRequests, sentRequests: data.sentRequests });
          });
        }
      });
    },

    login: async (username, password) => {
      set({ authLoading: true, authError: null });
      const socket = connectSocket();
      if (!isListenersAttached()) {
        setupListeners(socket);
        setListenersAttached(true);
      }
      set({ socket });

      await waitForConnect(socket);

      socket.emit('login', { username, password }, (res: { user?: User; token?: string; error?: string }) => {
        if (res.error) {
          set({ authError: res.error, authLoading: false });
        } else if (res.user && res.token) {
          localStorage.setItem('authToken', res.token);
          set({ currentUser: res.user, isAuthenticated: true, authLoading: false });
          socket.emit('getInitialData', {}, (data: { friends: User[]; chats: Chat[]; pendingRequests: FriendRequest[]; sentRequests: FriendRequest[] }) => {
            set({ friends: data.friends, chats: data.chats, pendingRequests: data.pendingRequests, sentRequests: data.sentRequests });
          });
        }
      });
    },

    logout: () => {
      localStorage.removeItem('authToken');
      disconnectSocket();
      set({
        currentUser: null, isAuthenticated: false, friends: [], chats: [], messages: {},
        pendingRequests: [], sentRequests: [], activeChat: null, activeChatData: null,
        connected: false, socket: null, searchResults: [], currentCall: null,
      });
    },

    checkAuth: async () => {
      const token = localStorage.getItem('authToken');
      if (!token) return;
      
      const socket = connectSocket();
      if (!isListenersAttached()) {
        setupListeners(socket);
        setListenersAttached(true);
      }
      set({ socket });

      await waitForConnect(socket);

      socket.emit('checkSession', { token }, (res: { user?: User; error?: string }) => {
        if (res.user) {
          set({ currentUser: res.user, isAuthenticated: true, authLoading: false });
          socket.emit('getInitialData', {}, (data: { friends: User[]; chats: Chat[]; pendingRequests: FriendRequest[]; sentRequests: FriendRequest[] }) => {
            set({ friends: data.friends, chats: data.chats, pendingRequests: data.pendingRequests, sentRequests: data.sentRequests });
          });
        } else {
          localStorage.removeItem('authToken');
        }
      });
    },

    searchUsers: (query) => {
      const { socket } = get();
      if (!socket) return;
      socket.emit('searchUsers', { query }, (res: { users?: User[] }) => {
        set({ searchResults: res.users || [] });
      });
    },

    sendFriendRequest: (username) => {
      return new Promise((resolve) => {
        const { socket, currentUser, sentRequests } = get();
        if (!socket) return resolve('Нет соединения');
        
        const existingPending = sentRequests.find(r => 
          r.to?.username?.toLowerCase() === username.toLowerCase() || r.toId
        );
        if (existingPending) {
          resolve('Заявка уже отправлена');
          return;
        }
        
        const tempRequest: FriendRequest = {
          id: `temp_${Date.now()}`,
          fromId: currentUser?.id || '',
          toId: '',
          status: 'pending',
          createdAt: new Date().toISOString(),
          to: undefined,
        };
        
        const state = get();
        set({ sentRequests: [...state.sentRequests, tempRequest] });
        
        socket.emit('sendFriendRequest', { toUsername: username }, (res: { success?: boolean; error?: string; request?: FriendRequest }) => {
          if (res.error) {
            const currState = get();
            set({ sentRequests: currState.sentRequests.filter(r => r.id !== tempRequest.id) });
            resolve(res.error);
          } else if (res.request) {
            const currState = get();
            const filtered = currState.sentRequests.filter(r => 
              r.id !== tempRequest.id && r.toId !== res.request!.toId
            );
            set({ sentRequests: [...filtered, res.request] });
            resolve(null);
          }
        });
      });
    },

    acceptFriendRequest: (requestId) => {
      const { socket } = get();
      if (!socket) return;
      socket.emit('acceptFriendRequest', { requestId }, (res: { success?: boolean; friend?: User }) => {
        if (res.friend) {
          const state = get();
          set({
            friends: [...state.friends, res.friend],
            pendingRequests: state.pendingRequests.filter(r => r.id !== requestId),
          });
        }
      });
    },

    declineFriendRequest: (requestId) => {
      const { socket } = get();
      if (!socket) return;
      socket.emit('declineFriendRequest', { requestId }, () => {
        const state = get();
        set({ pendingRequests: state.pendingRequests.filter(r => r.id !== requestId) });
      });
    },

    removeFriend: (friendId) => {
      const { socket } = get();
      if (!socket) return;
      socket.emit('removeFriend', { friendId }, () => {
        const state = get();
        set({ friends: state.friends.filter(f => f.id !== friendId) });
      });
    },

    createChat: (type, memberIds, name) => {
      return new Promise((resolve) => {
        const { socket } = get();
        if (!socket) return resolve(null);
        socket.emit('createChat', { type, memberIds, name }, (res: { chat?: Chat; error?: string }) => {
          if (res.chat) {
            const state = get();
            const exists = state.chats.find(c => c.id === res.chat!.id);
            if (!exists) {
              set({ chats: [res.chat, ...state.chats] });
            }
            resolve(res.chat);
          } else {
            resolve(null);
          }
        });
      });
    },

    openChat: (chatId) => {
      const state = get();
      const chat = state.chats.find(c => c.id === chatId);
      set({ activeChat: chatId, activeChatData: chat || null, showMobileChat: true, replyTo: null });

      const { socket } = get();
      if (!socket) return;

      socket.emit('getMessages', { chatId }, async (res: { messages?: Message[] }) => {
        if (res.messages) {
          const decrypted = await Promise.all(res.messages.map(async (msg) => {
            let displayText = msg.text;
            let isEncrypted = false;
            if ((msg as Message & { encryptedText?: string }).encryptedText) {
              try {
                const decryptedText = await encryptionManager.decrypt((msg as Message & { encryptedText: string }).encryptedText, chatId);
                if (decryptedText !== (msg as Message & { encryptedText: string }).encryptedText) {
                  displayText = decryptedText;
                  isEncrypted = true;
                }
              } catch {}
            }
            return { ...msg, text: displayText, encrypted: isEncrypted };
          }));
          set({ messages: { ...get().messages, [chatId]: decrypted } });
        }
      });
      socket.emit('markAsRead', { chatId });
      set({
        chats: get().chats.map(c => c.id === chatId ? { ...c, unreadCount: 0 } : c),
      });
    },

    closeChat: () => {
      set({ activeChat: null, activeChatData: null, showMobileChat: false, replyTo: null });
    },

    updateChat: (chatId, updates) => {
      const { socket } = get();
      if (!socket) return;
      socket.emit('updateChat', { chatId, ...updates }, (res: { chat?: Chat; error?: string }) => {
        if (res.chat) {
          const state = get();
          set({
            chats: state.chats.map(c => c.id === chatId ? res.chat! : c),
            activeChatData: state.activeChat === chatId ? res.chat! : state.activeChatData,
          });
        }
      });
    },

    addChatMembers: (chatId, memberIds) => {
      const { socket } = get();
      if (!socket) return;
      socket.emit('addChatMembers', { chatId, memberIds }, (res: { chat?: Chat; error?: string }) => {
        if (res.chat) {
          const state = get();
          set({
            chats: state.chats.map(c => c.id === chatId ? res.chat! : c),
            activeChatData: state.activeChat === chatId ? res.chat! : state.activeChatData,
          });
        }
      });
    },

    leaveChat: (chatId) => {
      const { socket } = get();
      if (!socket) return;
      socket.emit('leaveChat', { chatId }, () => {
        const state = get();
        set({
          chats: state.chats.filter(c => c.id !== chatId),
          activeChat: state.activeChat === chatId ? null : state.activeChat,
          activeChatData: state.activeChat === chatId ? null : state.activeChatData,
          showMobileChat: state.activeChat === chatId ? false : state.showMobileChat,
          messages: Object.fromEntries(Object.entries(state.messages).filter(([id]) => id !== chatId)),
        });
      });
    },

    hideChat: (chatId) => {
      const { socket } = get();
      if (!socket) return;
      socket.emit('hideChat', { chatId }, () => {
        const state = get();
        set({
          chats: state.chats.filter(c => c.id !== chatId),
          activeChat: state.activeChat === chatId ? null : state.activeChat,
          activeChatData: state.activeChat === chatId ? null : state.activeChatData,
          showMobileChat: state.activeChat === chatId ? false : state.showMobileChat,
          messages: Object.fromEntries(Object.entries(state.messages).filter(([id]) => id !== chatId)),
        });
      });
    },

    deleteChat: (chatId) => {
      const { socket } = get();
      if (!socket) return;
      socket.emit('deleteChat', { chatId }, () => {
        const state = get();
        set({
          chats: state.chats.filter(c => c.id !== chatId),
          activeChat: state.activeChat === chatId ? null : state.activeChat,
          activeChatData: state.activeChat === chatId ? null : state.activeChatData,
          showMobileChat: state.activeChat === chatId ? false : state.showMobileChat,
          messages: Object.fromEntries(Object.entries(state.messages).filter(([id]) => id !== chatId)),
        });
      });
    },

    sendMessage: async (chatId, text, replyTo, type = 'text') => {
      const { socket, currentUser } = get();
      const msgType = (type || 'text') as string;
      if (!socket || (!text.trim() && msgType === 'text')) return;
      
      const trimmedText = text.trim();
      const shouldEncrypt = msgType !== 'voice' && msgType !== 'file';
      const encryptedText = shouldEncrypt ? await encryptionManager.encrypt(trimmedText, chatId) : null;
      
      const tempId = `temp_${Date.now()}`;
      const tempMessage: Message = {
        id: tempId,
        chatId,
        senderId: currentUser?.id || '',
        sender: currentUser ?? undefined,
        text: trimmedText,
        type: type || 'text',
        replyTo: replyTo || null,
        readBy: [currentUser?.id || ''],
        createdAt: new Date().toISOString(),
        encrypted: true,
      };
      
      const state = get();
      const currentMessages = state.messages[chatId] || [];
      set({
        messages: { ...state.messages, [chatId]: [...currentMessages, tempMessage] },
        replyTo: null,
        chats: state.chats.map(c => {
          if (c.id === chatId) {
            return { ...c, lastMessage: tempMessage };
          }
          return c;
        }),
      });
      
      socket.emit('sendMessage', { chatId, text: trimmedText, encryptedText, type, replyTo }, (res: { message?: Message }) => {
        if (!res.message) {
          // Remove temp message if failed
          const currState = get();
          const filtered = (currState.messages[chatId] || []).filter(m => m.id !== tempId);
          set({ messages: { ...currState.messages, [chatId]: filtered } });
          return;
        }
        const currState = get();
        const updatedMsgs = (currState.messages[chatId] || []).map(m => 
          m.id === tempId ? { ...res.message!, encrypted: true, sender: currentUser ?? undefined } : m
        );
        set({ messages: { ...currState.messages, [chatId]: updatedMsgs } });
      });
    },

    deleteMessage: (chatId, messageId) => {
      const { socket } = get();
      if (!socket) return;
      socket.emit('deleteMessage', { chatId, messageId }, () => {});
    },

    setTyping: (chatId, isTyping) => {
      const { socket } = get();
      if (!socket) return;
      socket.emit('typing', { chatId, isTyping });
    },

    markAsRead: (chatId) => {
      const { socket } = get();
      if (!socket) return;
      socket.emit('markAsRead', { chatId });
    },

    setTheme: (theme) => {
      localStorage.setItem('theme', theme);
      set({ theme });
    },

    setView: (view) => { set({ view }); },

    startCall: (targetUserId) => {
      const { socket, friends } = get();
      if (!socket) return;
      const target = friends.find(f => f.id === targetUserId);
      socket.emit('startCall', { targetUserId }, (res: { callId?: string; roomUrl?: string; error?: string }) => {
        if (res.error) {
          set({ currentCall: null, callError: res.error });
          return;
        }
        set({ callError: null });
        if (res.callId) {
          set({ currentCall: { callId: res.callId, caller: target, type: 'outgoing', status: 'ringing', roomUrl: res.roomUrl } });
        }
      });
    },

    startGroupCall: (participantIds: string[]) => {
      const { socket, currentUser, friends } = get();
      if (!socket || !participantIds.length) return;
      
      const participants = participantIds.map(id => friends.find(f => f.id === id)).filter(Boolean) as User[];
      socket.emit('startGroupCall', { participantIds }, (res: { callId?: string; participants?: User[]; roomUrl?: string; error?: string }) => {
        if (res.error) {
          set({ currentCall: null, callError: res.error });
          return;
        }
        set({ callError: null });
        if (res.callId) {
          const allParticipants = [currentUser, ...(res.participants || [])].filter(Boolean) as User[];
          set({ 
            currentCall: { 
              callId: res.callId, 
              caller: currentUser || undefined, 
              type: 'group', 
              status: 'ringing',
              isGroup: true,
              participants: allParticipants,
              roomUrl: res.roomUrl
            },
            groupCallParticipants: allParticipants
          });
        }
      });
    },

    acceptGroupCall: (callId: string) => {
      const { socket } = get();
      if (!socket) return;
      socket.emit('acceptGroupCall', { callId }, (res: { success?: boolean; participants?: User[] }) => {
        if (res.success && res.participants) {
          const state = get();
          const call = state.currentCall?.callId === callId ? state.currentCall : null;
          set({ 
            groupCallParticipants: res.participants,
            ...(call ? { currentCall: { ...call, status: 'active', startTime: Date.now() } } : {})
          });
        }
      });
    },

    acceptCall: () => {
      const { socket, currentCall } = get();
      if (!socket || !currentCall) return;
      socket.emit('acceptCall', { callId: currentCall.callId });
      set({ currentCall: { ...currentCall, status: 'active', startTime: Date.now() } });
    },

    declineCall: () => {
      const { socket, currentCall } = get();
      if (!socket || !currentCall) return;
      socket.emit('declineCall', { callId: currentCall.callId });
      set({ currentCall: null, groupCallParticipants: [], remoteStreams: new Map(), localVideoStream: null });
    },

    endCall: () => {
      const { socket, currentCall } = get();
      if (!socket || !currentCall) return;
      socket.emit('endCall', { callId: currentCall.callId });
      set({ currentCall: null, callDuration: 0, groupCallParticipants: [], remoteStreams: new Map(), localVideoStream: null });
    },

    updateProfile: (displayName, bio, avatar) => {
      const { socket } = get();
      if (!socket) return;
      socket.emit('updateProfile', { displayName, bio, avatar }, (res: { user?: User }) => {
        if (res.user) {
          set({ currentUser: res.user });
        }
      });
    },

    setReplyTo: (msg) => { set({ replyTo: msg }); },
    clearSearchResults: () => { set({ searchResults: [] }); },
    clearCallError: () => { set({ callError: null }); },
    setProfileFriend: (user) => { set({ profileFriend: user }); },
    toggleMute: () => {
      // Daily.co управляет микрофоном в своём UI
    },

    toggleVideo: async () => {
      // Daily.co управляет камерой в своём UI
    },

    sendFile: async (chatId, file, replyTo) => {
      const { socket, currentUser } = get();
      if (!socket) return;

      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch(`${SERVER_URL}/api/upload`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error('Upload failed');
        }

        const result = await response.json();

        const tempId = `temp_${Date.now()}`;
        const tempMessage: Message = {
          id: tempId,
          chatId,
          senderId: currentUser?.id || '',
          sender: currentUser ?? undefined,
          text: file.name,
          type: 'file',
          replyTo: replyTo || null,
          readBy: [currentUser?.id || ''],
          createdAt: new Date().toISOString(),
          attachment: {
            url: result.url,
            filename: result.filename,
            size: result.size,
            mimetype: result.mimetype,
          },
        };

        const state = get();
        set({
          messages: { ...state.messages, [chatId]: [...(state.messages[chatId] || []), tempMessage] },
          replyTo: null,
        });

        socket.emit('sendMessage', { 
          chatId, 
          text: file.name, 
          type: 'file', 
          replyTo,
          attachment: tempMessage.attachment
        }, (res: { message?: Message }) => {
          if (res.message) {
            const currState = get();
            const updatedMsgs = (currState.messages[chatId] || []).map(m => 
              m.id === tempId ? { ...res.message!, sender: currentUser ?? undefined } : m
            );
            set({ messages: { ...currState.messages, [chatId]: updatedMsgs } });
          }
        });
      } catch (error) {
        console.error('File upload failed:', error);
      }
    },
  };
});
