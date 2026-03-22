import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';

const JWT_SECRET = process.env.JWT_SECRET || 'pulse-secret-key-2024';
const DATABASE_URL = process.env.DATABASE_URL;
const DAILY_API_KEY = process.env.DAILY_API_KEY;

async function createDailyRoom(callId, maxParticipants = 10) {
  if (!DAILY_API_KEY) return null;
  try {
    const exp = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    const res = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DAILY_API_KEY}`,
      },
      body: JSON.stringify({
        name: `pulse-${callId.replace(/-/g, '')}`,
        properties: { exp, max_participants: maxParticipants },
      }),
    });
    const data = await res.json();
    return data?.url || null;
  } catch (e) {
    console.error('Daily room creation failed:', e.message);
    return null;
  }
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Импорт БД (PostgreSQL при DATABASE_URL в Render, иначе JSON-файл)
import dbModule, { dbReady } from './db.js';

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: ['https://jame-3659.onrender.com/', 'https://jame-3659.onrender.com/'],
    methods: ['GET', 'POST']
  }
});

// Инициализация БД - теперь в db.js
import './db.js';

app.use(cors({
  origin: ['https://jame-3659.onrender.com/', 'https://jame-3659.onrender.com/'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));
app.use(express.json());

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|webm|mp3|wav|ogg|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|zip|rar|7z|exe/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mime = allowedTypes.test(file.mimetype);
    if (ext || mime) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ 
    success: true, 
    url: fileUrl,
    filename: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype
  });
});

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// ICE-серверы (звонки через Daily.co, endpoint оставлен для совместимости)
app.get('/api/ice-servers', (req, res) => {
  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });
});

// Serve static frontend files from dist
app.use(express.static(path.join(__dirname, '..', 'dist')));

// ============== IN-MEMORY DATABASE ==============
const db = {
  users: new Map(),        // userId -> User
  usersByUsername: new Map(), // username -> userId
  friendRequests: [],       // { id, fromId, toId, status, createdAt }
  friends: [],              // { userId1, userId2 }
  chats: new Map(),         // chatId -> Chat
  messages: new Map(),      // chatId -> Message[]
  calls: new Map(),         // callId -> Call
};

// Таймауты звонков: callId -> таймер (автоотбой через 60 сек)
const callTimeouts = new Map();
const CALL_RING_TIMEOUT_MS = 60 * 1000;

function isUserInCall(userId) {
  for (const call of db.calls.values()) {
    if (call.callerId === userId || call.targetId === userId) return true;
    if (call.participantIds && call.participantIds.includes(userId)) return true;
  }
  return false;
}

function clearCallTimeout(callId) {
  const t = callTimeouts.get(callId);
  if (t) {
    clearTimeout(t);
    callTimeouts.delete(callId);
  }
}

function setCallTimeout(callId) {
  clearCallTimeout(callId);
  const t = setTimeout(() => {
    callTimeouts.delete(callId);
    const call = db.calls.get(callId);
    if (!call || call.status !== 'ringing') return;
    db.calls.delete(callId);
    const callerId = call.callerId;
    emitToUser(callerId, 'callExpired', { callId });
    console.log(`📞 Call expired (no answer): ${callId}`);
  }, CALL_RING_TIMEOUT_MS);
  callTimeouts.set(callId, t);
}

// useDb = true когда задан DATABASE_URL (Render и др.) — пишем в PostgreSQL
let useDb = false;

// Путь к БД (только для режима без DATABASE_URL — локальный JSON-файл).
// На Render без PostgreSQL файловая система сбрасывается при деплое — нужен Persistent Disk:
// 1) В Render: Dashboard → сервис → Disks → Add Disk, Mount Path: /data
// 2) Env: DATA_DIR=/data (или не задавать, если диск смонтирован в /data)
const DATA_DIR = process.env.DATA_DIR || (process.env.RENDER ? '/data' : path.join(process.cwd(), 'data'));
const DB_FILE = path.join(DATA_DIR, 'database.json');

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      console.log('📂 Database file not found, starting fresh:', DB_FILE);
      return;
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    if (data.users) {
      Object.entries(data.users).forEach(([k, v]) => db.users.set(k, v));
      Object.entries(data.usersByUsername || {}).forEach(([k, v]) => db.usersByUsername.set(k, v));
    }
    if (data.friendRequests) db.friendRequests = data.friendRequests;
    if (data.friends) db.friends = data.friends;
      if (data.chats) Object.entries(data.chats).forEach(([k, v]) => {
        if (!Array.isArray(v.hiddenBy)) v.hiddenBy = [];
        db.chats.set(k, v);
      });
    if (data.messages) Object.entries(data.messages).forEach(([k, v]) => db.messages.set(k, v));
    if (data.calls) Object.entries(data.calls).forEach(([k, v]) => db.calls.set(k, v));
    console.log('✅ Database loaded:', DB_FILE);
    console.log('   Users:', db.users.size, '| Chats:', db.chats.size, '| Messages:', Array.from(db.messages.values()).reduce((s, m) => s + m.length, 0));
  } catch (e) {
    console.error('Failed to load database:', e);
  }
}

async function loadFromPg() {
  if (!dbModule.helpers) return;
  try {
    const data = await dbModule.helpers.loadAll();
    data.users.forEach((u) => {
      db.users.set(u.id, u);
      db.usersByUsername.set(u.username, u.id);
    });
    db.friendRequests = data.friendRequests || [];
    db.friends = data.friends || [];
    (data.chats || []).forEach((c) => db.chats.set(c.id, c));
    const byChat = {};
    (data.messages || []).forEach((m) => {
      if (!byChat[m.chatId]) byChat[m.chatId] = [];
      byChat[m.chatId].push(m);
    });
    Object.entries(byChat).forEach(([chatId, msgs]) => db.messages.set(chatId, msgs));
    console.log('✅ Database loaded from PostgreSQL');
    console.log('   Users:', db.users.size, '| Chats:', db.chats.size, '| Messages:', Array.from(db.messages.values()).reduce((s, m) => s + m.length, 0));
  } catch (e) {
    console.error('Failed to load from PostgreSQL:', e);
  }
}

function saveDb() {
  if (useDb) return; // при PostgreSQL пишем только в PG
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const data = {
      users: Object.fromEntries(db.users),
      usersByUsername: Object.fromEntries(db.usersByUsername),
      friendRequests: db.friendRequests,
      friends: db.friends,
      chats: Object.fromEntries(db.chats),
      messages: Object.fromEntries(db.messages),
      calls: Object.fromEntries(db.calls)
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save database:', e);
  }
}

// Auto-save every 30 seconds
setInterval(() => {
  saveDb();
  console.log('💾 Database auto-saved');
}, 30000);

// Сохранение при завершении процесса
function shutdown() {
  console.log('💾 Saving database before exit...');
  saveDb();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Track online users: socketId -> userId, userId -> socketId
const onlineSockets = new Map();
const userSockets = new Map();

// ============== HELPERS ==============
function getUser(userId) {
  const u = db.users.get(userId);
  if (!u) return null;
  return { id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar, bio: u.bio, online: userSockets.has(u.id), lastSeen: u.lastSeen };
}

function getUserFriends(userId) {
  return db.friends
    .filter(f => f.userId1 === userId || f.userId2 === userId)
    .map(f => {
      const friendId = f.userId1 === userId ? f.userId2 : f.userId1;
      return getUser(friendId);
    })
    .filter(Boolean);
}

function getUserChats(userId) {
  const allChats = Array.from(db.chats.values());
  const hiddenByUser = (c) => (c.hiddenBy || []).includes(userId);
  const userChats = allChats.filter(c => c.members.includes(userId) && !hiddenByUser(c));
  const chats = [];
  for (const chat of userChats) {
    const msgs = db.messages.get(chat.id) || [];
    const lastMsg = msgs[msgs.length - 1] || null;
    const unread = msgs.filter(m => m.senderId !== userId && !m.readBy.includes(userId)).length;

    const members = chat.members.map(id => getUser(id)).filter(Boolean);

    chats.push({
      id: chat.id,
      type: chat.type,
      name: chat.name,
      avatar: chat.avatar,
      members,
      lastMessage: lastMsg,
      unreadCount: unread,
      createdAt: chat.createdAt,
      createdBy: chat.createdBy,
    });
  }
  // Sort by last message time
  chats.sort((a, b) => {
    const aTime = a.lastMessage?.createdAt || a.createdAt;
    const bTime = b.lastMessage?.createdAt || b.createdAt;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });
  return chats;
}

function emitToUser(userId, event, data) {
  const socketId = userSockets.get(userId);
  if (socketId) {
    io.to(socketId).emit(event, data);
  }
}

// ============== SOCKET.IO ==============
io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // ---- AUTH: Register ----
  socket.on('register', async ({ username, password, displayName }, cb) => {
    if (!username || !password || !displayName) {
      return cb({ error: 'Все поля обязательны' });
    }

    const uname = username.toLowerCase().trim();
    if (uname.length < 2) return cb({ error: 'Имя пользователя минимум 2 символа' });
    if (password.length < 4) return cb({ error: 'Пароль минимум 4 символа' });

    const existing = db.usersByUsername.get(uname);
    if (existing) {
      return cb({ error: 'Пользователь уже существует' });
    }

    const userId = uuidv4();
    const hash = await bcrypt.hash(password, 10);
    const avatarColors = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6'];
    const color = avatarColors[Math.floor(Math.random() * avatarColors.length)];

    const user = {
      id: userId,
      username: uname,
      passwordHash: hash,
      displayName: displayName.trim(),
      avatar: color,
      bio: '',
      online: true,
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    db.users.set(userId, user);
    db.usersByUsername.set(uname, userId);
    saveDb();
    if (useDb && dbModule.helpers) {
      try { await dbModule.helpers.users.create(user); } catch (e) { console.error('PG create user:', e.message); }
    }

    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });

    // Bind socket
    onlineSockets.set(socket.id, userId);
    userSockets.set(userId, socket.id);

    console.log(`✅ Registered: ${uname} (${userId})`);
    cb({ user: getUser(userId), token });
  });

  // ---- AUTH: Login ----
  socket.on('login', async ({ username, password }, cb) => {
    const uname = username.toLowerCase().trim();
    const userId = db.usersByUsername.get(uname);
    if (!userId) return cb({ error: 'Пользователь не найден' });

    const user = db.users.get(userId);
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return cb({ error: 'Неверный пароль' });

    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });

    // Bind socket
    const oldSocketId = userSockets.get(userId);
    if (oldSocketId && oldSocketId !== socket.id) {
      io.to(oldSocketId).emit('forceDisconnect');
    }

    onlineSockets.set(socket.id, userId);
    userSockets.set(userId, socket.id);
    user.online = true;
    user.lastSeen = new Date().toISOString();
    saveDb();
    if (useDb && dbModule.helpers) {
      try { await dbModule.helpers.users.setOnline(userId, true); } catch (e) { console.error('PG setOnline:', e.message); }
    }

    // Notify friends
    const friends = getUserFriends(userId);
    friends.forEach(f => emitToUser(f.id, 'userOnline', { userId }));

    console.log(`✅ Login: ${uname}`);
    cb({ user: getUser(userId), token });
  });

  // ---- AUTH: Check session ----
  socket.on('checkSession', async ({ token }, cb) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.userId;
      const user = db.users.get(userId);
      if (!user) return cb({ error: 'User not found' });

      onlineSockets.set(socket.id, userId);
      userSockets.set(userId, socket.id);
      user.online = true;
      saveDb();
      if (useDb && dbModule.helpers) {
        try { await dbModule.helpers.users.setOnline(userId, true); } catch (e) { console.error('PG setOnline:', e.message); }
      }

      const friends = getUserFriends(userId);
      friends.forEach(f => emitToUser(f.id, 'userOnline', { userId }));

      cb({ user: getUser(userId) });
    } catch (e) {
      cb({ error: 'Invalid token' });
    }
  });

  // ---- Get initial data ----
  socket.on('getInitialData', (_, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const friends = getUserFriends(userId);
    const chats = getUserChats(userId);
    const pendingRequests = db.friendRequests
      .filter(r => r.toId === userId && r.status === 'pending')
      .map(r => ({ ...r, from: getUser(r.fromId) }));
    const sentRequests = db.friendRequests
      .filter(r => r.fromId === userId && r.status === 'pending')
      .map(r => ({ ...r, to: getUser(r.toId) }));

    cb({ friends, chats, pendingRequests, sentRequests });
  });

  // ---- Search users ----
  socket.on('searchUsers', ({ query }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const q = query.toLowerCase().trim();
    if (!q) return cb({ users: [] });

    const results = [];
    for (const [, user] of db.users) {
      if (user.id === userId) continue;
      if (user.username.includes(q) || user.displayName.toLowerCase().includes(q)) {
        const isFriend = db.friends.some(f =>
          (f.userId1 === userId && f.userId2 === user.id) ||
          (f.userId1 === user.id && f.userId2 === userId)
        );
        const hasPending = db.friendRequests.some(r =>
          ((r.fromId === userId && r.toId === user.id) || (r.fromId === user.id && r.toId === userId)) && r.status === 'pending'
        );
        results.push({ ...getUser(user.id), isFriend, hasPending });
      }
    }
    cb({ users: results.slice(0, 20) });
  });

  // ---- Friend request ----
  socket.on('sendFriendRequest', async ({ toUsername }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const toUname = toUsername.toLowerCase().trim();
    const toId = db.usersByUsername.get(toUname);
    if (!toId) return cb({ error: 'Пользователь не найден' });
    if (toId === userId) return cb({ error: 'Нельзя добавить себя' });

    // Check if already friends
    const alreadyFriends = db.friends.some(f =>
      (f.userId1 === userId && f.userId2 === toId) ||
      (f.userId1 === toId && f.userId2 === userId)
    );
    if (alreadyFriends) return cb({ error: 'Уже в друзьях' });

    // Check existing request
    const existing = db.friendRequests.find(r =>
      ((r.fromId === userId && r.toId === toId) || (r.fromId === toId && r.toId === userId)) && r.status === 'pending'
    );
    if (existing) return cb({ error: 'Заявка уже отправлена' });

    const request = {
      id: uuidv4(),
      fromId: userId,
      toId: toId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    db.friendRequests.push(request);
    saveDb();
    if (useDb && dbModule.helpers) {
      try { await dbModule.helpers.friendRequests.create(request); } catch (e) { console.error('PG friendRequest:', e.message); }
    }

    // Notify target
    emitToUser(toId, 'friendRequestReceived', { ...request, from: getUser(userId) });

    console.log(`👋 Friend request: ${db.users.get(userId).username} -> ${toUname}`);
    cb({ success: true, request: { ...request, to: getUser(toId) } });
  });

  // ---- Accept friend request ----
  socket.on('acceptFriendRequest', async ({ requestId }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const request = db.friendRequests.find(r => r.id === requestId && r.toId === userId && r.status === 'pending');
    if (!request) return cb({ error: 'Заявка не найдена' });

    request.status = 'accepted';
    db.friends.push({ userId1: request.fromId, userId2: request.toId });
    saveDb();
    if (useDb && dbModule.helpers) {
      try {
        await dbModule.helpers.friendRequests.updateStatus(requestId, 'accepted');
        await dbModule.helpers.friends.create(request.fromId, request.toId);
      } catch (e) { console.error('PG acceptFriend:', e.message); }
    }

    // Notify sender
    emitToUser(request.fromId, 'friendRequestAccepted', {
      requestId,
      friend: getUser(userId)
    });

    console.log(`✅ Friends: ${db.users.get(request.fromId).username} <-> ${db.users.get(userId).username}`);
    cb({ success: true, friend: getUser(request.fromId) });
  });

  // ---- Decline friend request ----
  socket.on('declineFriendRequest', async ({ requestId }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const request = db.friendRequests.find(r => r.id === requestId && r.toId === userId && r.status === 'pending');
    if (!request) return cb({ error: 'Заявка не найдена' });

    request.status = 'declined';
    saveDb();
    if (useDb && dbModule.helpers) {
      try { await dbModule.helpers.friendRequests.updateStatus(requestId, 'declined'); } catch (e) { console.error('PG decline:', e.message); }
    }
    cb({ success: true });
  });

  // ---- Remove friend ----
  socket.on('removeFriend', async ({ friendId }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const idx = db.friends.findIndex(f =>
      (f.userId1 === userId && f.userId2 === friendId) ||
      (f.userId1 === friendId && f.userId2 === userId)
    );
    if (idx === -1) return cb({ error: 'Не в друзьях' });

    db.friends.splice(idx, 1);
    saveDb();
    if (useDb && dbModule.helpers) {
      try { await dbModule.helpers.friends.remove(userId, friendId); } catch (e) { console.error('PG removeFriend:', e.message); }
    }
    emitToUser(friendId, 'friendRemoved', { userId });
    cb({ success: true });
  });

  // ---- Create chat ----
  socket.on('createChat', async ({ type, memberIds, name }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    // For DM, check if chat already exists
    if (type === 'dm' && memberIds.length === 1) {
      const otherId = memberIds[0];
      for (const [, chat] of db.chats) {
        if (chat.type === 'dm' && chat.members.includes(userId) && chat.members.includes(otherId)) {
          return cb({ chat: getUserChats(userId).find(c => c.id === chat.id) });
        }
      }
    }

    const allMembers = [userId, ...memberIds.filter(id => id !== userId)];
    const chatId = uuidv4();

    const chat = {
      id: chatId,
      type: type || 'dm',
      name: name || null,
      avatar: null,
      members: allMembers,
      hiddenBy: [],
      createdAt: new Date().toISOString(),
      createdBy: userId,
    };

    db.chats.set(chatId, chat);
    db.messages.set(chatId, []);
    saveDb();
    if (useDb && dbModule.helpers) {
      try { await dbModule.helpers.chats.create(chat); } catch (e) { console.error('PG createChat:', e.message); }
    }

    const chatData = getUserChats(userId).find(c => c.id === chatId);

    // Notify all members
    allMembers.forEach(mId => {
      if (mId !== userId) {
        const memberChatData = getUserChats(mId).find(c => c.id === chatId);
        emitToUser(mId, 'chatCreated', { chat: memberChatData });
      }
    });

    console.log(`💬 Chat created: ${chatId} (${type})`);
    cb({ chat: chatData });
  });

  // ---- Update chat (название, аватар) — только создатель ----
  socket.on('updateChat', async ({ chatId, name, avatar }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const chat = db.chats.get(chatId);
    if (!chat || !chat.members.includes(userId)) return cb({ error: 'Чат не найден' });
    if (chat.createdBy !== userId) return cb({ error: 'Только создатель может менять чат' });

    if (name !== undefined) chat.name = name.trim() || null;
    if (avatar !== undefined) chat.avatar = avatar;
    saveDb();
    if (useDb && dbModule.helpers) {
      const updates = {};
      if (name !== undefined) updates.name = chat.name;
      if (avatar !== undefined) updates.avatar = chat.avatar;
      if (Object.keys(updates).length) {
        try { await dbModule.helpers.chats.update(chatId, updates); } catch (e) { console.error('PG updateChat:', e.message); }
      }
    }

    const chatData = getUserChats(userId).find(c => c.id === chatId);
    chat.members.forEach(mId => emitToUser(mId, 'chatUpdated', { chat: getUserChats(mId).find(c => c.id === chatId) }));
    cb({ chat: chatData });
  });

  // ---- Добавить участников в групповой чат — только создатель ----
  socket.on('addChatMembers', async ({ chatId, memberIds }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const chat = db.chats.get(chatId);
    if (!chat || chat.type !== 'group') return cb({ error: 'Чат не найден или не групповой' });
    if (chat.createdBy !== userId) return cb({ error: 'Только создатель может добавлять участников' });

    const toAdd = memberIds.filter(id => !chat.members.includes(id));
    if (toAdd.length === 0) return cb({ chat: getUserChats(userId).find(c => c.id === chatId) });

    toAdd.forEach(id => chat.members.push(id));
    saveDb();
    if (useDb && dbModule.helpers) {
      try { await dbModule.helpers.chats.update(chatId, { members: chat.members }); } catch (e) { console.error('PG addChatMembers:', e.message); }
    }

    const chatData = getUserChats(userId).find(c => c.id === chatId);
    chat.members.forEach(mId => emitToUser(mId, 'chatUpdated', { chat: getUserChats(mId).find(c => c.id === chatId) }));
    toAdd.forEach(mId => emitToUser(mId, 'chatCreated', { chat: getUserChats(mId).find(c => c.id === chatId) }));
    cb({ chat: chatData });
  });

  // ---- Покинуть чат ----
  socket.on('leaveChat', async ({ chatId }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const chat = db.chats.get(chatId);
    if (!chat || !chat.members.includes(userId)) return cb({ error: 'Чат не найден' });

    chat.members = chat.members.filter(id => id !== userId);
    if (chat.members.length === 0) {
      db.chats.delete(chatId);
      db.messages.delete(chatId);
      saveDb();
      if (useDb && dbModule.helpers) {
        try {
          await dbModule.helpers.messages.deleteByChat(chatId);
          await dbModule.helpers.chats.delete(chatId);
        } catch (e) { console.error('PG leaveChat delete:', e.message); }
      }
      cb({ left: true });
      return;
    }
    if (chat.createdBy === userId) chat.createdBy = chat.members[0];
    saveDb();
    if (useDb && dbModule.helpers) {
      try { await dbModule.helpers.chats.update(chatId, { members: chat.members, createdBy: chat.createdBy }); } catch (e) { console.error('PG leaveChat:', e.message); }
    }

    chat.members.forEach(mId => emitToUser(mId, 'chatUpdated', { chat: getUserChats(mId).find(c => c.id === chatId) }));
    emitToUser(userId, 'chatLeft', { chatId });
    cb({ left: true });
  });

  // ---- Скрыть чат (только у себя) — для DM ----
  socket.on('hideChat', async ({ chatId }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const chat = db.chats.get(chatId);
    if (!chat || !chat.members.includes(userId)) return cb({ error: 'Чат не найден' });
    if (!(chat.hiddenBy || []).includes(userId)) {
      chat.hiddenBy = [...(chat.hiddenBy || []), userId];
      saveDb();
      if (useDb && dbModule.helpers) {
        try { await dbModule.helpers.chats.update(chatId, { hiddenBy: chat.hiddenBy }); } catch (e) { console.error('PG hideChat:', e.message); }
      }
    }
    emitToUser(userId, 'chatHidden', { chatId });
    cb({ success: true });
  });

  // ---- Удалить чат: для группы — только создатель; для DM — любой (у обоих) ----
  socket.on('deleteChat', async ({ chatId }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const chat = db.chats.get(chatId);
    if (!chat || !chat.members.includes(userId)) return cb({ error: 'Чат не найден' });
    if (chat.type === 'group' && chat.createdBy !== userId) return cb({ error: 'Только создатель может удалить чат' });

    const memberIds = [...chat.members];
    db.chats.delete(chatId);
    db.messages.delete(chatId);
    saveDb();
    if (useDb && dbModule.helpers) {
      try {
        await dbModule.helpers.messages.deleteByChat(chatId);
        await dbModule.helpers.chats.delete(chatId);
      } catch (e) { console.error('PG deleteChat:', e.message); }
    }

    memberIds.forEach(mId => emitToUser(mId, 'chatDeleted', { chatId }));
    cb({ success: true });
  });

  // ---- Send message ----
  socket.on('sendMessage', async ({ chatId, text, type, replyTo, encryptedText, attachment }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const chat = db.chats.get(chatId);
    if (!chat || !chat.members.includes(userId)) return cb({ error: 'Чат не найден' });

    const message = {
      id: uuidv4(),
      chatId,
      senderId: userId,
      text: text ? text.trim() : '',
      encryptedText: encryptedText || null,
      type: type || 'text',
      replyTo: replyTo || null,
      readBy: [userId],
      createdAt: new Date().toISOString(),
      attachment: attachment || null,
    };

    const msgs = db.messages.get(chatId) || [];
    msgs.push(message);
    db.messages.set(chatId, msgs);
    saveDb();
    if (useDb && dbModule.helpers) {
      try { await dbModule.helpers.messages.create(message); } catch (e) { console.error('PG createMessage:', e.message); }
    }


    const sender = getUser(userId);
    const msgWithSender = { ...message, sender };

    // Send to all members
    chat.members.forEach(mId => {
      emitToUser(mId, 'newMessage', { message: msgWithSender });
    });

    console.log(`📨 Message in ${chatId}: ${type === 'voice' ? '[Voice]' : text.substring(0, 30)}...`);
    cb({ message: msgWithSender });
  });

  // ---- Get messages ----
  socket.on('getMessages', ({ chatId }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const chat = db.chats.get(chatId);
    if (!chat || !chat.members.includes(userId)) return cb({ error: 'Чат не найден' });

    const msgs = (db.messages.get(chatId) || []).map(m => ({
      ...m,
      sender: getUser(m.senderId),
    }));

    cb({ messages: msgs });
  });

  // ---- Mark as read ----
  socket.on('markAsRead', ({ chatId }) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return;

    const msgs = db.messages.get(chatId) || [];
    let updated = false;
    msgs.forEach(m => {
      if (m.senderId !== userId && !m.readBy.includes(userId)) {
        m.readBy.push(userId);
        updated = true;
      }
    });

    if (updated) {
      const chat = db.chats.get(chatId);
      if (chat) {
        chat.members.forEach(mId => {
          if (mId !== userId) {
            emitToUser(mId, 'messagesRead', { chatId, userId });
          }
        });
      }
    }
  });

  // ---- Typing ----
  socket.on('typing', ({ chatId, isTyping }) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return;

    const chat = db.chats.get(chatId);
    if (!chat) return;

    const user = getUser(userId);
    chat.members.forEach(mId => {
      if (mId !== userId) {
        emitToUser(mId, 'userTyping', { chatId, user, isTyping });
      }
    });
  });

  // ---- Voice call ----
  socket.on('startCall', async ({ targetUserId }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const targetSocket = userSockets.get(targetUserId);
    if (!targetSocket) return cb({ error: 'Пользователь не в сети' });
    if (isUserInCall(targetUserId)) return cb({ error: 'Пользователь занят' });

    const callId = uuidv4();
    const roomUrl = await createDailyRoom(callId, 2);
    if (!roomUrl) return cb({ error: 'Не удалось создать комнату звонка. Настройте DAILY_API_KEY.' });

    const call = {
      id: callId,
      callerId: userId,
      targetId: targetUserId,
      participantIds: [userId, targetUserId],
      status: 'ringing',
      startedAt: new Date().toISOString(),
      isGroup: false,
      roomUrl,
    };

    db.calls.set(callId, call);

    const caller = getUser(userId);
    emitToUser(targetUserId, 'incomingCall', { callId, caller, roomUrl });
    setCallTimeout(callId);

    console.log(`📞 Call: ${db.users.get(userId).username} -> ${db.users.get(targetUserId).username}`);
    cb({ callId, roomUrl });
  });

  // ---- Group call ----
  socket.on('startGroupCall', async ({ participantIds }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const validParticipants = participantIds.filter(id => userSockets.has(id));
    if (validParticipants.length === 0) return cb({ error: 'Нет участников в сети' });

    const callId = uuidv4();
    const roomUrl = await createDailyRoom(callId, Math.max(10, validParticipants.length + 2));
    if (!roomUrl) return cb({ error: 'Не удалось создать комнату звонка. Настройте DAILY_API_KEY.' });

    const call = {
      id: callId,
      callerId: userId,
      participantIds: [userId, ...validParticipants],
      status: 'ringing',
      startedAt: new Date().toISOString(),
      isGroup: true,
      roomUrl,
    };

    db.calls.set(callId, call);

    const caller = getUser(userId);
    const participants = call.participantIds.map(id => getUser(id)).filter(Boolean);

    validParticipants.forEach(targetId => {
      emitToUser(targetId, 'incomingGroupCall', { callId, caller, participants, roomUrl });
    });
    setCallTimeout(callId);

    console.log(`📞 Group call: ${db.users.get(userId).username} -> ${validParticipants.length} participants`);
    cb({ callId, participants, roomUrl });
  });

  socket.on('joinGroupCall', ({ callId }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const call = db.calls.get(callId);
    if (!call) return cb({ error: 'Звонок не найден' });
    if (!call.isGroup) return cb({ error: 'Это не групповой звонок' });

    clearCallTimeout(callId);
    if (!call.participantIds.includes(userId)) {
      call.participantIds.push(userId);
    }
    call.status = 'active';

    const participants = call.participantIds.map(id => getUser(id)).filter(Boolean);

    call.participantIds.forEach(pId => {
      emitToUser(pId, 'groupCallJoined', { callId, userId, participants });
    });

    console.log(`📞 User joined group call: ${callId}`);
    cb({ success: true, participants });
  });

  socket.on('acceptCall', ({ callId }, cb) => {
    const call = db.calls.get(callId);
    if (!call) return cb?.({ error: 'Звонок не найден' });

    clearCallTimeout(callId);
    call.status = 'active';
    saveDb();
    emitToUser(call.callerId, 'callAccepted', { callId, targetId: call.targetId });
    console.log(`📞 Call accepted: ${callId}`);
    cb?.({ success: true });
  });

  socket.on('acceptGroupCall', ({ callId }, cb) => {
    const userId = onlineSockets.get(socket.id);
    const call = db.calls.get(callId);
    if (!call || !call.isGroup) return cb?.({ error: 'Звонок не найден' });

    clearCallTimeout(callId);
    if (!call.participantIds.includes(userId)) {
      call.participantIds.push(userId);
    }
    call.status = 'active';

    const participants = call.participantIds.map(id => getUser(id)).filter(Boolean);

    call.participantIds.forEach(pId => {
      emitToUser(pId, 'groupCallJoined', { callId, userId, participants });
    });

    cb?.({ success: true, participants });
  });

  socket.on('declineCall', ({ callId }) => {
    const call = db.calls.get(callId);
    if (!call) return;

    clearCallTimeout(callId);
    const userId = onlineSockets.get(socket.id);

    if (call.isGroup) {
      call.participantIds = call.participantIds.filter(id => id !== userId);
      if (call.participantIds.length <= 1) {
        db.calls.delete(callId);
      } else {
        call.participantIds.forEach(pId => {
          emitToUser(pId, 'groupCallLeft', { callId, userId });
        });
      }
    } else {
      call.status = 'declined';
      emitToUser(call.callerId, 'callDeclined', { callId });
      db.calls.delete(callId);
    }
  });

  socket.on('leaveGroupCall', ({ callId }) => {
    const userId = onlineSockets.get(socket.id);
    const call = db.calls.get(callId);
    if (!call || !call.isGroup) return;

    call.participantIds = call.participantIds.filter(id => id !== userId);

    if (call.participantIds.length <= 1) {
      db.calls.delete(callId);
      return;
    }

    const participants = call.participantIds.map(id => getUser(id)).filter(Boolean);
    call.participantIds.forEach(pId => {
      emitToUser(pId, 'groupCallLeft', { callId, userId, participants });
    });
  });

  socket.on('endCall', ({ callId }) => {
    const call = db.calls.get(callId);
    if (!call) return;

    clearCallTimeout(callId);
    const userId = onlineSockets.get(socket.id);

    if (call.isGroup) {
      call.participantIds = call.participantIds.filter(id => id !== userId);
      if (call.participantIds.length <= 1) {
        db.calls.delete(callId);
      } else {
        call.participantIds.forEach(pId => {
          emitToUser(pId, 'groupCallLeft', { callId, userId });
        });
      }
    } else {
      const otherId = call.callerId === userId ? call.targetId : call.callerId;
      emitToUser(otherId, 'callEnded', { callId });
      db.calls.delete(callId);
    }
    console.log(`📞 Call ended: ${callId}`);
  });

  socket.on('call:signal', ({ callId, signal, targetUserId }) => {
    const call = db.calls.get(callId);
    if (!call) return;

    const userId = onlineSockets.get(socket.id);

    if (call.isGroup && targetUserId) {
      emitToUser(targetUserId, 'call:signal', { callId, signal, fromUserId: userId });
    } else if (!call.isGroup) {
      const otherId = call.callerId === userId ? call.targetId : call.callerId;
      emitToUser(otherId, 'call:signal', { callId, signal, fromUserId: userId });
    }
  });

  // ---- Update profile ----
  socket.on('updateProfile', async ({ displayName, bio, avatar }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const user = db.users.get(userId);
    if (displayName) user.displayName = displayName.trim();
    if (bio !== undefined) user.bio = bio.trim();
    if (avatar) user.avatar = avatar;
    saveDb();
    if (useDb && dbModule.helpers) {
      const updates = {};
      if (displayName) updates.displayName = user.displayName;
      if (bio !== undefined) updates.bio = user.bio;
      if (avatar) updates.avatar = user.avatar;
      if (Object.keys(updates).length) {
        try { await dbModule.helpers.users.update(userId, updates); } catch (e) { console.error('PG updateProfile:', e.message); }
      }
    }

    // Notify friends
    const friends = getUserFriends(userId);
    friends.forEach(f => emitToUser(f.id, 'userUpdated', { user: getUser(userId) }));

    cb({ user: getUser(userId) });
  });

  // ---- Delete message ----
  socket.on('deleteMessage', async ({ chatId, messageId }, cb) => {
    const userId = onlineSockets.get(socket.id);
    if (!userId) return cb({ error: 'Не авторизован' });

    const msgs = db.messages.get(chatId);
    if (!msgs) return cb({ error: 'Чат не найден' });

    const idx = msgs.findIndex(m => m.id === messageId && m.senderId === userId);
    if (idx === -1) return cb({ error: 'Сообщение не найдено' });

    msgs.splice(idx, 1);
    saveDb();
    if (useDb && dbModule.helpers) {
      try { await dbModule.helpers.messages.delete(messageId, chatId); } catch (e) { console.error('PG deleteMessage:', e.message); }
    }

    const chat = db.chats.get(chatId);
    if (chat) {
      chat.members.forEach(mId => {
        emitToUser(mId, 'messageDeleted', { chatId, messageId });
      });
    }

    cb({ success: true });
  });

  // ---- Disconnect ----
  socket.on('disconnect', () => {
    const userId = onlineSockets.get(socket.id);
    if (userId) {
      const user = db.users.get(userId);
      if (user) {
        user.online = false;
        user.lastSeen = new Date().toISOString();
        saveDb();
      }

      onlineSockets.delete(socket.id);
      userSockets.delete(userId);

      if (useDb && dbModule.helpers) {
        dbModule.helpers.users.setOnline(userId, false).catch(e => console.error('PG setOnline(false):', e.message));
      }

      // Notify friends
      const friends = getUserFriends(userId);
      friends.forEach(f => emitToUser(f.id, 'userOffline', { userId, lastSeen: user?.lastSeen }));

      // End active calls
      for (const [callId, call] of db.calls) {
        if (call.callerId === userId || call.targetId === userId) {
          const otherId = call.callerId === userId ? call.targetId : call.callerId;
          emitToUser(otherId, 'callEnded', { callId });
          db.calls.delete(callId);
        }
      }

      console.log(`🔌 Disconnected: ${user?.username || userId}`);
    }
  });
});

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;

(async () => {
  await dbReady;
  useDb = !!(DATABASE_URL && dbModule.helpers);
  if (useDb) {
    await loadFromPg();
  } else {
    loadDb();
  }
  server.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║       🚀 WAVE MESSENGER SERVER 🚀       ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Server:  http://localhost:${PORT}            ║`);
    console.log('║  Status:  ✅ Online                       ║');
    console.log(`║  DB:      ${useDb ? 'PostgreSQL (DATABASE_URL)' : path.basename(DATA_DIR) + path.sep + 'database.json'}`.padEnd(43) + '║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');
  });
})();
