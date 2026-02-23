import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { Avatar } from './Avatar';
import {
  ArrowLeft, Phone, MoreVertical, Send, Smile, Reply, User,
  Trash2, X, Check, CheckCheck, Mic, Square, Play, Pause, Lock, Paperclip, File, Image, Video,
  UserPlus, Pencil, LogOut
} from 'lucide-react';

const EMOJIS = ['😀','😂','🥰','😎','🤔','👍','❤️','🔥','🎉','✨','😢','😡','🙏','💪','👏','🤣','😍','🥺','😤','💀','👀','🫡','💯','⭐','🎵'];

function AddMembersModal({
  chatId,
  currentMemberIds,
  friends,
  onAdd,
  onClose,
}: {
  chatId: string;
  currentMemberIds: string[];
  friends: { id: string; displayName: string; username: string }[];
  onAdd: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const available = friends.filter(f => !currentMemberIds.includes(f.id));
  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 max-w-md w-full max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-white mb-4">Добавить участников</h3>
        <div className="overflow-y-auto flex-1 space-y-1 mb-4">
          {available.length === 0 ? (
            <p className="text-gray-500 text-sm">Все друзья уже в чате</p>
          ) : (
            available.map(f => (
              <button
                key={f.id}
                onClick={() => toggle(f.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${selected.includes(f.id) ? 'bg-violet-500/20 text-violet-300' : 'hover:bg-white/5 text-white'}`}
              >
                <Avatar user={f} size="md" />
                <span className="font-medium">{f.displayName}</span>
                <span className="text-gray-500 text-sm">@{f.username}</span>
                {selected.includes(f.id) && <Check className="w-4 h-4 ml-auto text-violet-400" />}
              </button>
            ))
          )}
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-white/10 text-white">Отмена</button>
          <button onClick={() => onAdd(selected)} disabled={selected.length === 0} className="px-4 py-2 rounded-xl bg-violet-600 text-white disabled:opacity-50">Добавить</button>
        </div>
      </div>
    </div>
  );
}

function EditChatModal({
  name,
  avatar,
  onNameChange,
  onAvatarChange,
  onSave,
  onClose,
}: {
  name: string;
  avatar: string | null;
  onNameChange: (v: string) => void;
  onAvatarChange: (v: string | null) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => onAvatarChange(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-white mb-4">Название и аватар</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Название чата</label>
            <input
              value={name}
              onChange={e => onNameChange(e.target.value)}
              className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-violet-500/50"
              placeholder="Группа"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Аватар</label>
            <input type="file" ref={fileRef} accept="image/*" className="hidden" onChange={handleFile} />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-14 h-14 rounded-xl bg-white/10 flex items-center justify-center text-gray-400 hover:bg-white/15"
              >
                {avatar ? <img src={avatar} alt="" className="w-full h-full rounded-xl object-cover" /> : <Image className="w-6 h-6" />}
              </button>
              <span className="text-sm text-gray-500">Нажмите, чтобы загрузить</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-white/10 text-white">Отмена</button>
          <button onClick={onSave} className="px-4 py-2 rounded-xl bg-violet-600 text-white">Сохранить</button>
        </div>
      </div>
    </div>
  );
}

function AudioPlayer({ src }: { src: string }) {
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const setAudioData = () => setDuration(audio.duration);
    const setAudioTime = () => setCurrentTime(audio.currentTime);

    audio.addEventListener('loadeddata', setAudioData);
    audio.addEventListener('timeupdate', setAudioTime);
    audio.addEventListener('ended', () => setPlaying(false));

    return () => {
      audio.removeEventListener('loadeddata', setAudioData);
      audio.removeEventListener('timeupdate', setAudioTime);
    };
  }, []);

  const togglePlay = () => {
    if (playing) audioRef.current?.pause();
    else audioRef.current?.play();
    setPlaying(!playing);
  };

  const formatTime = (time: number) => {
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-3 min-w-[200px] py-1">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        onClick={togglePlay}
        className="w-10 h-10 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-all"
      >
        {playing ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-1" />}
      </button>
      <div className="flex-1">
        <div className="h-1.5 w-full bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-white transition-all duration-100"
            style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
          />
        </div>
        <div className="flex justify-between mt-1 text-[10px] opacity-70">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

export function ChatView() {
  const {
    currentUser, activeChat, activeChatData, messages, typingUsers, friends,
    closeChat, sendMessage, deleteMessage, setTyping, startCall,
    startGroupCall, replyTo, setReplyTo, sendFile, setProfileFriend,
    updateChat, addChatMembers, leaveChat, hideChat, deleteChat,
  } = useStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [showEditChat, setShowEditChat] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAvatar, setEditAvatar] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showDmDeleteChoice, setShowDmDeleteChoice] = useState(false);
  const [contextMsg, setContextMsg] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const recordingInterval = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chatMessages = activeChat ? (messages[activeChat] || []) : [];
  const typing = activeChat ? (typingUsers[activeChat] || []) : [];
  const chat = activeChatData;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeChat]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];

      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };

      mediaRecorder.current.onstop = () => {
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result as string;
          if (activeChat) sendMessage(activeChat, base64data, replyTo?.id, 'voice');
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.current.start();
      setIsRecording(true);
      setRecordingDuration(0);
      recordingInterval.current = setInterval(() => {
        setRecordingDuration(d => d + 1);
      }, 1000);
    } catch (err) {
      console.error('Failed to start recording', err);
      alert('Нет доступа к микрофону');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      setIsRecording(false);
      if (recordingInterval.current) clearInterval(recordingInterval.current);
    }
  };

  if (!chat || !activeChat) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 flex items-center justify-center mx-auto mb-4">
            <span className="text-4xl">💬</span>
          </div>
          <h3 className="text-lg font-semibold text-gray-400">Выберите чат</h3>
          <p className="text-sm text-gray-500 mt-1">Выберите чат из списка слева</p>
        </div>
      </div>
    );
  }

  const otherUser = chat.type === 'dm' ? chat.members.find(m => m.id !== currentUser?.id) : null;
  const chatName = chat.type === 'group' ? (chat.name || 'Группа') : (otherUser?.displayName || 'Чат');
  const chatStatus = chat.type === 'dm'
    ? (otherUser?.online ? 'в сети' : 'не в сети')
    : `${chat.members.length} участников`;

  const handleSend = () => {
    if (!text.trim()) return;
    sendMessage(activeChat, text, replyTo?.id);
    setText('');
    setShowEmoji(false);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    setTyping(activeChat, false);
  };

  const handleTyping = (val: string) => {
    setText(val);
    setTyping(activeChat, true);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      setTyping(activeChat, false);
    }, 2000);
  };

  const formatTime = (d: string) => new Date(d).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

  const groupByDate = (msgs: typeof chatMessages) => {
    const groups: { date: string; messages: typeof chatMessages }[] = [];
    msgs.forEach(m => {
      const d = new Date(m.createdAt);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      let dateStr: string;
      if (d.toDateString() === today.toDateString()) dateStr = 'Сегодня';
      else if (d.toDateString() === yesterday.toDateString()) dateStr = 'Вчера';
      else dateStr = d.toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' });

      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.date === dateStr) {
        lastGroup.messages.push(m);
      } else {
        groups.push({ date: dateStr, messages: [m] });
      }
    });
    return groups;
  };

  const dateGroups = groupByDate(chatMessages);
  const replyMessage = replyTo ? chatMessages.find(m => m.id === replyTo.id) : null;

  return (
    <div className="flex-1 flex flex-col h-full relative">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 border-b border-white/10 backdrop-blur-xl bg-white/5 shrink-0">
        <button
          onClick={closeChat}
          className="md:hidden p-2 rounded-xl hover:bg-white/10 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <Avatar user={otherUser || { id: chat.id, username: chatName, displayName: chatName, avatar: '#6366f1', bio: '', online: false, lastSeen: '' }} size="md" showStatus={chat.type === 'dm'} />
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-sm truncate">{chatName}</h3>
          <p className={`text-xs ${otherUser?.online ? 'text-emerald-400' : 'text-gray-500'}`}>
            {typing.length > 0
              ? `${typing.map(u => u.displayName).join(', ')} печатает...`
              : chatStatus}
          </p>
        </div>
        <div className="flex gap-1">
          {chat.type === 'dm' && otherUser && (
            <button
              onClick={() => startCall(otherUser.id)}
              className="p-2.5 rounded-xl hover:bg-white/10 text-gray-400 hover:text-emerald-400 transition-all"
              title="Позвонить"
            >
              <Phone className="w-5 h-5" />
            </button>
          )}
          {chat.type === 'group' && (
            <button
              onClick={() => {
                const memberIds = chat.members.filter(m => m.id !== currentUser?.id).map(m => m.id);
                if (memberIds.length > 0) {
                  startGroupCall(memberIds);
                }
              }}
              className="p-2.5 rounded-xl hover:bg-white/10 text-gray-400 hover:text-emerald-400 transition-all"
              title="Начать групповой звонок"
            >
              <Phone className="w-5 h-5" />
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2.5 rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition-all"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-white/10 rounded-xl shadow-2xl py-1 z-20 min-w-[200px]">
                  {chat.type === 'dm' && otherUser && (
                    <>
                      <button
                        onClick={() => { setProfileFriend(otherUser); setShowMenu(false); }}
                        className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/5 text-white flex items-center gap-2"
                      >
                        <User className="w-4 h-4" /> Профиль
                      </button>
                      <button
                        onClick={() => { setShowDmDeleteChoice(true); setShowMenu(false); }}
                        className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/5 text-red-400 flex items-center gap-2"
                      >
                        <Trash2 className="w-4 h-4" /> Удалить переписку
                      </button>
                    </>
                  )}
                  {chat.type === 'group' && (
                    <>
                      {chat.createdBy === currentUser?.id && (
                        <>
                          <button
                            onClick={() => { setShowAddMembers(true); setShowMenu(false); }}
                            className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/5 text-white flex items-center gap-2"
                          >
                            <UserPlus className="w-4 h-4" /> Добавить участников
                          </button>
                          <button
                            onClick={() => { setEditName(chat.name || ''); setEditAvatar(chat.avatar || null); setShowEditChat(true); setShowMenu(false); }}
                            className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/5 text-white flex items-center gap-2"
                          >
                            <Pencil className="w-4 h-4" /> Название и аватар
                          </button>
                          <button
                            onClick={() => { setConfirmDelete(true); setShowMenu(false); }}
                            className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/5 text-red-400 flex items-center gap-2"
                          >
                            <Trash2 className="w-4 h-4" /> Удалить чат
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => { setConfirmLeave(true); setShowMenu(false); }}
                        className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/5 text-white flex items-center gap-2"
                      >
                        <LogOut className="w-4 h-4" /> Покинуть чат
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => { closeChat(); setShowMenu(false); }}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/5 text-gray-400 flex items-center gap-2 border-t border-white/10 mt-1 pt-2"
                  >
                    <X className="w-4 h-4" /> Закрыть чат
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 custom-scroll">
        {dateGroups.map(group => (
          <div key={group.date}>
            <div className="flex justify-center mb-4">
              <span className="text-xs text-gray-500 bg-white/5 px-4 py-1.5 rounded-full">{group.date}</span>
            </div>
            <div className="space-y-2">
              {group.messages.map(msg => {
                const isMe = msg.senderId === currentUser?.id;
                const sender = msg.sender;
                const repliedMsg = msg.replyTo ? chatMessages.find(m => m.id === msg.replyTo) : null;

                return (
                  <div
                    key={msg.id}
                    className={`flex ${isMe ? 'justify-end' : 'justify-start'} group`}
                    onContextMenu={(e) => { e.preventDefault(); if (isMe) setContextMsg(msg.id); }}
                  >
                    <div className={`flex gap-2 max-w-[80%] ${isMe ? 'flex-row-reverse' : ''}`}>
                      {!isMe && chat.type === 'group' && (
                        <Avatar user={sender} size="sm" />
                      )}
                      <div className="relative">
                        {/* Reply preview */}
                        {repliedMsg && (
                          <div className={`text-xs px-3 py-1.5 rounded-t-xl border-l-2 ${
                            isMe
                              ? 'bg-white/10 border-white/30 text-white/70'
                              : 'bg-white/5 border-violet-500/50 text-gray-400'
                          } mb-0.5`}>
                            <span className="font-semibold">{repliedMsg.sender?.displayName}</span>
                            <p className="truncate">{repliedMsg.text}</p>
                          </div>
                        )}

                        <div
                          className={`px-4 py-2.5 rounded-2xl relative ${
                            isMe
                              ? 'bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white rounded-br-md'
                              : 'bg-white/10 rounded-bl-md'
                          }`}
                        >
                          {!isMe && chat.type === 'group' && sender && (
                            <div className="text-xs font-semibold mb-1" style={{ color: sender.avatar }}>
                              {sender.displayName}
                            </div>
                          )}
                          {msg.type === 'voice' ? (
                            <AudioPlayer src={msg.text} />
                          ) : msg.type === 'file' && msg.attachment ? (
                            <a 
                              href={msg.attachment.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className={`flex items-center gap-3 p-3 rounded-xl ${
                                isMe ? 'bg-white/20 hover:bg-white/30' : 'bg-white/10 hover:bg-white/15'
                              } transition-all`}
                            >
                              {msg.attachment.mimetype.startsWith('image/') ? (
                                <img 
                                  src={msg.attachment.url} 
                                  alt={msg.attachment.filename}
                                  className="w-32 h-32 object-cover rounded-lg"
                                />
                              ) : (
                                <div className="flex items-center gap-3">
                                  <div className={`p-3 rounded-lg ${isMe ? 'bg-white/20' : 'bg-white/10'}`}>
                                    <File className="w-8 h-8" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{msg.attachment.filename}</p>
                                    <p className="text-xs opacity-70">{Math.round(msg.attachment.size / 1024)} KB</p>
                                  </div>
                                </div>
                              )}
                            </a>
                          ) : (
                            <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
                          )}
                          <div className={`flex items-center gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                            <Lock className={`w-3 h-3 ${isMe ? 'text-white/40' : 'text-gray-600'}`} />
                            <span className={`text-[10px] ${isMe ? 'text-white/60' : 'text-gray-500'}`}>
                              {formatTime(msg.createdAt)}
                            </span>
                            {isMe && (
                              msg.readBy.length > 1
                                ? <CheckCheck className="w-3 h-3 text-sky-300" />
                                : <Check className="w-3 h-3 text-white/50" />
                            )}
                          </div>
                        </div>

                        {/* Actions on hover */}
                        <div className={`absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 ${isMe ? '-left-16' : '-right-16'}`}>
                          <button
                            onClick={() => setReplyTo(msg)}
                            className="p-1.5 rounded-lg bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-white transition-all"
                            title="Ответить"
                          >
                            <Reply className="w-3.5 h-3.5" />
                          </button>
                          {isMe && (
                            <button
                              onClick={() => deleteMessage(activeChat, msg.id)}
                              className="p-1.5 rounded-lg bg-gray-800/80 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-all"
                              title="Удалить"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Context menu */}
                        {contextMsg === msg.id && isMe && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setContextMsg(null)} />
                            <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-white/10 rounded-xl shadow-2xl py-1 z-20 min-w-[140px]">
                              <button
                                onClick={() => { setReplyTo(msg); setContextMsg(null); }}
                                className="w-full px-3 py-2 text-left text-xs hover:bg-white/5 flex items-center gap-2"
                              >
                                <Reply className="w-3.5 h-3.5" /> Ответить
                              </button>
                              <button
                                onClick={() => { deleteMessage(activeChat, msg.id); setContextMsg(null); }}
                                className="w-full px-3 py-2 text-left text-xs hover:bg-white/5 text-red-400 flex items-center gap-2"
                              >
                                <Trash2 className="w-3.5 h-3.5" /> Удалить
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {typing.length > 0 && (
          <div className="flex justify-start">
            <div className="bg-white/10 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Reply preview */}
      {replyMessage && (
        <div className="px-4 py-2 border-t border-white/10 bg-white/5 flex items-center gap-3">
          <Reply className="w-4 h-4 text-violet-400 shrink-0" />
          <div className="flex-1 min-w-0 border-l-2 border-violet-500 pl-3">
            <p className="text-xs font-semibold text-violet-400">{replyMessage.sender?.displayName}</p>
            <p className="text-xs text-gray-400 truncate">{replyMessage.text}</p>
          </div>
          <button onClick={() => setReplyTo(null)} className="p-1 hover:bg-white/10 rounded-lg">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      )}

      {/* Emoji panel */}
      {showEmoji && (
        <div className="px-4 py-3 border-t border-white/10 bg-white/5">
          <div className="flex flex-wrap gap-1">
            {EMOJIS.map(e => (
              <button
                key={e}
                onClick={() => { setText(text + e); inputRef.current?.focus(); }}
                className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/10 text-xl transition-all hover:scale-110"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-white/10 bg-white/5 backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-2">
          {isRecording ? (
            <div className="flex-1 flex items-center gap-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-2xl">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-red-400">
                Запись: {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}
              </span>
              <div className="flex-1" />
              <button
                onClick={stopRecording}
                className="p-2 bg-red-500 rounded-lg text-white hover:bg-red-600 transition-all"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            </div>
          ) : (
            <>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && activeChat) {
                    sendFile(activeChat, file, replyTo?.id);
                    e.target.value = '';
                  }
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-2.5 rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition-all"
              >
                <Paperclip className="w-5 h-5" />
              </button>
              <button
                onClick={() => setShowEmoji(!showEmoji)}
                className={`p-2.5 rounded-xl transition-all ${showEmoji ? 'bg-violet-500/20 text-violet-400' : 'hover:bg-white/10 text-gray-400 hover:text-white'}`}
              >
                <Smile className="w-5 h-5" />
              </button>
              <input
                ref={inputRef}
                type="text"
                placeholder="Написать сообщение..."
                value={text}
                onChange={e => handleTyping(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/10 transition-all"
              />
              {text.trim() ? (
                <button
                  onClick={handleSend}
                  className="p-3 bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-xl hover:shadow-lg hover:shadow-violet-500/25 hover:scale-105 active:scale-95 transition-all"
                >
                  <Send className="w-5 h-5 text-white" />
                </button>
              ) : (
                <button
                  onClick={startRecording}
                  className="p-3 bg-white/10 rounded-xl hover:bg-white/20 text-gray-400 hover:text-white transition-all active:scale-90"
                >
                  <Mic className="w-5 h-5" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Покинуть чат */}
      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setConfirmLeave(false)}>
          <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <p className="text-white font-medium mb-4">Покинуть чат «{chatName}»?</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmLeave(false)} className="px-4 py-2 rounded-xl bg-white/10 text-white">Отмена</button>
              <button
                onClick={() => {
                  if (activeChat) leaveChat(activeChat);
                  setConfirmLeave(false);
                }}
                className="px-4 py-2 rounded-xl bg-red-600 text-white"
              >
                Покинуть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DM: удалить только у себя или у обоих */}
      {showDmDeleteChoice && activeChat && chat.type === 'dm' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setShowDmDeleteChoice(false)}>
          <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <p className="text-white font-medium mb-4">Удалить переписку с {otherUser?.displayName || otherUser?.username}?</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  hideChat(activeChat);
                  setShowDmDeleteChoice(false);
                }}
                className="w-full px-4 py-3 rounded-xl bg-white/10 text-white text-left"
              >
                Только у меня — чат скроется из списка, собеседник сохранит переписку
              </button>
              <button
                onClick={() => {
                  deleteChat(activeChat);
                  setShowDmDeleteChoice(false);
                }}
                className="w-full px-4 py-3 rounded-xl bg-red-600/20 text-red-400 text-left border border-red-500/30"
              >
                У обоих — переписка удалится у всех
              </button>
            </div>
            <button onClick={() => setShowDmDeleteChoice(false)} className="w-full mt-4 py-2 rounded-xl bg-white/5 text-gray-400">Отмена</button>
          </div>
        </div>
      )}

      {/* Удалить чат (группа) */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setConfirmDelete(false)}>
          <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <p className="text-white font-medium mb-4">Удалить чат «{chatName}»? Все сообщения будут удалены.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(false)} className="px-4 py-2 rounded-xl bg-white/10 text-white">Отмена</button>
              <button
                onClick={() => {
                  if (activeChat) deleteChat(activeChat);
                  setConfirmDelete(false);
                }}
                className="px-4 py-2 rounded-xl bg-red-600 text-white"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Добавить участников */}
      {showAddMembers && activeChat && (
        <AddMembersModal
          chatId={activeChat}
          currentMemberIds={chat.members.map(m => m.id)}
          friends={friends}
          onAdd={(ids) => { addChatMembers(activeChat, ids); setShowAddMembers(false); }}
          onClose={() => setShowAddMembers(false)}
        />
      )}

      {/* Название и аватар чата */}
      {showEditChat && activeChat && (
        <EditChatModal
          name={editName}
          avatar={editAvatar}
          onNameChange={setEditName}
          onAvatarChange={setEditAvatar}
          onSave={() => {
            updateChat(activeChat, { name: editName.trim() || undefined, avatar: editAvatar ?? undefined });
            setShowEditChat(false);
          }}
          onClose={() => setShowEditChat(false)}
        />
      )}
    </div>
  );
}
