const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, ".data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const KEY_FILE = path.join(DATA_DIR, "encryption.key");
const PORT = Number(process.env.PORT) || 3000;
const SESSION_DAYS = 30;
const MAX_BODY_BYTES = 1024 * 1024;
const COOKIE_NAME = "mw_session";
const PALETTE = new Set(["sage", "sky", "lavender", "peach", "rose", "gold"]);
const authFailures = new Map();
const dummySalt = Buffer.alloc(16, 7);

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadEncryptionKey() {
  if (process.env.NODE_ENV === "production") {
    const key = Buffer.from(process.env.DATA_ENCRYPTION_KEY || "", "base64");
    if (key.length !== 32) throw new Error("Set DATA_ENCRYPTION_KEY to a base64-encoded 32-byte key in production.");
    return key;
  }
  if (process.env.DATA_ENCRYPTION_KEY) {
    const key = Buffer.from(process.env.DATA_ENCRYPTION_KEY, "base64");
    if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    return key;
  }
  if (fs.existsSync(KEY_FILE)) return fs.readFileSync(KEY_FILE);
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key, { flag: "wx", mode: 0o600 });
  return key;
}

const encryptionKey = loadEncryptionKey();

function seal(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    __encrypted: true,
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    ciphertext: ciphertext.toString("hex")
  };
}

function unseal(value) {
  if (!value?.__encrypted) return value;
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(value.iv, "hex"));
  decipher.setAuthTag(Buffer.from(value.tag, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "hex")),
    decipher.final()
  ]).toString("utf8");
  return JSON.parse(plaintext);
}

function readStore() {
  if (!fs.existsSync(STORE_FILE)) {
    return { users: [], sessions: [], invites: [], friendships: [], nudges: [], data: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      invites: Array.isArray(parsed.invites) ? parsed.invites : [],
      friendships: Array.isArray(parsed.friendships) ? parsed.friendships : [],
      nudges: Array.isArray(parsed.nudges) ? parsed.nudges : [],
      data: parsed.data && typeof parsed.data === "object"
        ? Object.fromEntries(Object.entries(parsed.data).map(([id, value]) => [id, unseal(value)]))
        : {}
    };
  } catch (error) {
    throw new Error(`Could not read ${STORE_FILE}: ${error.message}`);
  }
}

let store = readStore();

function persist() {
  const temporary = `${STORE_FILE}.tmp`;
  const serialized = {
    ...store,
    data: Object.fromEntries(Object.entries(store.data).map(([id, value]) => [id, seal(value)]))
  };
  fs.writeFileSync(temporary, JSON.stringify(serialized), { mode: 0o600 });
  fs.renameSync(temporary, STORE_FILE);
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  res.end(JSON.stringify(value));
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return ["", ""];
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([key]) => key));
}

function setSessionCookie(res, token, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}

function authKey(req) {
  return req.socket.remoteAddress || "unknown";
}

function isAuthLimited(req) {
  const key = authKey(req);
  const recent = (authFailures.get(key) || []).filter((timestamp) => Date.now() - timestamp < 15 * 60 * 1000);
  authFailures.set(key, recent);
  return recent.length >= 10;
}

function recordAuthFailure(req) {
  const key = authKey(req);
  const recent = (authFailures.get(key) || []).filter((timestamp) => Date.now() - timestamp < 15 * 60 * 1000);
  recent.push(Date.now());
  authFailures.set(key, recent);
}

function requestUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = Date.now();
  const session = store.sessions.find((item) => item.tokenHash === tokenHash && item.expiresAt > now);
  if (!session) return null;
  return store.users.find((item) => item.id === session.userId) || null;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validTimezone(value) {
  if (typeof value !== "string" || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function normalizeData(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid account data.");
  }
  const profile = input.profile && typeof input.profile === "object" ? input.profile : {};
  const name = cleanText(profile.name, 50);
  if (!name) throw new Error("Your name is required.");
  const timezone = validTimezone(profile.timezone) ? profile.timezone : "UTC";
  const theme = profile.theme === "dark" ? "dark" : "light";
  const quietStart = validTime(profile.quietStart) ? profile.quietStart : "22:00";
  const quietEnd = validTime(profile.quietEnd) ? profile.quietEnd : "07:00";

  const sourceHabits = Array.isArray(input.habits) ? input.habits.slice(0, 100) : [];
  const habits = sourceHabits.map((habit) => {
    if (!habit || typeof habit !== "object") throw new Error("Invalid habit data.");
    const habitName = cleanText(habit.name, 50);
    if (!habitName) throw new Error("Habit names cannot be empty.");
    const target = Number.isInteger(habit.target) ? Math.min(10000, Math.max(1, habit.target)) : 1;
    const sourceLog = habit.log && typeof habit.log === "object" ? habit.log : {};
    const log = {};
    for (const [date, amount] of Object.entries(sourceLog).slice(-1000)) {
      if (validDate(date) && Number.isFinite(amount) && amount >= 0) {
        log[date] = Math.min(target, Math.floor(amount));
      }
    }
    return {
      id: cleanText(habit.id, 80),
      name: habitName,
      icon: cleanText(habit.icon, 8) || "🌿",
      color: PALETTE.has(habit.color) ? habit.color : "sage",
      target,
      unit: cleanText(habit.unit, 20) || "time",
      createdOn: validDate(habit.createdOn) ? habit.createdOn : new Date().toISOString().slice(0, 10),
      active: habit.active !== false,
      reminder: validTime(habit.reminder) ? habit.reminder : "",
      log
    };
  });

  const moods = {};
  if (input.moods && typeof input.moods === "object") {
    for (const [date, mood] of Object.entries(input.moods).slice(-1000)) {
      if (validDate(date) && Number.isInteger(mood) && mood >= 1 && mood <= 5) moods[date] = mood;
    }
  }
  const reviews = {};
  if (input.reviews && typeof input.reviews === "object") {
    for (const [week, review] of Object.entries(input.reviews).slice(-200)) {
      if (validDate(week) && review && typeof review === "object") {
        reviews[week] = {
          wins: cleanText(review.wins, 1000),
          challenges: cleanText(review.challenges, 1000)
        };
      }
    }
  }
  const freeze = input.freeze && typeof input.freeze === "object" ? input.freeze : {};
  const usedDates = Array.isArray(freeze.usedDates)
    ? [...new Set(freeze.usedDates.filter(validDate))].slice(-100)
    : [];
  return {
    profile: {
      name,
      timezone,
      theme,
      quietStart,
      quietEnd,
      leaderboardOptIn: profile.leaderboardOptIn === true
    },
    habits,
    moods,
    reviews,
    freeze: {
      balance: Number.isInteger(freeze.balance) ? Math.min(5, Math.max(0, freeze.balance)) : 2,
      usedDates
    }
  };
}

function freshData(name, timezone) {
  const today = localDate(timezone);
  const starterHabits = [
    { name: "Take a mindful moment", icon: "🧘", color: "lavender", target: 5, unit: "min" },
    { name: "Write in a journal", icon: "📔", color: "peach", target: 1, unit: "entry" },
    { name: "Take a short walk", icon: "🚶", color: "sage", target: 10, unit: "min" }
  ];
  return normalizeData({
    profile: { name, timezone, theme: "light", quietStart: "22:00", quietEnd: "07:00" },
    habits: starterHabits.map((habit) => ({
      ...habit,
      id: crypto.randomUUID(),
      createdOn: today,
      active: true,
      reminder: "",
      log: {}
    })),
    moods: {},
    reviews: {},
    freeze: { balance: 2, usedDates: [] }
  });
}

function ensureSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request is too large."), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("Invalid JSON request."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function localDate(timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(date, offset) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + offset);
  return result.toISOString().slice(0, 10);
}

function currentGlobalStreak(data) {
  const dates = new Set(data.habits.flatMap((habit) =>
    Object.entries(habit.log).filter(([, amount]) => amount >= habit.target).map(([date]) => date)
  ));
  const frozen = new Set(data.freeze.usedDates);
  const today = localDate(data.profile.timezone);
  let cursor = dates.has(today) || frozen.has(today) ? today : shiftDate(today, -1);
  let count = 0;
  while (dates.has(cursor) || frozen.has(cursor)) {
    count += 1;
    cursor = shiftDate(cursor, -1);
  }
  return count;
}

function getFriendship(userId, friendId) {
  return store.friendships.find((item) =>
    (item.userA === userId && item.userB === friendId) ||
    (item.userA === friendId && item.userB === userId)
  );
}

