import { io, Socket } from 'socket.io-client';

export const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://jame-3659.onrender.com/';

let socket: Socket | null = null;
let listenersAttached = false;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SERVER_URL, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }
  return socket;
}

export function createNewSocket(): Socket {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  listenersAttached = false;
  return getSocket();
}

export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
  return s;
}

export function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.connected) {
      resolve();
    } else {
      socket.on('connect', () => resolve());
    }
  });
}

export function isListenersAttached(): boolean {
  return listenersAttached;
}

export function setListenersAttached(attached: boolean): void {
  listenersAttached = attached;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
  }
}
