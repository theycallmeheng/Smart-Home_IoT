/* Tài khoản được cấp cục bộ; phiên đăng nhập lưu bằng mã băm. */
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, createHash, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { mkdirSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const derive = promisify(scrypt);
const COST = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const SESSION_MS = 8 * 60 * 60 * 1000;
const COOKIE = 'iot_session';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const publicUser = (row) => row && { id: row.id, username: row.username, name: row.name };
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const usernameOf = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const passwordValid = (value) =>
  typeof value === 'string' && value.length >= 8 && value.length <= 128;

function createAuth({
  filename = ':memory:',
  now = Date.now,
  sessionMs = SESSION_MS,
  maxAttempts = 10,
} = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  `);
  const getUser = db.prepare('SELECT * FROM users WHERE username=?');
  const getSession = db.prepare(
    'SELECT u.id,u.username,u.name,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>?',
  );
  const insertUser = db.prepare(
    'INSERT INTO users(username,name,password_hash,created_at) VALUES(?,?,?,?)',
  );
  const insertSession = db.prepare(
    'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',
  );
  const removeSession = db.prepare('DELETE FROM sessions WHERE token_hash=?');
  const removeExpired = db.prepare('DELETE FROM sessions WHERE expires_at<=?');
  const attempts = new Map();
  const dummySalt = randomBytes(16).toString('hex');
  const dummyHash = randomBytes(64);
  const enforceLimit = (ip, username) => {
    for (const [key, entry] of attempts) if (entry.until <= now()) attempts.delete(key);
    const keys = [`ip:${ip}`, `user:${username}`];
    if (keys.some((key) => (attempts.get(key)?.count ?? 0) >= maxAttempts))
      throw fail('Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 10 phút.', 429);
    if (attempts.size >= 2000) throw fail('Vui lòng thử đăng nhập lại sau.', 429);
    for (const key of keys) {
      const entry = attempts.get(key) ?? { count: 0, until: now() + 10 * 60 * 1000 };
      entry.count += 1;
      attempts.set(key, entry);
    }
    return keys;
  };
  return {
    close: () => db.close(),
    async createUser({ username, name, password }) {
      username = usernameOf(username);
      name = typeof name === 'string' ? name.trim() : '';
      if (!/^[a-z0-9_.-]{3,32}$/.test(username))
        throw fail('Tên đăng nhập gồm 3–32 chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.');
      if (!name || name.length > 60 || /[\u0000-\u001f]/.test(name))
        throw fail('Tên hiển thị phải có từ 1 đến 60 ký tự.');
      if (!passwordValid(password)) throw fail('Mật khẩu cần từ 8 đến 128 ký tự.');
      if (getUser.get(username)) throw fail('Tên đăng nhập đã tồn tại.', 409);
      const salt = randomBytes(16).toString('hex');
      const hash = (await derive(password, salt, 64, COST)).toString('hex');
      try {
        insertUser.run(username, name, `scrypt$${salt}$${hash}`, now());
      } catch (reason) {
        if (getUser.get(username)) throw fail('Tên đăng nhập đã tồn tại.', 409);
        throw reason;
      }
      return publicUser(getUser.get(username));
    },
    async login({ username, password }, ip = 'local') {
      username = usernameOf(username);
      if (
        !/^[a-z0-9_.-]{3,32}$/.test(username) ||
        typeof password !== 'string' ||
        password.length > 128
      )
        throw fail('Tên đăng nhập hoặc mật khẩu không đúng.', 401);
      const keys = enforceLimit(ip, username);
      const row = getUser.get(username);
      const [, salt, stored] = row?.password_hash.split('$') ?? [];
      const hash = await derive(password, salt ?? dummySalt, 64, COST);
      const target = stored ? Buffer.from(stored, 'hex') : dummyHash;
      if (!row || target.length !== hash.length || !timingSafeEqual(hash, target))
        throw fail('Tên đăng nhập hoặc mật khẩu không đúng.', 401);
      keys.forEach((key) => attempts.delete(key));
      removeExpired.run(now());
      const token = randomBytes(32).toString('base64url');
      insertSession.run(tokenHash(token), row.id, now() + sessionMs);
      return { user: publicUser(row), token };
    },
    session(token) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const row = getSession.get(tokenHash(token), now());
      return publicUser(row) ?? null;
    },
    revoke(token) {
      if (typeof token === 'string') removeSession.run(tokenHash(token));
    },
    cookie(token, secure = false) {
      return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(sessionMs / 1000)}${secure ? '; Secure' : ''}`;
    },
    clearCookie(secure = false) {
      return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
    },
  };
}

function requestToken(request) {
  return (
    request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1) ?? ''
  );
}
module.exports = { createAuth, requestToken };
