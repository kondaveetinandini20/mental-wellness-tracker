const authScreen = document.querySelector("#auth-screen");
const appShell = document.querySelector("#app-shell");
const authForm = document.querySelector("#auth-form");
const authError = document.querySelector("#auth-error");
const pageContent = document.querySelector("#page-content");
const habitDialog = document.querySelector("#habit-dialog");
const habitForm = document.querySelector("#habit-form");
const toast = document.querySelector("#toast");

const library = [
  { name: "Meditate", icon: "🧘", color: "lavender", target: 5, unit: "min" },
  { name: "Journal", icon: "📔", color: "peach", target: 1, unit: "entry" },
  { name: "Read a little", icon: "📖", color: "sky", target: 10, unit: "min" },
  { name: "Drink water", icon: "💧", color: "sky", target: 8, unit: "glasses" },
  { name: "Go for a walk", icon: "🚶", color: "sage", target: 10, unit: "min" },
  { name: "Stretch", icon: "🌿", color: "sage", target: 5, unit: "min" },
  { name: "Practice gratitude", icon: "🌼", color: "gold", target: 3, unit: "things" },
  { name: "Take a screen break", icon: "☁️", color: "lavender", target: 1, unit: "break" }
];
const moods = [
  { value: 1, icon: "😞", label: "Low" },
  { value: 2, icon: "😕", label: "Meh" },
  { value: 3, icon: "😐", label: "Okay" },
  { value: 4, icon: "🙂", label: "Good" },
  { value: 5, icon: "😄", label: "Great" }
];
const messages = ["You’ve got this! 💚", "Proud of your progress ✨", "One small step at a time 🌱"];
const quotes = [
  "You don't have to see the whole staircase. Just take the first step.",
  "Almost everything will work again if you unplug it for a few minutes, including you.",
  "Small steps every day add up to big change.",
  "You deserve the same kindness you give to others.",
  "Rest is not a reward. It is part of the process."
];

