import type { User } from '../types';

interface AvatarProps {
  user: User | undefined | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showStatus?: boolean;
}

const sizes = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-20 h-20 text-2xl',
};

const statusSizes = {
  sm: 'w-2.5 h-2.5 border',
  md: 'w-3 h-3 border-2',
  lg: 'w-3.5 h-3.5 border-2',
  xl: 'w-5 h-5 border-2',
};

export function Avatar({ user, size = 'md', showStatus = false }: AvatarProps) {
  if (!user) return null;

  const initial = (user.displayName || user.username || '?')[0].toUpperCase();
  const isImage = user.avatar?.startsWith('data:image');

  return (
    <div className="relative shrink-0">
      <div
        className={`${sizes[size]} rounded-full flex items-center justify-center font-bold text-white shadow-lg overflow-hidden`}
        style={{ backgroundColor: !isImage ? (user.avatar || '#6366f1') : undefined }}
      >
        {isImage ? (
          <img src={user.avatar} alt="" className="w-full h-full object-cover" />
        ) : (
          initial
        )}
      </div>
      {showStatus && (
        <div
          className={`absolute bottom-0 right-0 ${statusSizes[size]} rounded-full border-gray-900 ${
            user.online ? 'bg-emerald-400' : 'bg-gray-500'
          }`}
        />
      )}
    </div>
  );
}