function incomingInvites(userId) {
  return store.invites
    .filter((invite) => invite.to === userId && invite.status === "pending")
    .map((invite) => ({
      id: invite.id,
      from: store.users.find((person) => person.id === invite.from)?.email || "A member",
      name: store.data[invite.from]?.profile.name || "A member"
    }));
}

function publicUser(user) {
  const data = store.data[user.id];
  return {
    id: user.id,
    name: data?.profile?.name || user.name,
    streak: currentGlobalStreak(data),
    xp: data.habits.reduce((total, habit) =>
      total + Object.values(habit.log).filter((amount) => amount >= habit.target).length * 10, 0)
  };
}

async function authenticate(req, res) {
  const user = requestUser(req);
  if (!user) {
    json(res, 401, { error: "Please sign in to continue." });
    return null;
  }
  return user;
}

async function api(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/me") {
    const user = requestUser(req);
    if (!user) return json(res, 401, { error: "Please sign in." });
    return json(res, 200, {
      user: { id: user.id, email: user.email },
      data: store.data[user.id],
      invites: incomingInvites(user.id)
    });
  }

  if (req.method === "POST" && !ensureSameOrigin(req)) {
    return json(res, 403, { error: "This request could not be verified. Reload the page and try again." });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    if (isAuthLimited(req)) return json(res, 429, { error: "Too many attempts. Please wait a few minutes and try again." });
    const body = await readBody(req);
    const email = cleanText(body.email, 254).toLowerCase();
    const name = cleanText(body.name, 50);
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || password.length < 10 || password.length > 200) {
      recordAuthFailure(req);
      return json(res, 400, { error: "Enter a valid email, your name, and a password of at least 10 characters." });
    }
    if (store.users.some((user) => user.email === email)) {
      recordAuthFailure(req);
      return json(res, 409, { error: "An account with that email already exists. Try signing in instead." });
    }
    const salt = crypto.randomBytes(16);
    const passwordHash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
    const user = { id: crypto.randomUUID(), email, name, salt: salt.toString("hex"), passwordHash: passwordHash.toString("hex"), createdAt: Date.now() };
    store.users.push(user);
    store.data[user.id] = freshData(name, validTimezone(body.timezone) ? body.timezone : "UTC");
    const token = crypto.randomBytes(32).toString("hex");
    store.sessions.push({
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      userId: user.id,
      expiresAt: Date.now() + SESSION_DAYS * 86400000
    });
    authFailures.delete(authKey(req));
    persist();
    setSessionCookie(res, token, SESSION_DAYS * 86400);
    return json(res, 201, {
      user: { id: user.id, email: user.email },
      data: store.data[user.id],
      invites: incomingInvites(user.id)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    if (isAuthLimited(req)) return json(res, 429, { error: "Too many attempts. Please wait a few minutes and try again." });
    const body = await readBody(req);
    const email = cleanText(body.email, 254).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const user = store.users.find((item) => item.email === email);
    if (!user || password.length > 200) {
      if (password.length <= 200) await scrypt(password, dummySalt, 64, { N: 16384, r: 8, p: 1 });
      recordAuthFailure(req);
      return json(res, 401, { error: "Email or password is incorrect." });
    }
    const candidate = await scrypt(password, Buffer.from(user.salt, "hex"), 64, { N: 16384, r: 8, p: 1 });
    if (!crypto.timingSafeEqual(candidate, Buffer.from(user.passwordHash, "hex"))) {
      recordAuthFailure(req);
      return json(res, 401, { error: "Email or password is incorrect." });
    }
    const token = crypto.randomBytes(32).toString("hex");
    store.sessions = store.sessions.filter((session) => session.expiresAt > Date.now());
    store.sessions.push({
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      userId: user.id,
      expiresAt: Date.now() + SESSION_DAYS * 86400000
    });
    authFailures.delete(authKey(req));
    persist();
    setSessionCookie(res, token, SESSION_DAYS * 86400);
    return json(res, 200, {
      user: { id: user.id, email: user.email },
      data: store.data[user.id],
      invites: incomingInvites(user.id)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (token) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      store.sessions = store.sessions.filter((session) => session.tokenHash !== tokenHash);
      persist();
    }
    setSessionCookie(res, "", 0);
    return json(res, 200, { ok: true });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  if (req.method === "PUT" && url.pathname === "/api/data") {
    const body = await readBody(req);
    try {
      store.data[user.id] = normalizeData(body);
      user.name = store.data[user.id].profile.name;
      persist();
      return json(res, 200, { data: store.data[user.id] });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/community") {
    const friendIds = store.friendships
      .filter((friendship) => friendship.userA === user.id || friendship.userB === user.id)
      .map((friendship) => friendship.userA === user.id ? friendship.userB : friendship.userA);
    const friends = friendIds.map((id) => {
      const person = store.users.find((item) => item.id === id);
      if (!person) return null;
      const optIn = store.data[id]?.profile?.leaderboardOptIn === true;
      const summary = publicUser(person);
      return {
        id: person.id,
        name: summary.name,
        optIn,
        ...(optIn ? { streak: summary.streak, xp: summary.xp } : {})
      };
    }).filter(Boolean);
    const ownData = store.data[user.id];
    const leaderboard = ownData.profile.leaderboardOptIn
      ? [publicUser(user), ...friends.filter((friend) => friend.optIn)]
        .sort((a, b) => b.streak - a.streak || b.xp - a.xp)
      : [];
    return json(res, 200, {
      friends,
      leaderboard,
      nudges: store.nudges.filter((nudge) => nudge.to === user.id || nudge.from === user.id)
        .slice(-30).reverse().map((nudge) => ({
          message: nudge.message,
          from: store.data[nudge.from]?.profile.name || "A buddy",
          to: store.data[nudge.to]?.profile.name || "A buddy",
          createdAt: nudge.createdAt
        }))
    });
  }

  if (req.method === "POST" && url.pathname === "/api/invites") {
    const body = await readBody(req);
    const email = cleanText(body.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: "Enter a valid email address." });
    const recipient = store.users.find((person) => person.email === email);
    if (recipient && recipient.id !== user.id && !getFriendship(user.id, recipient.id) &&
        !store.invites.some((invite) => invite.from === user.id && invite.to === recipient.id && invite.status === "pending")) {
      store.invites.push({ id: crypto.randomUUID(), from: user.id, to: recipient.id, status: "pending", createdAt: Date.now() });
      persist();
    }
    return json(res, 200, { message: "If that email has an account, they will see your invitation in their app." });
  }

  const inviteMatch = url.pathname.match(/^\/api\/invites\/([0-9a-f-]+)\/(accept|decline)$/);
  if (req.method === "POST" && inviteMatch) {
    const invite = store.invites.find((item) =>
      item.id === inviteMatch[1] && item.to === user.id && item.status === "pending"
    );
    if (!invite) return json(res, 404, { error: "That invitation is no longer available." });
    invite.status = inviteMatch[2] === "accept" ? "accepted" : "declined";
    if (invite.status === "accepted" && !getFriendship(invite.from, invite.to)) {
      store.friendships.push({ userA: invite.from, userB: invite.to, createdAt: Date.now() });
    }
    persist();
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/nudges") {
    const body = await readBody(req);
    const friendId = cleanText(body.friendId, 80);
    const messages = ["You’ve got this! 💚", "Proud of your progress ✨", "One small step at a time 🌱"];
    if (!getFriendship(user.id, friendId)) return json(res, 403, { error: "You can only nudge an accepted buddy." });
    if (!messages.includes(body.message)) return json(res, 400, { error: "Choose one of the encouraging messages." });
    store.nudges.push({ id: crypto.randomUUID(), from: user.id, to: friendId, message: body.message, createdAt: Date.now() });
    persist();
    return json(res, 201, { ok: true });
  }

  return json(res, 404, { error: "Not found." });
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function staticFile(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return json(res, 405, { error: "Method not allowed." }, { Allow: "GET, HEAD" });
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return json(res, 400, { error: "Invalid path." });
  }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.resolve(PUBLIC_DIR, relative);
  if (!file.startsWith(`${PUBLIC_DIR}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return json(res, 404, { error: "Page not found." });
  }
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  Promise.resolve(url.pathname.startsWith("/api/")
    ? api(req, res, url)
    : staticFile(req, res, url)
  ).catch((error) => {
    console.error(error);
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : "Something went wrong. Please try again." });
    else res.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`Mindful Streak is running at http://localhost:${PORT}`);
  console.log(`Account data is stored in ${STORE_FILE}`);
});
