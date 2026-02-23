import { useEffect, useState, useRef } from 'react';
import Daily from '@daily-co/daily-js';
import { useStore } from '../store';
import { Avatar } from './Avatar';
import { Phone, PhoneOff, Users } from 'lucide-react';

// Простой рингтон через Web Audio API (требует user gesture)
function useRingtone(play: boolean, userInteracted: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!play || !userInteracted) {
      intervalRef.current && clearInterval(intervalRef.current);
      intervalRef.current = null;
      const ctx = ctxRef.current;
      ctxRef.current = null;
      if (ctx && ctx.state !== 'closed') {
        ctx.close().catch(() => {});
      }
      return;
    }
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      ctxRef.current = ctx;

      const beep = () => {
        if (ctx.state === 'closed') return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 800;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      };

      beep();
      intervalRef.current = setInterval(beep, 1500);

      return () => {
        intervalRef.current && clearInterval(intervalRef.current);
        intervalRef.current = null;
        ctxRef.current = null;
        if (ctx.state !== 'closed') {
          ctx.close().catch(() => {});
        }
      };
    } catch {
      return;
    }
  }, [play, userInteracted]);
}

export function CallOverlay() {
  const { 
    currentCall, acceptCall, acceptGroupCall, declineCall, endCall, 
    friends, groupCallParticipants, currentUser, userInteracted,
  } = useStore();
  const [duration, setDuration] = useState(0);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const dailyRef = useRef<ReturnType<typeof Daily.createCallObject> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isIncomingRinging = !!(currentCall?.type === 'incoming' && currentCall?.status === 'ringing');
  useRingtone(isIncomingRinging, userInteracted);

  useEffect(() => {
    if (!userInteracted || !(typeof navigator !== 'undefined' && navigator.vibrate) || !isIncomingRinging) return;
    const id = setInterval(() => navigator.vibrate(200), 1500);
    return () => { clearInterval(id); navigator.vibrate(0); };
  }, [isIncomingRinging, userInteracted]);

  useEffect(() => {
    if (currentCall?.status === 'active' && currentCall.startTime) {
      const interval = setInterval(() => {
        setDuration(Math.floor((Date.now() - currentCall.startTime!) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setDuration(0);
    }
  }, [currentCall?.status, currentCall?.startTime]);

  // Подключение к Daily.co при активном звонке
  useEffect(() => {
    const roomUrl = currentCall?.roomUrl;
    const isActive = currentCall?.status === 'active';
    const container = containerRef.current;

    if (!isActive || !roomUrl || !container) return;

    setDailyError(null);
    const userName = currentUser?.displayName || currentUser?.username || 'Участник';

    const callObject = Daily.createCallObject();
    dailyRef.current = callObject;

    callObject.on('left-meeting', () => {
      endCall();
    });

    callObject.join({ url: roomUrl, userName, container })
      .then(() => {
        // Успешное подключение
      })
      .catch((err) => {
        console.error('Daily join failed:', err);
        setDailyError(err?.message || 'Не удалось подключиться к звонку');
      });

    return () => {
      callObject.leave().catch(() => {});
      dailyRef.current = null;
    };
  }, [currentCall?.status, currentCall?.roomUrl, currentUser?.displayName, currentUser?.username, endCall]);

  const handleEndCall = () => {
    dailyRef.current?.leave().catch(() => {});
    dailyRef.current = null;
    endCall();
  };

  if (!currentCall) return null;

  const isGroup = currentCall.isGroup || currentCall.type === 'group';
  const caller = currentCall.caller || friends.find(f => f.id === currentCall.callId);
  const participants = isGroup ? groupCallParticipants : [caller].filter(Boolean);
  const isRinging = currentCall.status === 'ringing';
  const isActive = currentCall.status === 'active';

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const handleAccept = () => {
    if (isGroup) {
      acceptGroupCall(currentCall.callId);
    } else {
      acceptCall();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-900/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-white font-medium">
            {isGroup ? 'Групповой звонок' : caller?.displayName || 'Звонок'}
          </span>
          {isActive && (
            <span className="text-gray-400 text-sm">{formatDuration(duration)}</span>
          )}
        </div>
        
        {isGroup && (
          <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 rounded-lg">
            <Users className="w-4 h-4 text-gray-400" />
            <span className="text-gray-300">{participants.length}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {isRinging ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-8 p-6">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-violet-500/20 animate-ping" style={{ animationDuration: '2s' }} />
              <Avatar user={caller} size="4xl" />
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white">{caller?.displayName || 'Неизвестный'}</h2>
              <p className="text-gray-400 mt-2">
                {currentCall.type === 'incoming' ? 'Входящий звонок...' : 'Вызов...'}
              </p>
            </div>
          </div>
        ) : (
          <>
            {dailyError && (
              <div className="px-6 py-3 bg-red-600/20 text-red-400 text-sm text-center">
                {dailyError}
              </div>
            )}
            <div ref={containerRef} className="flex-1 min-h-0 w-full" />
          </>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4 px-6 py-6 bg-gray-900/50 shrink-0">
        {isRinging && currentCall.type === 'incoming' && (
          <>
            <button
              onClick={declineCall}
              className="w-14 h-14 bg-red-600 rounded-full flex items-center justify-center hover:bg-red-700 transition-all hover:scale-105"
            >
              <PhoneOff className="w-6 h-6 text-white" />
            </button>
            <button
              onClick={handleAccept}
              className="w-14 h-14 bg-green-600 rounded-full flex items-center justify-center hover:bg-green-700 transition-all hover:scale-105 animate-bounce"
            >
              <Phone className="w-6 h-6 text-white" />
            </button>
          </>
        )}
        
        {isRinging && currentCall.type === 'outgoing' && (
          <button
            onClick={handleEndCall}
            className="w-14 h-14 bg-red-600 rounded-full flex items-center justify-center hover:bg-red-700 transition-all hover:scale-105"
          >
            <PhoneOff className="w-6 h-6 text-white" />
          </button>
        )}
        
        {isActive && (
          <button
            onClick={handleEndCall}
            className="w-14 h-14 bg-red-600 rounded-full flex items-center justify-center hover:bg-red-700 transition-all hover:scale-105"
          >
            <PhoneOff className="w-6 h-6 text-white" />
          </button>
        )}
      </div>
    </div>
  );
}