const state = {
  user: null,
  data: null,
  view: "today",
  authMode: "login",
  analyticsDays: 30,
  calendar: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  community: null,
  reminderTimer: null
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function todayKey() {
  const timezone = state.data?.profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(date, offset) {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
}

function dateDistance(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

function friendlyDate(date, options = { weekday: "long", month: "long", day: "numeric" }) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, options).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function localClock() {
  const timezone = state.data.profile.timezone;
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
}

function activeHabits() {
  return state.data.habits.filter((habit) => habit.active);
}

function isComplete(habit, date = todayKey()) {
  return (habit.log[date] || 0) >= habit.target;
}

function globalActivityDates() {
  const dates = new Set();
  for (const habit of state.data.habits) {
    for (const [date, amount] of Object.entries(habit.log)) {
      if (amount >= habit.target) dates.add(date);
    }
  }
  return dates;
}

function streakForDates(dates) {
  const frozen = new Set(state.data.freeze.usedDates);
  const today = todayKey();
  let date = dates.has(today) || frozen.has(today) ? today : shiftDate(today, -1);
  let count = 0;
  while (dates.has(date) || frozen.has(date)) {
    count += 1;
    date = shiftDate(date, -1);
  }
  return count;
}

function globalStreak() {
  return streakForDates(globalActivityDates());
}

function habitStreak(habit) {
  const dates = new Set(Object.entries(habit.log)
    .filter(([, amount]) => amount >= habit.target)
    .map(([date]) => date));
  return streakForDates(dates);
}

function totalXp() {
  return state.data.habits.reduce((total, habit) =>
    total + Object.values(habit.log).filter((amount) => amount >= habit.target).length * 10, 0);
}

function badges() {
  const streak = globalStreak();
  const completed = globalActivityDates().size;
  const result = [];
  if (completed >= 1) result.push({ icon: "🌱", name: "First step" });
  if (streak >= 3) result.push({ icon: "✨", name: "Finding a rhythm" });
  if (streak >= 7) result.push({ icon: "🔥", name: "One whole week" });
  if (streak >= 30) result.push({ icon: "🌟", name: "A month of care" });
  if (totalXp() >= 500) result.push({ icon: "🏅", name: "Wellness explorer" });
  return result;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("visible"), 3000);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  let result = {};
  try { result = await response.json(); } catch { /* The server returned no JSON body. */ }
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}

async function persistData(message = "") {
  try {
    const result = await request("/api/data", { method: "PUT", body: JSON.stringify(state.data) });
    state.data = result.data;
    render();
    if (message) showToast(message);
    return true;
  } catch (error) {
    showToast(error.message);
    return false;
  }
}

function toggleAuth(mode) {
  state.authMode = mode;
  authError.hidden = true;
  authForm.reset();
  const registering = mode === "register";
  document.querySelector("#name-field").hidden = !registering;
  document.querySelector("#auth-title").textContent = registering ? "A fresh start" : "Welcome back";
  document.querySelector("#auth-description").textContent = registering
    ? "Create your private space and start with a few gentle habits."
    : "Pick up where you left off. Your progress is waiting.";
  document.querySelector("#auth-submit").textContent = registering ? "Create my account" : "Sign in";
  document.querySelector("[name=password]").autocomplete = registering ? "new-password" : "current-password";
  document.querySelector("[name=password]").minLength = registering ? 10 : 1;
  document.querySelector("#auth-switch-copy").textContent = registering ? "Already have an account?" : "New to mindful?";
  document.querySelector("#auth-switch").textContent = registering ? "Sign in" : "Create an account";
}

async function showApp(user, data, invites = []) {
  state.user = user;
  state.data = data;
  state.invites = invites;
  authScreen.hidden = true;
  appShell.hidden = false;
  document.body.classList.toggle("dark-mode", data.profile.theme === "dark");
  state.view = "today";
  render();
  if (state.reminderTimer) clearInterval(state.reminderTimer);
  state.reminderTimer = setInterval(checkReminders, 30000);
  checkReminders();
}

async function boot() {
  try {
    const result = await request("/api/me");
    await showApp(result.user, result.data, result.invites);
  } catch (error) {
    if (error.message !== "Please sign in.") console.error(error);
    authScreen.hidden = false;
    appShell.hidden = true;
    toggleAuth("login");
  }
}

function render() {
  if (!state.data) return;
  document.body.classList.toggle("dark-mode", state.data.profile.theme === "dark");
  document.querySelector("#topbar-date").textContent = friendlyDate(todayKey());
  const xp = totalXp();
  const level = Math.floor(xp / 100) + 1;
  document.querySelector("#topbar-level").textContent = `Level ${level}`;
  document.querySelector("#profile-button").textContent = initials(state.data.profile.name);
  document.querySelector("#sidebar-profile").innerHTML = `
    <span class="profile-avatar">${escapeHtml(initials(state.data.profile.name))}</span>
    <span><span class="profile-name">${escapeHtml(state.data.profile.name)}</span><span class="profile-caption">Your wellness space</span></span>`;
  document.querySelectorAll(".nav-link[data-nav]").forEach((button) => {
    button.classList.toggle("active", button.dataset.nav === state.view);
  });
  const pages = {
    today: renderToday,
    habits: renderHabits,
    insights: renderInsights,
    community: renderCommunity,
    settings: renderSettings
  };
  pageContent.innerHTML = pages[state.view]();
  if (state.view === "community" && !state.community) loadCommunity();
}

function initials(name) {
  return String(name || "M").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function xpMarkup() {
  const xp = totalXp();
  const level = Math.floor(xp / 100) + 1;
  const current = xp % 100;
  return `<div class="surface-card xp-card">
    <div class="xp-top"><div><h3>Your next level</h3><span class="muted" style="font-size:10px">A little progress goes a long way.</span></div><span class="xp-value">✦ ${xp} XP</span></div>
    <div class="xp-track"><div class="xp-fill" style="width:${current}%"></div></div>
    <div class="xp-foot"><span>Level ${level}</span><span>${100 - current} XP to level ${level + 1}</span></div>
    <div class="badge-row">${badges().length ? badges().map((badge) => `<span class="badge-pill">${badge.icon} ${escapeHtml(badge.name)}</span>`).join("") : `<span class="muted" style="font-size:10px">Your first badge is just around the corner.</span>`}</div>
  </div>`;
}

function moodMarkup() {
  const savedMood = state.data.moods[todayKey()];
  return `<section class="surface-card">
    <div class="section-heading"><h2>How are you feeling?</h2><span class="muted" style="font-size:10px">A check-in, just for you</span></div>
    <div class="mood-choices">${moods.map((mood) => `<button class="mood-choice${savedMood === mood.value ? " selected" : ""}" type="button" data-action="mood" data-value="${mood.value}" aria-label="${mood.label}" title="${mood.label}">${mood.icon}</button>`).join("")}</div>
    <p class="mood-note">${savedMood ? `Thanks for checking in — ${moods[savedMood - 1].label.toLowerCase()} is worth noticing.` : "No pressure to feel any particular way."}</p>
  </section>`;
}

function habitCard(habit, date = todayKey()) {
  const amount = habit.log[date] || 0;
  const complete = amount >= habit.target;
  const percentage = Math.min(100, Math.round(amount / habit.target * 100));
  const streak = habitStreak(habit);
  return `<article class="habit-card">
    <span class="habit-icon color-${escapeHtml(habit.color)}">${escapeHtml(habit.icon)}</span>
    <div class="habit-main">
      <div class="habit-title-row"><h3 class="habit-title">${escapeHtml(habit.name)}</h3>${streak > 1 ? `<span class="habit-streak">🔥 ${streak} day${streak === 1 ? "" : "s"}</span>` : ""}</div>
      <div class="habit-progress-meta"><span>${complete ? "Lovely work — you showed up." : `${amount} of ${habit.target} ${escapeHtml(habit.unit)}`}</span><span>${percentage}%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${percentage}%"></div></div>
    </div>
    <div class="habit-actions">
      ${habit.target > 1 ? `<button class="step-button" type="button" data-action="progress-step" data-id="${escapeHtml(habit.id)}" data-step="-1" aria-label="Reduce progress">−</button>` : ""}
      <button class="button button-small habit-done${complete ? " is-done" : " button-primary"}" type="button" data-action="toggle-habit" data-id="${escapeHtml(habit.id)}">${complete ? "✓ Done" : "Mark done"}</button>
      ${habit.target > 1 ? `<button class="step-button" type="button" data-action="progress-step" data-id="${escapeHtml(habit.id)}" data-step="1" aria-label="Add progress">+</button>` : ""}
    </div>
  </article>`;
}

function renderToday() {
  const today = todayKey();
  const active = activeHabits();
  const done = active.filter((habit) => isComplete(habit, today)).length;
  const streak = globalStreak();
  const xp = totalXp();
  const level = Math.floor(xp / 100) + 1;
  const quote = quotes[Math.abs(dateDistance("2024-01-01", today)) % quotes.length];
  return `<div class="page-heading"><div><p class="eyebrow">YOUR DAILY RESET</p><h1>Good ${greeting()}, ${escapeHtml(state.data.profile.name.split(" ")[0])} <span aria-hidden="true">☀</span></h1><p class="subtitle">A little care for yourself is always worth it.</p></div></div>
    <section class="hero-card">
      <div class="hero-copy"><p class="eyebrow">TODAY IS A NEW PAGE</p><h1>${active.length ? (done === active.length ? "You showed up for yourself." : "Small steps count.") : "Make a little room for you."}</h1>
      <p class="subtitle">${active.length ? `${done} of ${active.length} little ${active.length === 1 ? "promise" : "promises"} kept today. ${escapeHtml(quote)}` : "Choose one gentle habit to get started. There is no perfect way to begin."}</p></div>
      <div class="hero-streak"><span class="streak-flame">🔥</span><span class="streak-number">${streak}</span><span class="streak-label">day streak</span></div>
    </section>
    <div class="stats-row">
      <div class="stat-card"><span class="stat-icon">🌱</span><span><strong class="stat-value">${done}/${active.length}</strong><span class="stat-label">habits today</span></span></div>
      <div class="stat-card"><span class="stat-icon">✦</span><span><strong class="stat-value">${xp}</strong><span class="stat-label">kindness points</span></span></div>
      <div class="stat-card"><span class="stat-icon">🏅</span><span><strong class="stat-value">${badges().length}</strong><span class="stat-label">badges earned</span></span></div>
    </div>
    <div class="section-heading"><h2>Your little habits</h2><button class="text-button" type="button" data-nav="habits">Manage habits →</button></div>
    <div class="habit-list">${active.length ? active.map((habit) => habitCard(habit)).join("") : `<div class="empty-state"><strong>Every journey starts somewhere.</strong>Add a gentle habit that feels right for you.<br><button class="button button-primary button-small" type="button" data-action="open-habit">＋ Add a habit</button></div>`}</div>
    <div class="bottom-grid">${moodMarkup()}${xpMarkup()}</div>
    <section class="freeze-banner"><p>❄️ <strong>${state.data.freeze.balance} streak ${state.data.freeze.balance === 1 ? "freeze" : "freezes"}</strong> ready for a day that gets away from you.</p>
      <button class="button button-small button-quiet" type="button" data-action="use-freeze" ${state.data.freeze.balance < 1 || globalActivityDates().has(today) || globalStreak() < 1 ? "disabled" : ""}>Use a freeze today</button></section>`;
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en", { timeZone: state.data.profile.timezone, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

function renderHabits() {
  const active = activeHabits();
  return `<div class="page-heading"><div><p class="eyebrow">GENTLE ROUTINES</p><h1>My habits</h1><p class="subtitle">Build a rhythm that feels like you. Even a small start is a start.</p></div><button class="button button-primary" type="button" data-action="open-habit">＋ Create a habit</button></div>
    <div class="content-grid">
      <section><div class="section-heading"><h2>Habit library</h2></div>
        <div class="habit-library">${library.map((habit, index) => {
          const exists = state.data.habits.some((item) => item.active && item.name.toLowerCase() === habit.name.toLowerCase());
          return `<article class="library-card"><span class="habit-icon color-${habit.color}">${habit.icon}</span><span class="library-card-copy"><strong>${habit.name}</strong><small>${habit.target} ${habit.unit} a day</small></span><button class="button button-small ${exists ? "button-quiet" : "button-primary"}" type="button" data-action="add-library" data-index="${index}" ${exists ? "disabled" : ""}>${exists ? "Added" : "＋ Add"}</button></article>`;
        }).join("")}</div>
      </section>
      <section><div class="section-heading"><h2>Your active habits <span class="inbox-badge">${active.length}</span></h2></div>
        <div class="surface-card manage-card">${active.length ? active.map((habit) => `<div class="manage-row"><span class="habit-icon color-${escapeHtml(habit.color)}">${escapeHtml(habit.icon)}</span><span class="habit-main">${escapeHtml(habit.name)}<span class="reminder-tag">Goal: ${habit.target} ${escapeHtml(habit.unit)}${habit.reminder ? ` · Reminder ${escapeHtml(habit.reminder)}` : ""}</span></span><button class="text-button" type="button" data-action="edit-habit" data-id="${escapeHtml(habit.id)}">Edit</button><button class="text-button" type="button" data-action="archive-habit" data-id="${escapeHtml(habit.id)}">Archive</button></div>`).join("") : `<div class="empty-state">Your habit list is waiting for its first little step.</div>`}</div>
        <div class="info-note">Your daily progress earns 10 kindness points for each completed habit. Archived habits stay in your history.</div>
      </section>
    </div>`;
}

function renderCalendar() {
  const year = state.calendar.getFullYear();
  const month = state.calendar.getMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const startOffset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cellCount = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const activeDates = globalActivityDates();
  return `<section class="surface-card">
    <div class="calendar-head"><strong>${state.calendar.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong><div class="calendar-nav">
      <button class="icon-button" type="button" data-action="calendar-shift" data-step="-1" aria-label="Previous month">‹</button>
      <button class="icon-button" type="button" data-action="calendar-shift" data-step="1" aria-label="Next month">›</button></div></div>
    <div class="calendar-grid">${["M", "T", "W", "T", "F", "S", "S"].map((day) => `<span class="calendar-day-label">${day}</span>`).join("")}
      ${Array.from({ length: cellCount }, (_, index) => {
        const date = new Date(Date.UTC(year, month, index - startOffset + 1));
        const key = date.toISOString().slice(0, 10);
        const otherMonth = date.getUTCMonth() !== month;
        const classNames = ["calendar-day", otherMonth ? "other-month" : "", key === todayKey() ? "today" : "", activeDates.has(key) ? "has-activity" : ""].filter(Boolean).join(" ");
        return `<span class="${classNames}" title="${activeDates.has(key) ? "Wellness activity completed" : ""}">${date.getUTCDate()}</span>`;
      }).join("")}
    </div><div class="calendar-legend"><span class="legend-dot"></span> A day you showed up for yourself</div>
  </section>`;
}

function renderMoodChart() {
  const today = todayKey();
  return `<div class="mood-chart">${Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(today, index - 6);
    const rating = state.data.moods[date] || 0;
    const label = friendlyDate(date, { weekday: "short" });
    const height = rating ? `${rating * 20}%` : "4px";
    return `<div class="mood-bar-wrap" title="${escapeHtml(friendlyDate(date))}${rating ? ` · ${moods[rating - 1].label}` : " · No check-in"}"><div class="mood-bar" style="height:${height}">${rating ? `<span>${moods[rating - 1].icon}</span>` : ""}</div><span class="mood-day-label">${label}</span></div>`;
  }).join("")}</div>`;
}

function renderSuccessRates() {
  const today = todayKey();
  const start = shiftDate(today, -state.analyticsDays + 1);
  const habits = activeHabits();
  if (!habits.length) return `<div class="empty-state">Add a habit to start seeing your progress.</div>`;
  return `<div class="rate-list">${habits.map((habit) => {
    const firstEligible = habit.createdOn > start ? habit.createdOn : start;
    const possibleDays = Math.max(1, Math.min(state.analyticsDays, dateDistance(firstEligible, today) + 1));
    const completed = Object.entries(habit.log).filter(([date, amount]) => date >= firstEligible && date <= today && amount >= habit.target).length;
    const percentage = Math.min(100, Math.round(completed / possibleDays * 100));
    return `<div class="rate-row"><span class="rate-name">${escapeHtml(habit.icon)} ${escapeHtml(habit.name)}</span><span class="rate-track"><span style="width:${percentage}%"></span></span><span class="rate-value">${percentage}%</span></div>`;
  }).join("")}</div>`;
}

function currentWeekStart() {
  const date = todayKey();
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDate(date, -((weekday + 6) % 7));
}

function renderInsights() {
  const week = currentWeekStart();
  const review = state.data.reviews[week] || { wins: "", challenges: "" };
  return `<div class="page-heading"><div><p class="eyebrow">NOTICE HOW FAR YOU'VE COME</p><h1>Your progress</h1><p class="subtitle">Progress isn't always a straight line. Every day still counts.</p></div>
    <label class="analytics-controls"><span class="muted" style="font-size:10px">Look back</span><select id="analytics-period" class="select-control"><option value="30" ${state.analyticsDays === 30 ? "selected" : ""}>30 days</option><option value="90" ${state.analyticsDays === 90 ? "selected" : ""}>90 days</option></select></label></div>
    <div class="analytics-grid">${renderCalendar()}
      <section class="surface-card"><div class="section-heading"><h2>Your mood, lately</h2></div><p class="muted" style="font-size:10px">A gentle look at your last seven check-ins.</p>${renderMoodChart()}</section></div>
    <section class="surface-card" style="margin-bottom:16px"><div class="section-heading"><h2>Habit consistency</h2><span class="muted" style="font-size:10px">Completed days in the last ${state.analyticsDays} days</span></div>${renderSuccessRates()}</section>
    <section class="surface-card"><div class="section-heading"><div><h2>A little weekly reflection</h2><span class="review-week">Week of ${escapeHtml(friendlyDate(week, { month: "long", day: "numeric" }))}</span>${state.data.reviews[week] ? `<span class="review-saved">Saved</span>` : ""}</div></div>
      <form class="review-form" data-form="review">
        <label class="field"><span>What felt good this week?</span><textarea name="wins" maxlength="1000" placeholder="Celebrate the moments, big or small...">${escapeHtml(review.wins)}</textarea></label>
        <label class="field"><span>What felt challenging?</span><textarea name="challenges" maxlength="1000" placeholder="Acknowledge it with kindness...">${escapeHtml(review.challenges)}</textarea></label>
        <button class="button button-primary button-small" type="submit">Save reflection</button>
      </form>
    </section>`;
}

async function loadCommunity() {
  try {
    state.community = await request("/api/community");
    if (state.view === "community") render();
  } catch (error) {
    showToast(error.message);
  }
}

function renderCommunity() {
  const community = state.community || { friends: [], leaderboard: [], nudges: [] };
  const invites = state.invites || [];
  return `<div class="page-heading"><div><p class="eyebrow">A LITTLE SUPPORT GOES A LONG WAY</p><h1>Your buddies</h1><p class="subtitle">Share encouragement, not pressure. Your wellness journey is always your own.</p></div></div>
    ${invites.length ? `<section class="surface-card" style="margin-bottom:16px"><div class="section-heading"><h2>Buddy invitations <span class="inbox-badge">${invites.length}</span></h2></div>${invites.map((invite) => `<div class="buddy-row"><span class="profile-avatar">${escapeHtml(initials(invite.name))}</span><span class="buddy-copy"><strong>${escapeHtml(invite.name)}</strong><small>${escapeHtml(invite.from)} would like to connect</small></span><span class="buddy-actions"><button class="button button-primary button-small" data-action="invite-accept" data-id="${escapeHtml(invite.id)}">Accept</button><button class="button button-quiet button-small" data-action="invite-decline" data-id="${escapeHtml(invite.id)}">Not now</button></span></div>`).join("")}</section>` : ""}
    <div class="community-grid">
      <section class="surface-card"><div class="section-heading"><h2>Invite a buddy</h2></div><p class="muted" style="font-size:11px;line-height:1.6">Enter the email your friend used to sign up. They'll see your invite the next time they visit.</p><form class="invite-form" data-form="invite"><input name="email" type="email" required maxlength="254" placeholder="friend@example.com" aria-label="Buddy email address"><button class="button button-primary" type="submit">Invite</button></form>
        <div class="info-note">Invites are private and only visible inside your accounts. No email is sent.</div>
      </section>
      <section class="surface-card"><div class="section-heading"><h2>Your buddies <span class="inbox-badge">${community.friends.length}</span></h2></div>
        ${community.friends.length ? community.friends.map((friend) => `<div class="buddy-row"><span class="profile-avatar">${escapeHtml(initials(friend.name))}</span><span class="buddy-copy"><strong>${escapeHtml(friend.name)}</strong><small>${friend.optIn ? `🔥 ${friend.streak} day${friend.streak === 1 ? "" : "s"} · ${friend.xp} XP` : "Connected buddy"}</small></span><span class="buddy-actions"><button class="button button-quiet button-small" type="button" data-action="nudge" data-id="${escapeHtml(friend.id)}">Send a nudge</button></span></div>`).join("") : `<div class="empty-state">A kind buddy can make the journey feel a little lighter.</div>`}
      </section>
    </div>
    <div class="community-grid" style="margin-top:16px">
      <section class="surface-card"><div class="section-heading"><h2>Friends leaderboard</h2></div>
        <div class="toggle-row"><span class="toggle-copy"><strong>Join the leaderboard</strong><small>Share your streak and XP with opted-in buddies.</small></span><label class="switch"><input id="leaderboard-opt-in" type="checkbox" ${state.data.profile.leaderboardOptIn ? "checked" : ""}><span class="switch-track"></span></label></div>
        ${state.data.profile.leaderboardOptIn ? (community.leaderboard.length ? community.leaderboard.map((person, index) => `<div class="leaderboard-row"><span class="rank">${index + 1}</span><span class="profile-avatar">${escapeHtml(initials(person.name))}</span><span class="leaderboard-name">${escapeHtml(person.name)}${person.id === state.user.id ? " (you)" : ""}</span><span class="leaderboard-score">🔥 ${person.streak} · ✦ ${person.xp}</span></div>`).join("") : `<p class="muted" style="font-size:11px;margin-top:14px">Your leaderboard will appear when an opted-in buddy joins.</p>`) : `<p class="muted" style="font-size:10px;margin-top:12px">Opt in when you feel ready. You can turn this off any time.</p>`}
      </section>
      <section class="surface-card"><div class="section-heading"><h2>Kind words</h2></div>
        ${community.nudges.length ? community.nudges.slice(0, 5).map((nudge) => `<div class="buddy-row"><span class="habit-icon color-peach">💌</span><span class="buddy-copy"><strong>${escapeHtml(nudge.from === state.data.profile.name ? `To ${nudge.to}` : nudge.from)}</strong><small>${escapeHtml(nudge.message)}</small></span></div>`).join("") : `<div class="empty-state">When a buddy sends you a little encouragement, it'll show up here.</div>`}
      </section>
    </div>`;
}

function renderSettings() {
  const profile = state.data.profile;
  const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : [profile.timezone, "UTC", "America/New_York", "Europe/London", "Asia/Kolkata", "Australia/Sydney"];
  const timezones = [...new Set([profile.timezone, ...zones])].sort();
  return `<div class="page-heading"><div><p class="eyebrow">YOUR ACCOUNT, YOUR WAY</p><h1>Settings</h1><p class="subtitle">Make your wellness space feel comfortable and private.</p></div></div>
    <div class="settings-grid">
      <section class="surface-card settings-card"><h2>Your profile</h2><p class="subtitle">Your personal details and local day.</p>
        <form data-form="settings">
          <label class="field"><span>Name</span><input name="name" maxlength="50" required value="${escapeHtml(profile.name)}"></label>
          <label class="field"><span>Timezone</span><select name="timezone">${timezones.map((zone) => `<option value="${escapeHtml(zone)}" ${profile.timezone === zone ? "selected" : ""}>${escapeHtml(zone.replaceAll("_", " "))}</option>`).join("")}</select></label>
          <p class="field-help">Your daily checklist, reminders, and streaks follow this local timezone.</p>
          <button class="button button-primary button-small" type="submit">Save profile</button>
        </form>
      </section>
      <section class="surface-card settings-card"><h2>Reminders & quiet hours</h2><p class="subtitle">Gentle nudges, on your schedule.</p>
        <div class="toggle-row"><span class="toggle-copy"><strong>Browser notifications</strong><small>Reminders appear while this website is open.</small></span><button class="button button-quiet button-small" type="button" data-action="enable-notifications">${"Notification" in window ? "Enable" : "Not supported"}</button></div>
        <form data-form="quiet-hours"><div class="form-row">
          <label class="field"><span>Quiet hours start</span><input name="quietStart" type="time" required value="${escapeHtml(profile.quietStart)}"></label>
          <label class="field"><span>Quiet hours end</span><input name="quietEnd" type="time" required value="${escapeHtml(profile.quietEnd)}"></label></div>
          <p class="field-help">Reminders are paused during these hours, including overnight.</p><button class="button button-primary button-small" type="submit">Save quiet hours</button>
        </form>
      </section>
      <section class="surface-card settings-card"><h2>A softer screen</h2><p class="subtitle">Pick the look that feels best to you.</p>
        <div class="toggle-row"><span class="toggle-copy"><strong>Dark mode</strong><small>Use a darker palette in low light.</small></span><label class="switch"><input id="dark-mode-toggle" type="checkbox" ${profile.theme === "dark" ? "checked" : ""}><span class="switch-track"></span></label></div>
      </section>
      <section class="surface-card settings-card"><h2>Your data</h2><p class="subtitle">Your account syncs through this app's server. Keep a copy of your own progress whenever you like.</p>
        <div class="data-actions"><button class="button button-quiet button-small" type="button" data-action="export-data">↓ Download a backup</button><button class="button button-quiet button-small" type="button" data-action="import-data">↑ Restore a backup</button><input id="import-file" type="file" accept="application/json,.json" hidden></div>
        <p class="field-help" style="margin-top:12px">Your password is hashed before it is saved. For a live public launch, use HTTPS and a managed database with automated backups.</p>
      </section>
      <section class="surface-card settings-card"><h2>Your account</h2><p class="subtitle">${escapeHtml(state.user.email)}</p><button class="button button-quiet button-small" type="button" data-action="logout">Sign out</button></section>
    </div>`;
}

async function changeProgress(habitId, amount) {
  const habit = state.data.habits.find((item) => item.id === habitId);
  if (!habit) return;
  const today = todayKey();
  const next = Math.min(habit.target, Math.max(0, amount));
  if (next === 0) delete habit.log[today];
  else habit.log[today] = next;
  await persistData(next >= habit.target ? "A little progress, beautifully done. +10 XP" : "Progress saved.");
}

function createHabit(values) {
  const name = values.name.trim();
  if (!name) return showToast("Give your habit a name first.");
  state.data.habits.push({
    id: crypto.randomUUID(),
    name,
    icon: values.icon.trim() || "🌿",
    color: values.color,
    target: Math.min(10000, Math.max(1, Number(values.target) || 1)),
    unit: values.unit.trim() || "time",
    createdOn: todayKey(),
    active: true,
    reminder: values.reminder || "",
    log: {}
  });
  state.community = null;
  persistData("Your new habit is ready.");
}

function inQuietHours(clock, start, end) {
  if (start === end) return true;
  if (start < end) return clock >= start && clock < end;
  return clock >= start || clock < end;
}

function checkReminders() {
  if (!state.data || !("Notification" in window) || Notification.permission !== "granted") return;
  const clock = localClock();
  if (inQuietHours(clock, state.data.profile.quietStart, state.data.profile.quietEnd)) return;
  const date = todayKey();
  for (const habit of activeHabits()) {
    if (habit.reminder === clock && !isComplete(habit) && !state.data.freeze.usedDates.includes(date)) {
      const key = `mindful-notified-${habit.id}-${date}`;
      if (localStorage.getItem(key)) continue;
      new Notification(`A little time for ${habit.name}?`, { body: "A gentle nudge to care for yourself. No pressure.", tag: key });
      localStorage.setItem(key, "yes");
    }
  }
  if (clock >= "20:00" && globalStreak() > 0 &&
      !globalActivityDates().has(date) && !state.data.freeze.usedDates.includes(date)) {
    const key = `mindful-streak-warning-${date}`;
    if (!localStorage.getItem(key)) {
      new Notification("Your streak is still here", {
        body: "There's still time for one small wellness moment today.",
        tag: key
      });
      localStorage.setItem(key, "yes");
    }
  }
}

async function handleAppAction(button) {
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === "open-habit") {
    habitForm.reset();
    delete habitForm.dataset.editId;
    document.querySelector("#habit-dialog-title").textContent = "Add a habit";
    habitForm.querySelector('button[type="submit"]').textContent = "Save habit";
    habitForm.elements.target.disabled = false;
    document.querySelector("#habit-goal-note").hidden = true;
    habitForm.elements.icon.value = "🌿";
    habitForm.elements.target.value = "10";
    habitForm.elements.unit.value = "min";
    habitDialog.showModal();
  } else if (action === "edit-habit") {
    const habit = state.data.habits.find((item) => item.id === id);
    if (!habit) return;
    habitForm.dataset.editId = habit.id;
    document.querySelector("#habit-dialog-title").textContent = "Edit your habit";
    habitForm.querySelector('button[type="submit"]').textContent = "Save changes";
    habitForm.elements.target.disabled = Object.keys(habit.log).length > 0;
    document.querySelector("#habit-goal-note").hidden = !habitForm.elements.target.disabled;
    for (const field of ["name", "icon", "target", "unit", "color", "reminder"]) {
      habitForm.elements[field].value = habit[field];
    }
    habitDialog.showModal();
  } else if (action === "toggle-habit") {
    const habit = state.data.habits.find((item) => item.id === id);
    if (habit) await changeProgress(id, isComplete(habit) ? 0 : habit.target);
  } else if (action === "progress-step") {
    const habit = state.data.habits.find((item) => item.id === id);
    if (habit) await changeProgress(id, (habit.log[todayKey()] || 0) + Number(button.dataset.step));
  } else if (action === "add-library") {
    const habit = library[Number(button.dataset.index)];
    if (habit) createHabit({ ...habit, reminder: "" });
  } else if (action === "archive-habit") {
    const habit = state.data.habits.find((item) => item.id === id);
    if (habit && window.confirm(`Archive "${habit.name}"? Its past progress will stay in your history.`)) {
      habit.active = false;
      await persistData("Habit archived. Its history is safe.");
    }
  } else if (action === "mood") {
    state.data.moods[todayKey()] = Number(button.dataset.value);
    await persistData("Mood check-in saved.");
  } else if (action === "use-freeze") {
    const today = todayKey();
    if (state.data.freeze.balance > 0 && !globalActivityDates().has(today) && globalStreak() > 0) {
      state.data.freeze.balance -= 1;
      state.data.freeze.usedDates.push(today);
      await persistData("Streak freeze used. Be gentle with yourself today.");
    }
  } else if (action === "calendar-shift") {
    state.calendar.setMonth(state.calendar.getMonth() + Number(button.dataset.step));
    render();
  } else if (action === "enable-notifications") {
    if (!("Notification" in window)) return showToast("Browser notifications are not supported here.");
    const permission = await Notification.requestPermission();
    showToast(permission === "granted" ? "Notifications are on. They'll appear while this site is open." : "Notifications are still off. You can change this in your browser settings.");
    render();
  } else if (action === "invite-accept" || action === "invite-decline") {
    try {
      await request(`/api/invites/${encodeURIComponent(id)}/${action === "invite-accept" ? "accept" : "decline"}`, { method: "POST", body: "{}" });
      state.invites = state.invites.filter((invite) => invite.id !== id);
      state.community = null;
      await loadCommunity();
      showToast(action === "invite-accept" ? "You and your buddy are connected." : "Invitation declined.");
    } catch (error) { showToast(error.message); }
  } else if (action === "nudge") {
    const choice = Number(window.prompt(`Send a little encouragement:\n${messages.map((message, index) => `${index + 1}. ${message}`).join("\n")}\n\nEnter 1, 2, or 3:`));
    if (!Number.isInteger(choice) || choice < 1 || choice > messages.length) return;
    try {
      await request("/api/nudges", { method: "POST", body: JSON.stringify({ friendId: id, message: messages[choice - 1] }) });
      state.community = null;
      await loadCommunity();
      showToast("A little kindness is on its way.");
    } catch (error) { showToast(error.message); }
  } else if (action === "export-data") {
    const backup = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data: state.data }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(backup);
    link.download = `mindful-backup-${todayKey()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("Your backup is ready to download.");
  } else if (action === "import-data") {
    document.querySelector("#import-file").click();
  } else if (action === "logout") {
    try {
      await request("/api/auth/logout", { method: "POST", body: "{}" });
      state.user = null;
      state.data = null;
      state.community = null;
      if (state.reminderTimer) clearInterval(state.reminderTimer);
      authScreen.hidden = false;
      appShell.hidden = true;
      toggleAuth("login");
    } catch (error) { showToast(error.message); }
  }
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(authForm);
  const registering = state.authMode === "register";
  const payload = {
    email: form.get("email"),
    password: form.get("password"),
    ...(registering ? {
      name: form.get("name"),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    } : {})
  };
  const submit = document.querySelector("#auth-submit");
  submit.disabled = true;
  authError.hidden = true;
  try {
    const result = await request(`/api/auth/${registering ? "register" : "login"}`, {
      method: "POST", body: JSON.stringify(payload)
    });
    await showApp(result.user, result.data);
  } catch (error) {
    authError.textContent = error.message;
    authError.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#auth-switch").addEventListener("click", () => toggleAuth(state.authMode === "login" ? "register" : "login"));
document.querySelector("#theme-toggle").addEventListener("click", async () => {
  state.data.profile.theme = state.data.profile.theme === "dark" ? "light" : "dark";
  await persistData();
});
document.querySelector("#profile-button").addEventListener("click", () => {
  state.view = "settings";
  render();
});
document.querySelector("#mobile-menu").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("mobile-open"));

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-nav]");
  if (nav) {
    state.view = nav.dataset.nav;
    state.community = null;
    document.querySelector(".sidebar").classList.remove("mobile-open");
    render();
    return;
  }
  const button = event.target.closest("[data-action]");
  if (button) handleAppAction(button);
  if (event.target.matches("[data-close-dialog]")) habitDialog.close();
});

habitForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(habitForm));
  const editId = habitForm.dataset.editId;
  if (editId) {
    const habit = state.data.habits.find((item) => item.id === editId);
    if (!habit) return;
    const target = habitForm.elements.target.disabled
      ? habit.target
      : Math.min(10000, Math.max(1, Number(values.target) || 1));
    Object.assign(habit, {
      name: values.name.trim(),
      icon: values.icon.trim() || "🌿",
      color: values.color,
      target,
      unit: values.unit.trim() || "time",
      reminder: values.reminder || ""
    });
    persistData("Your habit has been updated.");
  } else {
    createHabit(values);
  }
  habitDialog.close();
});

