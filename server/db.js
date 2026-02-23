import pg from 'pg';
const { Pool } = pg;

let rawUrl = process.env.DATABASE_URL;
// Убирает предупреждение libpq (Neon и др.)
if (rawUrl && !rawUrl.includes('uselibpqcompat')) {
  rawUrl += (rawUrl.includes('?') ? '&' : '?') + 'uselibpqcompat=true';
}
const DATABASE_URL = rawUrl;

let pool = null;
const db = { helpers: null };

async function initDB() {
  if (!DATABASE_URL) {
    console.log('⚠️ No DATABASE_URL, using in-memory storage');
    return null;
  }

  try {
    pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query('SELECT 1');
    console.log('✅ PostgreSQL connected');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        "passwordHash" TEXT NOT NULL,
        "displayName" TEXT NOT NULL,
        avatar TEXT,
        bio TEXT DEFAULT '',
        online INTEGER DEFAULT 0,
        "lastSeen" TEXT,
        "createdAt" TEXT NOT NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS friend_requests (
        id TEXT PRIMARY KEY,
        "fromId" TEXT NOT NULL,
        "toId" TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        "createdAt" TEXT NOT NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS friends (
        id SERIAL PRIMARY KEY,
        "userId1" TEXT NOT NULL,
        "userId2" TEXT NOT NULL,
        UNIQUE("userId1", "userId2")
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT,
        avatar TEXT,
        members TEXT NOT NULL,
        "createdAt" TEXT NOT NULL,
        "createdBy" TEXT NOT NULL
      )
    `);
    await pool.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS "hiddenBy" TEXT DEFAULT '[]'`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        "chatId" TEXT NOT NULL,
        "senderId" TEXT NOT NULL,
        text TEXT NOT NULL,
        "encryptedText" TEXT,
        type TEXT DEFAULT 'text',
        "replyTo" TEXT,
        "readBy" TEXT NOT NULL,
        "createdAt" TEXT NOT NULL,
        attachment TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY,
        "callerId" TEXT NOT NULL,
        "targetId" TEXT,
        "participantIds" TEXT,
        status TEXT DEFAULT 'ringing',
        "isGroup" INTEGER DEFAULT 0,
        "startedAt" TEXT NOT NULL
      )
    `);

    // Нормализация строк из PG: node-pg может вернуть ключи в нижнем регистре (passwordhash, displayname)
    const normUser = (row) => ({
      id: row.id,
      username: row.username,
      passwordHash: row.passwordHash ?? row.passwordhash,
      displayName: row.displayName ?? row.displayname ?? row.username,
      avatar: row.avatar ?? '',
      bio: row.bio ?? '',
      online: !!row.online,
      lastSeen: row.lastSeen ?? row.lastseen ?? null,
      createdAt: row.createdAt ?? row.createdat
    });
    const normFr = (row) => ({
      id: row.id,
      fromId: row.fromId ?? row.fromid,
      toId: row.toId ?? row.toid,
      status: row.status,
      createdAt: row.createdAt ?? row.createdat
    });
    const normFriend = (row) => ({
      userId1: row.userId1 ?? row.userid1,
      userId2: row.userId2 ?? row.userid2
    });
    const normChat = (row) => ({
      id: row.id,
      type: row.type,
      name: row.name,
      avatar: row.avatar,
      members: typeof row.members === 'string' ? JSON.parse(row.members) : row.members,
      createdAt: row.createdAt ?? row.createdat,
      createdBy: row.createdBy ?? row.createdby,
      hiddenBy: row.hiddenBy ? (typeof row.hiddenBy === 'string' ? JSON.parse(row.hiddenBy) : row.hiddenBy) : []
    });
    const normMsg = (row) => ({
      id: row.id,
      chatId: row.chatId ?? row.chatid,
      senderId: row.senderId ?? row.senderid,
      text: row.text,
      encryptedText: row.encryptedText ?? row.encryptedtext,
      type: row.type ?? 'text',
      replyTo: row.replyTo ?? row.replyto,
      readBy: typeof row.readBy === 'string' ? JSON.parse(row.readBy) : (row.readBy ?? row.readby),
      createdAt: row.createdAt ?? row.createdat,
      attachment: row.attachment ? (typeof row.attachment === 'string' ? JSON.parse(row.attachment) : row.attachment) : null
    });

    db.helpers = {
      loadAll: async () => {
        const [u, fr, f, c, m] = await Promise.all([
          pool.query('SELECT * FROM users'),
          pool.query('SELECT * FROM friend_requests'),
          pool.query('SELECT * FROM friends'),
          pool.query('SELECT * FROM chats'),
          pool.query('SELECT * FROM messages ORDER BY "chatId", "createdAt"')
        ]);
        const users = u.rows.map(normUser);
        const friendRequests = fr.rows.map(normFr);
        const friends = f.rows.map(normFriend);
        const chats = c.rows.map(normChat);
        const messages = m.rows.map(normMsg);
        return { users, friendRequests, friends, chats, messages };
      },
      users: {
        create: async (user) => {
          await pool.query(
            `INSERT INTO users (id, username, "passwordHash", "displayName", avatar, bio, online, "lastSeen", "createdAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [user.id, user.username, user.passwordHash, user.displayName, user.avatar, user.bio, user.online ? 1 : 0, user.lastSeen, user.createdAt]
          );
          return user;
        },
        getById: async (id) => {
          const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
          return res.rows[0] || null;
        },
        getByUsername: async (username) => {
          const res = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
          return res.rows[0] || null;
        },
        getAll: async () => {
          const res = await pool.query('SELECT * FROM users');
          return res.rows;
        },
        update: async (id, updates) => {
          const fields = Object.keys(updates).map((k, i) => `"${k}" = $${i + 2}`).join(', ');
          const values = Object.values(updates);
          await pool.query(`UPDATE users SET ${fields} WHERE id = $1`, [id, ...values]);
        },
        setOnline: async (id, online) => {
          await pool.query('UPDATE users SET online = $1, "lastSeen" = $2 WHERE id = $3', [online ? 1 : 0, online ? null : new Date().toISOString(), id]);
        }
      },

      friendRequests: {
        create: async (req) => {
          await pool.query(
            `INSERT INTO friend_requests (id, "fromId", "toId", status, "createdAt") VALUES ($1, $2, $3, $4, $5)`,
            [req.id, req.fromId, req.toId, req.status, req.createdAt]
          );
          return req;
        },
        getById: async (id) => {
          const res = await pool.query('SELECT * FROM friend_requests WHERE id = $1', [id]);
          return res.rows[0] || null;
        },
        getPending: async (userId) => {
          const res = await pool.query("SELECT * FROM friend_requests WHERE \"toId\" = $1 AND status = 'pending'", [userId]);
          return res.rows;
        },
        getSent: async (userId) => {
          const res = await pool.query("SELECT * FROM friend_requests WHERE \"fromId\" = $1 AND status = 'pending'", [userId]);
          return res.rows;
        },
        updateStatus: async (id, status) => {
          await pool.query('UPDATE friend_requests SET status = $1 WHERE id = $2', [status, id]);
        }
      },

      friends: {
        create: async (userId1, userId2) => {
          await pool.query('INSERT INTO friends ("userId1", "userId2") VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId1, userId2]);
        },
        getByUser: async (userId) => {
          const res = await pool.query('SELECT * FROM friends WHERE "userId1" = $1 OR "userId2" = $1', [userId]);
          return res.rows;
        },
        remove: async (userId1, userId2) => {
          await pool.query('DELETE FROM friends WHERE ("userId1" = $1 AND "userId2" = $2) OR ("userId1" = $2 AND "userId2" = $1)', [userId1, userId2]);
        }
      },

      chats: {
        create: async (chat) => {
          const hiddenBy = JSON.stringify(chat.hiddenBy || []);
          await pool.query(
            `INSERT INTO chats (id, type, name, avatar, members, "createdAt", "createdBy", "hiddenBy") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [chat.id, chat.type, chat.name, chat.avatar, JSON.stringify(chat.members), chat.createdAt, chat.createdBy, hiddenBy]
          );
          return chat;
        },
        getById: async (id) => {
          const res = await pool.query('SELECT * FROM chats WHERE id = $1', [id]);
          if (!res.rows[0]) return null;
          const row = res.rows[0];
          return { ...row, members: JSON.parse(row.members), hiddenBy: row.hiddenBy ? JSON.parse(row.hiddenBy) : [] };
        },
        getByUser: async (userId) => {
          const res = await pool.query('SELECT * FROM chats');
          return res.rows
            .map(row => ({ ...row, members: JSON.parse(row.members) }))
            .filter(chat => chat.members.includes(userId));
        },
        update: async (id, updates) => {
          const updatesNorm = { ...updates };
          if ('hiddenBy' in updatesNorm) updatesNorm.hiddenBy = JSON.stringify(updatesNorm.hiddenBy);
          if ('members' in updatesNorm && Array.isArray(updatesNorm.members)) updatesNorm.members = JSON.stringify(updatesNorm.members);
          const fields = Object.keys(updatesNorm).map((k, i) => `"${k}" = $${i + 2}`).join(', ');
          const values = Object.values(updatesNorm);
          await pool.query(`UPDATE chats SET ${fields} WHERE id = $1`, [id, ...values]);
        },
        delete: async (id) => {
          await pool.query('DELETE FROM chats WHERE id = $1', [id]);
        }
      },

      messages: {
        create: async (msg) => {
          await pool.query(
            `INSERT INTO messages (id, "chatId", "senderId", text, "encryptedText", type, "replyTo", "readBy", "createdAt", attachment)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [msg.id, msg.chatId, msg.senderId, msg.text, msg.encryptedText, msg.type, msg.replyTo, JSON.stringify(msg.readBy), msg.createdAt, msg.attachment ? JSON.stringify(msg.attachment) : null]
          );
          return msg;
        },
        getByChat: async (chatId) => {
          const res = await pool.query('SELECT * FROM messages WHERE "chatId" = $1 ORDER BY "createdAt" ASC', [chatId]);
          return res.rows.map(row => ({
            ...row,
            readBy: JSON.parse(row.readBy),
            attachment: row.attachment ? JSON.parse(row.attachment) : null
          }));
        },
        update: async (id, chatId, updates) => {
          const fields = Object.keys(updates).map((k, i) => `"${k}" = $${i + 3}`).join(', ');
          const values = Object.values(updates).map(v => typeof v === 'object' ? JSON.stringify(v) : v);
          await pool.query(`UPDATE messages SET ${fields} WHERE id = $1 AND "chatId" = $2`, [id, chatId, ...values]);
        },
        delete: async (id, chatId) => {
          await pool.query('DELETE FROM messages WHERE id = $1 AND "chatId" = $2', [id, chatId]);
        },
        deleteByChat: async (chatId) => {
          await pool.query('DELETE FROM messages WHERE "chatId" = $1', [chatId]);
        }
      },

      calls: {
        create: async (call) => {
          await pool.query(
            `INSERT INTO calls (id, "callerId", "targetId", "participantIds", status, "isGroup", "startedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [call.id, call.callerId, call.targetId, call.participantIds ? JSON.stringify(call.participantIds) : null, call.status, call.isGroup ? 1 : 0, call.startedAt]
          );
          return call;
        },
        getById: async (id) => {
          const res = await pool.query('SELECT * FROM calls WHERE id = $1', [id]);
          if (!res.rows[0]) return null;
          const row = res.rows[0];
          return {
            ...row,
            participantIds: row.participantIds ? JSON.parse(row.participantIds) : null,
            isGroup: !!row.isGroup
          };
        },
        update: async (id, updates) => {
          const fields = Object.keys(updates).map((k, i) => `"${k}" = $${i + 2}`).join(', ');
          const values = Object.values(updates).map(v => {
            if (Array.isArray(v)) return JSON.stringify(v);
            if (typeof v === 'boolean') return v ? 1 : 0;
            return v;
          });
          await pool.query(`UPDATE calls SET ${fields} WHERE id = $1`, [id, ...values]);
        },
        delete: async (id) => {
          await pool.query('DELETE FROM calls WHERE id = $1', [id]);
        }
      }
    };

    return pool;
  } catch (e) {
    console.error('PostgreSQL error:', e.message);
    return null;
  }
}

const dbReady = initDB();

export default db;
export { dbReady };
