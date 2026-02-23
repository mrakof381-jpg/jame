import { useEffect } from 'react';
import { useStore } from './store';
import { AuthScreen } from './components/AuthScreen';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { CallOverlay } from './components/CallOverlay';
import { FriendProfileModal } from './components/FriendProfileModal';

export function App() {
  const { isAuthenticated, theme, showMobileChat, activeChat, callError, clearCallError, setUserInteracted } = useStore();

  useEffect(() => {
    const on = () => setUserInteracted();
    const opts = { once: true, capture: true };
    document.addEventListener('click', on, opts);
    document.addEventListener('touchstart', on, opts);
    document.addEventListener('keydown', on, opts);
    return () => {
      document.removeEventListener('click', on, opts);
      document.removeEventListener('touchstart', on, opts);
      document.removeEventListener('keydown', on, opts);
    };
  }, [setUserInteracted]);

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  const themeClasses: Record<string, string> = {
    light: 'bg-gray-50 text-gray-900',
    dark: 'bg-gray-900 text-gray-100',
    midnight: 'bg-[#0a0a1a] text-gray-100',
  };

  const sidebarBg: Record<string, string> = {
    light: 'bg-white border-gray-200',
    dark: 'bg-gray-800/50 border-white/5',
    midnight: 'bg-[#12122a] border-white/5',
  };

  return (
    <div className={`h-screen flex overflow-hidden theme-${theme} ${themeClasses[theme]}`}>
      {/* Sidebar */}
      <div className={`w-full md:w-[380px] shrink-0 border-r flex flex-col ${sidebarBg[theme]} ${
        showMobileChat ? 'hidden md:flex' : 'flex'
      }`}>
        <Sidebar />
      </div>

      {/* Chat */}
      <div className={`flex-1 flex flex-col ${
        !showMobileChat && !activeChat ? 'hidden md:flex' : 'flex'
      }`}>
        <ChatView />
      </div>

      {/* Call overlay */}
      <CallOverlay />

      {/* Профиль друга */}
      <FriendProfileModal />

      {/* Toast: ошибка звонка (занято, не в сети) */}
      {callError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-3 bg-red-600/95 text-white rounded-xl shadow-lg flex items-center gap-3 max-w-[90vw]">
          <span>{callError}</span>
          <button onClick={clearCallError} className="p-1 hover:bg-white/20 rounded">✕</button>
        </div>
      )}
    </div>
  );
}