pageContent.addEventListener("change", async (event) => {
  const target = event.target;
  if (target.id === "analytics-period") {
    state.analyticsDays = Number(target.value);
    render();
  } else if (target.id === "dark-mode-toggle") {
    state.data.profile.theme = target.checked ? "dark" : "light";
    await persistData();
  } else if (target.id === "leaderboard-opt-in") {
    state.data.profile.leaderboardOptIn = target.checked;
    state.community = null;
    await persistData(target.checked ? "You joined the friends leaderboard." : "You left the friends leaderboard.");
  }
});

pageContent.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  try {
    if (form.dataset.form === "settings") {
      state.data.profile.name = values.name.trim();
      state.data.profile.timezone = values.timezone;
      await persistData("Profile saved.");
    } else if (form.dataset.form === "quiet-hours") {
      state.data.profile.quietStart = values.quietStart;
      state.data.profile.quietEnd = values.quietEnd;
      await persistData("Quiet hours saved.");
    } else if (form.dataset.form === "review") {
      state.data.reviews[currentWeekStart()] = {
        wins: values.wins.trim(),
        challenges: values.challenges.trim()
      };
      await persistData("Your reflection has been saved.");
    } else if (form.dataset.form === "invite") {
      const result = await request("/api/invites", { method: "POST", body: JSON.stringify(values) });
      form.reset();
      showToast(result.message);
    }
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener("change", async (event) => {
  const target = event.target;
  if (target.id !== "import-file") return;
  if (!target.files?.[0]) return;
  try {
    const parsed = JSON.parse(await target.files[0].text());
    const imported = parsed.data || parsed;
    if (!imported.profile || !Array.isArray(imported.habits)) throw new Error("That file does not look like a mindful backup.");
    if (!window.confirm("Restore this backup? It will replace your current account data.")) return;
    state.data = imported;
    await persistData("Your backup has been restored.");
  } catch (error) {
    showToast(`Could not restore that backup: ${error.message}`);
  } finally {
    target.value = "";
  }
});

boot();
