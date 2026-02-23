import { useStore } from '../store';
import { Avatar } from './Avatar';
import { X, MessageCircle, Phone, UserMinus } from 'lucide-react';

export function FriendProfileModal() {
  const {
    profileFriend,
    setProfileFriend,
    friends,
    openChat,
    createChat,
    startCall,
    removeFriend,
  } = useStore();

  if (!profileFriend) return null;

  const isFriend = friends.some((f) => f.id === profileFriend.id);

  const handleWrite = async () => {
    const chat = await createChat('dm', [profileFriend.id]);
    if (chat) {
      openChat(chat.id);
      setProfileFriend(null);
    }
  };

  const handleCall = () => {
    startCall(profileFriend.id);
    setProfileFriend(null);
  };

  const handleRemoveFriend = () => {
    removeFriend(profileFriend.id);
    setProfileFriend(null);
  };

  const formatLastSeen = (lastSeen: string) => {
    if (!lastSeen) return '';
    const d = new Date(lastSeen);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000;
    if (diff < 60) return 'только что';
    if (diff < 3600) return `${Math.floor(diff / 60)} мин. назад`;
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setProfileFriend(null)}>
      <div
        className="bg-gray-900 border border-white/10 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative p-6 pb-4">
          <button
            onClick={() => setProfileFriend(null)}
            className="absolute top-4 right-4 p-2 rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition-all"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex flex-col items-center text-center">
            <Avatar user={profileFriend} size="xl" showStatus />
            <h2 className="mt-4 text-xl font-bold text-white">{profileFriend.displayName || profileFriend.username}</h2>
            <p className="text-sm text-gray-500">@{profileFriend.username}</p>
            <p className={`mt-1 text-sm ${profileFriend.online ? 'text-emerald-400' : 'text-gray-500'}`}>
              {profileFriend.online ? 'В сети' : `Был(а) ${formatLastSeen(profileFriend.lastSeen || '')}`}
            </p>
            {profileFriend.bio && (
              <p className="mt-3 text-sm text-gray-400 text-left w-full bg-white/5 rounded-xl p-3">{profileFriend.bio}</p>
            )}
          </div>
        </div>

        <div className="flex gap-2 p-4 pt-0">
          <button
            onClick={handleWrite}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-violet-500 hover:bg-violet-600 text-white rounded-xl font-medium transition-all"
          >
            <MessageCircle className="w-5 h-5" /> Написать
          </button>
          {isFriend && (
            <button
              onClick={handleCall}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-white/10 hover:bg-white/15 text-white rounded-xl transition-all"
              title="Позвонить"
            >
              <Phone className="w-5 h-5" />
            </button>
          )}
        </div>

        {isFriend && (
          <div className="border-t border-white/10 p-4">
            <button
              onClick={handleRemoveFriend}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-red-400 hover:bg-red-500/10 rounded-xl transition-all text-sm"
            >
              <UserMinus className="w-4 h-4" /> Удалить из друзей
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
