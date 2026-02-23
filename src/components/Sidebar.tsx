import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { Avatar } from './Avatar';
import {
  MessageCircle, Users, Settings, LogOut, Search, Plus,
  UserPlus, Bell, ChevronLeft, Wifi, WifiOff, User
} from 'lucide-react';
import type { View } from '../types';

export function Sidebar() {
  const {
    currentUser, friends, chats, pendingRequests, sentRequests,
    view, setView, openChat, logout, connected, searchResults,
    searchUsers, clearSearchResults,     sendFriendRequest,
    acceptFriendRequest, declineFriendRequest, removeFriend,
    createChat, updateProfile, theme, setTheme, setProfileFriend,
  } = useStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [friendUsername, setFriendUsername] = useState('');
  const [friendError, setFriendError] = useState('');
  const [friendSuccess, setFriendSuccess] = useState('');
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [editName, setEditName] = useState(currentUser?.displayName || '');
  const [editBio, setEditBio] = useState(currentUser?.bio || '');
  const [friendTab, setFriendTab] = useState<'all' | 'requests' | 'search'>('all');
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState(localStorage.getItem('audioInputId') || '');
  const [selectedOutput, setSelectedOutput] = useState(localStorage.getItem('audioOutputId') || '');
  const [devicesLoaded, setDevicesLoaded] = useState(false);

  const loadDevices = async () => {
    if (devicesLoaded) return;
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d.kind === 'audioinput');
      const outputs = devices.filter(d => d.kind === 'audiooutput');
      setAudioInputs(inputs);
      setAudioOutputs(outputs);
      if (!selectedInput && inputs.length) setSelectedInput(inputs[0].deviceId);
      if (!selectedOutput && outputs.length) setSelectedOutput(outputs[0].deviceId);
      setDevicesLoaded(true);
    } catch (e) {
      console.error('Failed to load devices:', e);
    }
  };

  useEffect(() => {
    if (view === 'settings') {
      loadDevices();
    }
  }, [view]);

  const handleInputChange = (deviceId: string) => {
    setSelectedInput(deviceId);
    localStorage.setItem('audioInputId', deviceId);
  };

  const handleOutputChange = (deviceId: string) => {
    setSelectedOutput(deviceId);
    localStorage.setItem('audioOutputId', deviceId);
  };

  const totalUnread = chats.reduce((sum, c) => sum + c.unreadCount, 0);

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (q.length >= 2) {
      searchUsers(q);
    } else {
      clearSearchResults();
    }
  };

  const handleAddFriend = async () => {
    setFriendError('');
    setFriendSuccess('');
    if (!friendUsername.trim()) return;
    const err = await sendFriendRequest(friendUsername.trim());
    if (err) {
      setFriendError(err);
    } else {
      setFriendSuccess('Заявка отправлена!');
      setFriendUsername('');
      setTimeout(() => setFriendSuccess(''), 3000);
    }
  };

  const handleStartDM = async (friendId: string) => {
    const chat = await createChat('dm', [friendId]);
    if (chat) openChat(chat.id);
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedMembers.length === 0) return;
    const chat = await createChat('group', selectedMembers, groupName.trim());
    if (chat) {
      openChat(chat.id);
      setShowNewGroup(false);
      setGroupName('');
      setSelectedMembers([]);
    }
  };

  const getChatName = (chat: typeof chats[0]) => {
    if (chat.type === 'group') return chat.name || 'Группа';
    const other = chat.members.find(m => m.id !== currentUser?.id);
    return other?.displayName || 'Чат';
  };

  const getChatUser = (chat: typeof chats[0]) => {
    if (chat.type === 'group') return null;
    return chat.members.find(m => m.id !== currentUser?.id);
  };

  const formatTime = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
  };

  const navItems: { icon: typeof MessageCircle; label: string; view: View; badge?: number }[] = [
    { icon: MessageCircle, label: 'Чаты', view: 'chats', badge: totalUnread },
    { icon: Users, label: 'Друзья', view: 'friends', badge: pendingRequests.length },
    { icon: Settings, label: 'Настройки', view: 'settings' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 pb-2">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Avatar user={currentUser} size="md" showStatus />
            <div>
              <h2 className="font-bold text-sm">{currentUser?.displayName}</h2>
              <div className="flex items-center gap-1.5 text-xs">
                {connected ? (
                  <><Wifi className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Онлайн</span></>
                ) : (
                  <><WifiOff className="w-3 h-3 text-red-400" /><span className="text-red-400">Оффлайн</span></>
                )}
              </div>
            </div>
          </div>
          <button onClick={logout} className="p-2 rounded-xl hover:bg-white/10 transition-colors text-gray-400 hover:text-red-400" title="Выйти">
            <LogOut className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <div className="flex gap-1 bg-white/5 rounded-2xl p-1 mb-3">
          {navItems.map(item => (
            <button
              key={item.view}
              onClick={() => setView(item.view)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium transition-all relative ${
                view === item.view
                  ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <item.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{item.label}</span>
              {item.badge ? (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
                  {item.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-2 custom-scroll">
        {/* ===== CHATS VIEW ===== */}
        {view === 'chats' && (
          <div className="space-y-1">
            <div className="px-2 mb-2 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Поиск чатов..."
                  value={searchQuery}
                  onChange={e => handleSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-violet-500/50 transition-all"
                />
              </div>
              <button
                onClick={() => setShowNewGroup(true)}
                className="p-2.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-xl hover:shadow-lg hover:shadow-violet-500/25 transition-all"
                title="Новая группа"
              >
                <Plus className="w-4 h-4 text-white" />
              </button>
            </div>

            {/* New group modal inline */}
            {showNewGroup && (
              <div className="mx-2 p-4 bg-white/5 border border-white/10 rounded-2xl mb-2 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">Новая группа</h3>
                  <button onClick={() => setShowNewGroup(false)} className="text-gray-400 hover:text-white">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Название группы"
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-violet-500/50"
                />
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {friends.map(f => (
                    <label key={f.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedMembers.includes(f.id)}
                        onChange={e => {
                          if (e.target.checked) setSelectedMembers([...selectedMembers, f.id]);
                          else setSelectedMembers(selectedMembers.filter(id => id !== f.id));
                        }}
                        className="accent-violet-500"
                      />
                      <Avatar user={f} size="sm" showStatus />
                      <span className="text-sm">{f.displayName}</span>
                    </label>
                  ))}
                  {friends.length === 0 && <p className="text-xs text-gray-500 text-center py-2">Сначала добавьте друзей</p>}
                </div>
                <button
                  onClick={handleCreateGroup}
                  disabled={!groupName.trim() || selectedMembers.length === 0}
                  className="w-full py-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-xl text-sm font-medium disabled:opacity-40"
                >
                  Создать ({selectedMembers.length})
                </button>
              </div>
            )}

            {/* Chat list */}
            {chats
              .filter(c => !searchQuery || getChatName(c).toLowerCase().includes(searchQuery.toLowerCase()))
              .map(chat => {
                const name = getChatName(chat);
                const otherUser = getChatUser(chat);
                const avatarUser = otherUser || { id: chat.id, username: name, displayName: name, avatar: '#6366f1', bio: '', online: false, lastSeen: '' };

                return (
                  <button
                    key={chat.id}
                    onClick={() => openChat(chat.id)}
                    className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-white/5 transition-all group text-left"
                  >
                    <Avatar user={avatarUser} size="md" showStatus={chat.type === 'dm'} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm truncate">{name}</span>
                        {chat.lastMessage && (
                          <span className="text-[11px] text-gray-500 shrink-0">{formatTime(chat.lastMessage.createdAt)}</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-xs text-gray-500 truncate max-w-[180px]">
                          {chat.lastMessage
                            ? `${chat.lastMessage.senderId === currentUser?.id ? 'Вы: ' : ''}${chat.lastMessage.text}`
                            : 'Нет сообщений'}
                        </span>
                        {chat.unreadCount > 0 && (
                          <span className="min-w-[20px] h-5 flex items-center justify-center bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-[10px] font-bold rounded-full px-1.5 shrink-0">
                            {chat.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}

            {chats.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Нет чатов</p>
                <p className="text-xs mt-1">Добавьте друзей, чтобы начать общение</p>
              </div>
            )}
          </div>
        )}

        {/* ===== FRIENDS VIEW ===== */}
        {view === 'friends' && (
          <div className="space-y-2 px-2">
            {/* Friend tabs */}
            <div className="flex gap-1 bg-white/5 rounded-xl p-1 mb-3">
              {(['all', 'requests', 'search'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setFriendTab(tab)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                    friendTab === tab
                      ? 'bg-violet-500/20 text-violet-400'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {tab === 'all' ? `Друзья (${friends.length})` : tab === 'requests' ? `Заявки (${pendingRequests.length})` : 'Поиск'}
                </button>
              ))}
            </div>

            {friendTab === 'all' && (
              <>
                {friends.map(f => (
                  <div key={f.id} className="flex items-center gap-3 p-3 rounded-2xl hover:bg-white/5 transition-all">
                    <button
                      onClick={() => setProfileFriend(f)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <Avatar user={f} size="md" showStatus />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{f.displayName}</div>
                        <div className="text-xs text-gray-500">@{f.username}</div>
                      </div>
                    </button>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => handleStartDM(f.id)}
                        className="p-2 rounded-xl hover:bg-violet-500/20 text-gray-400 hover:text-violet-400 transition-all"
                        title="Написать"
                      >
                        <MessageCircle className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setProfileFriend(f)}
                        className="p-2 rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition-all"
                        title="Профиль"
                      >
                        <User className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => removeFriend(f.id)}
                        className="p-2 rounded-xl hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-all"
                        title="Удалить"
                      >
                        <LogOut className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
                {friends.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Нет друзей</p>
                    <p className="text-xs">Найдите людей во вкладке "Поиск"</p>
                  </div>
                )}
              </>
            )}

            {friendTab === 'requests' && (
              <>
                {/* Add friend form */}
                <div className="space-y-2 mb-4">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Username друга..."
                      value={friendUsername}
                      onChange={e => setFriendUsername(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddFriend()}
                      className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-violet-500/50"
                    />
                    <button
                      onClick={handleAddFriend}
                      className="p-2.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-xl hover:shadow-lg transition-all"
                    >
                      <UserPlus className="w-4 h-4 text-white" />
                    </button>
                  </div>
                  {friendError && <p className="text-xs text-red-400">{friendError}</p>}
                  {friendSuccess && <p className="text-xs text-emerald-400">{friendSuccess}</p>}
                </div>

                {/* Pending requests */}
                {pendingRequests.length > 0 && (
                  <div className="space-y-1">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1 flex items-center gap-2">
                      <Bell className="w-3 h-3" /> Входящие
                    </h3>
                    {pendingRequests.map(req => (
                      <div key={req.id} className="flex items-center gap-3 p-3 rounded-2xl bg-violet-500/5 border border-violet-500/10">
                        <Avatar user={req.from} size="md" />
                        <div className="flex-1">
                          <div className="font-semibold text-sm">{req.from?.displayName}</div>
                          <div className="text-xs text-gray-500">@{req.from?.username}</div>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => acceptFriendRequest(req.id)}
                            className="px-3 py-1.5 bg-gradient-to-r from-emerald-500 to-green-500 text-white rounded-lg text-xs font-medium"
                          >
                            Принять
                          </button>
                          <button
                            onClick={() => declineFriendRequest(req.id)}
                            className="px-3 py-1.5 bg-white/5 text-gray-400 rounded-lg text-xs font-medium hover:bg-red-500/20 hover:text-red-400"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Sent requests */}
                {sentRequests.length > 0 && (
                  <div className="space-y-1 mt-4">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1">Отправленные</h3>
                    {sentRequests.map(req => (
                      <div key={req.id} className="flex items-center gap-3 p-3 rounded-2xl hover:bg-white/5">
                        <Avatar user={req.to} size="md" />
                        <div className="flex-1">
                          <div className="font-semibold text-sm">{req.to?.displayName}</div>
                          <div className="text-xs text-gray-500">Ожидание...</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {pendingRequests.length === 0 && sentRequests.length === 0 && (
                  <p className="text-center text-gray-500 text-xs py-4">Нет заявок</p>
                )}
              </>
            )}

            {friendTab === 'search' && (
              <>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    placeholder="Поиск пользователей..."
                    onChange={e => {
                      const q = e.target.value;
                      if (q.length >= 2) searchUsers(q);
                      else clearSearchResults();
                    }}
                    className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-violet-500/50"
                  />
                </div>
                {searchResults.map(u => (
                  <div key={u.id} className="flex items-center gap-3 p-3 rounded-2xl hover:bg-white/5">
                    <Avatar user={u} size="md" showStatus />
                    <div className="flex-1">
                      <div className="font-semibold text-sm">{u.displayName}</div>
                      <div className="text-xs text-gray-500">@{u.username}</div>
                    </div>
                    {u.isFriend ? (
                      <span className="text-xs text-emerald-400">Друг ✓</span>
                    ) : u.hasPending ? (
                      <span className="text-xs text-yellow-400">Заявка...</span>
                    ) : (
                      <button
                        onClick={async () => {
                          await sendFriendRequest(u.username);
                          searchUsers(u.username);
                        }}
                        className="px-3 py-1.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white rounded-lg text-xs font-medium"
                      >
                        Добавить
                      </button>
                    )}
                  </div>
                ))}
                {searchResults.length === 0 && (
                  <p className="text-center text-gray-500 text-xs py-4">Введите минимум 2 символа для поиска</p>
                )}
              </>
            )}
          </div>
        )}

        {/* ===== SETTINGS VIEW ===== */}
        {view === 'settings' && (
          <div className="space-y-4 px-2">
            <div className="text-center py-4">
              <div className="relative inline-block group">
                <Avatar user={currentUser} size="xl" />
                <label className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                  <Plus className="w-8 h-8 text-white" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          const base64String = reader.result as string;
                          updateProfile(editName, editBio, base64String);
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                </label>
              </div>
              <h3 className="font-bold text-lg mt-3">{currentUser?.displayName}</h3>
              <p className="text-sm text-gray-500">@{currentUser?.username}</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Имя</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-violet-500/50"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">О себе</label>
                <textarea
                  value={editBio}
                  onChange={e => setEditBio(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-violet-500/50 resize-none"
                />
              </div>
              <button
                onClick={() => updateProfile(editName, editBio)}
                className="w-full py-2.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-xl text-sm font-medium"
              >
                Сохранить
              </button>
            </div>

            <div className="pt-4 border-t border-white/10">
              <h4 className="text-sm font-semibold mb-3">Тема</h4>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { key: 'light' as const, label: '☀️ Светлая', bg: 'bg-white', text: 'text-gray-900' },
                  { key: 'dark' as const, label: '🌙 Тёмная', bg: 'bg-gray-800', text: 'text-white' },
                  { key: 'midnight' as const, label: '🌌 Полночь', bg: 'bg-[#0a0a1a]', text: 'text-white' },
                ]).map(t => (
                  <button
                    key={t.key}
                    onClick={() => setTheme(t.key)}
                    className={`py-3 rounded-xl text-xs font-medium border-2 transition-all ${
                      theme === t.key
                        ? 'border-violet-500 shadow-lg shadow-violet-500/20'
                        : 'border-white/10 hover:border-white/20'
                    } ${t.bg} ${t.text}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-white/10">
              <h4 className="text-sm font-semibold mb-3">Аудио устройства</h4>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Микрофон</label>
                  <select
                    value={selectedInput}
                    onChange={e => handleInputChange(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-violet-500/50"
                  >
                    {audioInputs.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Микрофон ${d.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Динамик</label>
                  <select
                    value={selectedOutput}
                    onChange={e => handleOutputChange(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-violet-500/50"
                  >
                    {audioOutputs.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Динамик ${d.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
