if (localStorage.getItem('gq-cleanup-v1') !== 'done') {
  localStorage.removeItem('gq-my-tokens');
  localStorage.removeItem('gq-ready-docs');
  localStorage.removeItem('gq-role');
  localStorage.setItem('gq-cleanup-v1', 'done');
}

const state = {
  data: null,
  role: 'citizen',
  officerName: '',
  citizenProfile: null,
  citizenAuthMode: 'login',
  officerConfigured: { admin: false, staff: false },
  path: location.hash.slice(1).split('?')[0] || '/home',
  filter: 'all',
  search: '',
  readyDocs: JSON.parse(localStorage.getItem('gq-ready-docs') || '[]'),
  docServiceId: 'income',
  helpServiceName: '',
  soundEnabled: localStorage.getItem('gq-sound') !== 'false',
  autoSim: localStorage.getItem('gq-auto-sim') === 'true',
  sidebarCollapsed: false,
  userLocation: null
};

const $ = (s, root = document) => root.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function officeDistanceKm(office) {
  if (!state.userLocation || !Number.isFinite(Number(office.latitude)) || !Number.isFinite(Number(office.longitude))) return null;
  const radians = degrees => degrees * Math.PI / 180;
  const lat1 = radians(state.userLocation.latitude);
  const lat2 = radians(Number(office.latitude));
  const dLat = lat2 - lat1;
  const dLon = radians(Number(office.longitude) - state.userLocation.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function officeQueueCount(officeId) {
  return state.data.tokens.filter(token => token.officeId === officeId && (token.date === 'Today' || token.date === todayISO()) && token.status === 'waiting').length;
}

function renderOfficeRecommendations() {
  const box = $('#office-recommendations');
  if (!box || !state.data) return;
  const query = ($('#service-name')?.value || '').trim().toLocaleLowerCase();
  if (query.length < 2) {
    box.innerHTML = '<div class="empty office-recommendation-empty">Choose a service to see matching offices.</div>';
    return;
  }

  const normalizedQuery = query.replace(/[^a-z0-9]/g, '').replace(/aadhaar/g, 'aadhar');
  const provides = office => [...(office.services || []), ...(office.servicesAvailable || [])].some(service => {
    const normalizedService = String(service).toLocaleLowerCase().replace(/[^a-z0-9]/g, '').replace(/aadhaar/g, 'aadhar');
    return normalizedService.includes(normalizedQuery) || normalizedQuery.includes(normalizedService);
  });
  const matched = state.data.offices.filter(provides);
  const hasVerifiedMatches = matched.length > 0;
  const offices = (hasVerifiedMatches ? matched : state.data.offices).slice().sort((a, b) => {
    const distanceA = officeDistanceKm(a);
    const distanceB = officeDistanceKm(b);
    if (distanceA !== null && distanceB !== null && distanceA !== distanceB) return distanceA - distanceB;
    return officeQueueCount(a.id) - officeQueueCount(b.id) || String(a.name).localeCompare(String(b.name));
  });

  box.innerHTML = `
    <div class="office-recommendation-note ${hasVerifiedMatches ? 'verified' : ''}">
      ${hasVerifiedMatches
        ? `Offices listing “${esc(query)}” are shown first.`
        : `No office has published a match for “${esc(query)}”. Nearby directory locations are shown; confirm service availability before visiting.`}
    </div>
    ${offices.map(office => {
      const distance = officeDistanceKm(office);
      const queueCount = officeQueueCount(office.id);
      const label = distance === null ? 'Distance unavailable' : `About ${distance} km away`;
      const selected = $('#office-select')?.value === office.id;
      return `
        <button type="button" class="office-recommendation ${selected ? 'selected' : ''}" data-action="recommend-office" data-office-id="${esc(office.id)}" aria-pressed="${selected}">
          <span><b>${esc(office.short || office.name)}</b><small>${label} · ${queueCount} ${queueCount === 1 ? 'person' : 'people'} waiting in Tap Token</small></span>
          <span aria-hidden="true">${selected ? '✓' : '→'}</span>
        </button>
      `;
    }).join('')}
    <small class="office-distance-note">Distance is an approximate straight-line estimate${state.userLocation ? ' from your current location' : ''}. Queue counts show people waiting today in Tap Token only.</small>
  `;
}
const icon = name => ({
  home: '⌂', office: '⌖', service: '▤', book: '＋', track: '◷', tokens: '▣', docs: '▧',
  bell: '♧', dashboard: '▦', queue: '☷', calendar: '▦', people: '♙', staff: '♧',
  analytics: '▥', audit: '≡', profile: '○', settings: '⚙', menu: '☰', display: '🖵'
}[name] || '•');

// Web Audio API Chime Synthesizer (Zero external audio files needed)
function playChime() {
  if (!state.soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.setValueAtTime(880.00, now + 0.16); // A5

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.85);
  } catch (e) {
    // AudioContext might be blocked until user interacts with the page
  }
}

// Web Speech API Voice Announcement
function speak(text) {
  if (!state.soundEnabled || !window.speechSynthesis) return;
  playChime();
  setTimeout(() => {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      u.pitch = 1.0;
      u.lang = 'en-IN';
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }, 280);
}

// Announcements detector when real-time updates arrive
let knownTokens = new Map();
function checkForAnnouncements(tokens) {
  if (!tokens || !tokens.length) return;
  const myTokens = JSON.parse(localStorage.getItem('gq-my-tokens') || '[]');

  if (knownTokens.size === 0) {
    tokens.forEach(t => knownTokens.set(t.id, t.status));
    return;
  }

  for (const t of tokens) {
    const prevStatus = knownTokens.get(t.id);
    if (prevStatus && prevStatus !== 'called' && t.status === 'called') {
      const isMine = myTokens.includes(t.id);
      if (isMine) {
        toast(`🔔 Your token ${t.number} is CALLED to ${t.counter}!`, true);
        speak(`Token ${t.number}, please proceed to ${t.counter}`);
      } else if (state.path === '/display' || state.role === 'staff') {
        speak(`Token ${t.number}, please proceed to ${t.counter}`);
      }
    }
    knownTokens.set(t.id, t.status);
  }
}

// Multi-Tab Zero-Latency Real-Time Sync via BroadcastChannel
let liveBc;
try {
  liveBc = new BroadcastChannel('govqueue-live-sync');
  liveBc.onmessage = e => {
    if (e.data && e.data.db) {
      state.data = e.data.db;
      checkForAnnouncements(state.data.tokens);
      render(false);
      flashLiveIndicator('Updated via live sync');
    }
  };
} catch (e) {}

function syncAcrossTabs(db, action, token) {
  if (liveBc) {
    try {
      liveBc.postMessage({ db, action, token });
    } catch (e) {}
  }
}

function updateLiveIndicator(connected) {
  const pill = $('.live-pill');
  if (pill) {
    pill.innerHTML = connected 
      ? `<i class="live-dot pulse"></i> Live stream active` 
      : `<i class="live-dot" style="background:#e05244;box-shadow:none"></i> Reconnecting...`;
  }
}

function flashLiveIndicator(msg = 'Live queue updated') {
  const pill = $('.live-pill');
  if (pill) {
    pill.classList.add('flash');
    pill.innerHTML = `<i class="live-dot pulse"></i> ${msg}`;
    setTimeout(() => {
      pill.classList.remove('flash');
      pill.innerHTML = `<i class="live-dot pulse"></i> Live stream active`;
    }, 2200);
  }
}

// Optional live queue simulation controls.
let simTimer = null;
function toggleSimulation() {
  state.autoSim = !state.autoSim;
  localStorage.setItem('gq-auto-sim', state.autoSim);
  if (state.autoSim) {
    startSimulation();
    toast('⚡ Live Queue Simulation running! Counters will advance automatically.', true);
  } else {
    stopSimulation();
    toast('Live Queue Simulation paused.', false);
  }
  render(false);
}

function startSimulation() {
  stopSimulation();
  simTimer = setInterval(async () => {
    if (!state.data || !state.autoSim) return;
    const today = state.data.tokens.filter(t => t.date === 'Today');

    // 1. If any token is currently called, finish serving it
    const calledToken = today.find(t => t.status === 'called');
    if (calledToken) {
      try {
        await performTokenAction('complete', calledToken.id, { reason: 'Service completed normally' });
      } catch (e) {}
      return;
    }

    // 2. Otherwise pick next waiting citizen and call them to a counter
    const nextWaiting = today.find(t => t.status === 'waiting');
    if (nextWaiting) {
      try {
        const counterCount = Math.max(0, ...state.data.offices.map(office => Number(office.counters) || 0));
        const counters = Array.from({ length: counterCount }, (_, i) => `Counter ${String(i + 1).padStart(2, '0')}`);
        const chosenCounter = counters[Math.floor(Math.random() * counters.length)];
        await performTokenAction('call', nextWaiting.id, { counter: chosenCounter, reason: 'Next citizen called' });
      } catch (e) {}
    }
  }, 12000);
}

function stopSimulation() {
  if (simTimer) {
    clearInterval(simTimer);
    simTimer = null;
  }
}

if (state.autoSim) {
  startSimulation();
}

async function loadData() {
  try {
    const [dataResponse, sessionResponse] = await Promise.all([fetch('/api/data'), fetch('/api/session')]);
    state.data = await dataResponse.json();
    const session = await sessionResponse.json();
    state.role = session.role || 'citizen';
    state.officerName = session.name || '';
    state.citizenProfile = session.authenticated ? { id: session.id, name: session.name, email: session.email } : null;
    state.officerConfigured = session.configuredRoles || { admin: false, staff: false };
    checkForAnnouncements(state.data.tokens);
    render(true);
    updateLiveIndicator(true);
  } catch (e) {
    $('#app').innerHTML = `
      <main style="font-family:sans-serif;padding:40px">
        <h1>Tap Token could not connect</h1>
        <p>Start the local server from the project folder, then refresh.</p>
        <p>Run <code>npm start</code> and open <code>http://localhost:4173</code>.</p>
      </main>
    `;
  }
}

function initSSE() {
  if (!window.EventSource) return;
  const es = new EventSource('/api/events');

  es.onopen = () => {
    updateLiveIndicator(true);
  };

  es.addEventListener('init', e => {
    try {
      state.data = JSON.parse(e.data);
      checkForAnnouncements(state.data.tokens);
      render(true);
      updateLiveIndicator(true);
    } catch (err) {}
  });

  es.addEventListener('update', e => {
    try {
      const payload = JSON.parse(e.data);
      state.data = payload.db || payload;
      checkForAnnouncements(state.data.tokens);
      render(false); // targeted update without tearing down shell
      flashLiveIndicator('Live queue updated');
      syncAcrossTabs(state.data, payload.lastAction, payload.token);
    } catch (err) {}
  });

  es.onerror = () => {
    updateLiveIndicator(false);
  };
}

function api(path, method = 'GET', bodyData) {
  return fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: bodyData ? JSON.stringify(bodyData) : undefined
  }).then(async r => {
    const v = await r.json();
    if (!r.ok) throw new Error(v.error || 'Could not complete request');
    return v;
  });
}

const navDefs = {
  citizen: [
    ['TAP TOKEN', [
      ['/home', 'home', 'Overview'],
      ['/offices', 'office', 'Find offices'],
      ['/services', 'service', 'Services'],
      ['/book', 'book', 'Book a token'],
      ['/display', 'display', 'Lobby TV board']
    ]],
    ['MY ACCOUNT', [
      ['/tokens', 'tokens', 'My tokens'],
      ['/documents', 'docs', 'My documents'],
      ['/notifications', 'bell', 'Notifications']
    ]]
  ],
  admin: [
    ['OVERVIEW', [
      ['/admin', 'dashboard', 'Dashboard'],
      ['/admin/queue', 'queue', 'Live queue'],
      ['/admin/bookings', 'calendar', 'Bookings'],
      ['/display', 'display', 'Lobby TV board']
    ]],
    ['MANAGE', [
      ['/admin/offices', 'office', 'Offices'],
      ['/admin/staff', 'staff', 'Staff & counters'],
      ['/admin/analytics', 'analytics', 'Analytics'],
      ['/admin/audit', 'audit', 'Audit log']
    ]]
  ],
  staff: [
    ['MY WORK', [
      ['/staff', 'dashboard', 'Dashboard'],
      ['/staff/queue', 'queue', 'Current queue'],
      ['/staff/appointments', 'calendar', 'Appointments'],
      ['/display', 'display', 'Lobby TV board'],
      ['/staff/notifications', 'bell', 'Notifications']
    ]]
  ]
};

const titleMap = {
  '/home': 'Your day, made simpler',
  '/offices': 'Find an office',
  '/services': 'Government services',
  '/book': 'Book a token',
  '/track': 'Live queue',
  '/tokens': 'My tokens',
  '/documents': 'My documents',
  '/notifications': 'Notifications',
  '/display': 'Lobby waiting hall board',
  '/admin': 'Office overview',
  '/admin/queue': 'Live queue management',
  '/admin/bookings': 'Booking management',
  '/admin/offices': 'Office locations',
  '/admin/staff': 'Staff & counters',
  '/admin/analytics': 'Queue analytics',
  '/admin/audit': 'Audit log',
  '/staff': 'Staff dashboard',
  '/staff/queue': 'Current queue',
  '/staff/appointments': 'Today’s appointments',
  '/staff/notifications': 'Staff notifications'
};

function navLink(item) {
  const [path, ic, label] = item;
  const active = state.path === path || (path !== '/home' && path !== '/admin' && path !== '/staff' && state.path.startsWith(path));
  return `
    <a class="nav-link ${active ? 'active' : ''}" href="#${path}">
      <span class="nav-icon">${icon(ic)}</span>${label}
      ${label === 'Notifications' && state.data?.notifications?.some(n => n.unread) ? '<span class="nav-count">2</span>' : ''}
    </a>
  `;
}

function shell(content) {
  const admin = state.role === 'admin';
  const staff = state.role === 'staff';
  const role = admin ? 'Admin portal' : staff ? 'Staff portal' : 'Citizen portal';
  const groups = navDefs[state.role] || navDefs.citizen;
  const crumb = titleMap[state.path] || 'Your day, made simpler';
  const profileName = state.role === 'citizen' ? state.citizenProfile?.name : state.officerName;
  const userInitials = profileName ? profileName.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() : 'C';

  return `
    <div class="layout">
      <div class="overlay" id="overlay"></div>
      <aside class="sidebar ${state.sidebarCollapsed ? 'collapsed' : ''}" id="sidebar">
        <div class="brand">
          <div class="brand-mark">T</div>
          <div class="brand-name">Tap Token<span>${role.toUpperCase()}</span></div>
        </div>
        ${groups.map(g => `<div class="nav-label">${g[0]}</div>${g[1].map(navLink).join('')}`).join('')}
        <div class="side-bottom">
          <div class="help-card">
            <b>Need a hand?</b>
            <p>We’re here to help you complete your service with confidence.</p>
            <a href="#/services">Explore help →</a>
          </div>
          <div class="user-chip">
            <div class="avatar ${admin ? 'orange' : ''}">${esc(userInitials)}</div>
            <div>
              <div class="user-name">${esc(state.role === 'citizen' ? (state.citizenProfile?.name || 'Citizen') : state.officerName || 'Officer')}</div>
              <div class="user-role">${role}</div>
            </div>
            <button class="role-switch" data-action="role-menu">${state.role === 'citizen' ? '🔒 Officer Portal' : '⇄ Switch Portal'}</button>
          </div>
        </div>
      </aside>
      <main class="main ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}">
        <header class="topbar">
          <div class="topbar-left">
            <button class="sidebar-toggle" data-action="menu" aria-label="Toggle left menu" aria-expanded="${state.sidebarCollapsed ? 'false' : 'true'}">☰</button>
            <a class="mobile-brand" href="#/home"><span class="brand-mark">T</span>Tap Token</a>
            <div class="crumb">Tap Token <span style="color:#bdc6ce"> / </span> <b>${esc(crumb)}</b></div>
          </div>
          <div class="top-actions">
            <button class="sound-toggle ${state.soundEnabled ? 'active' : ''}" data-action="toggle-sound" title="Toggle audio chime and announcements">
              ${state.soundEnabled ? '🔊 Sound on' : '🔇 Muted'}
            </button>
            <span class="live-pill"><i class="live-dot"></i> Live stream active</span>
            <button class="icon-button" data-go="/notifications" aria-label="Notifications">
              ♧${state.data?.notifications?.some(n => n.unread) ? '<i class="unread"></i>' : ''}
            </button>
            <button class="avatar profile-avatar ${admin ? 'orange' : ''}" data-action="${state.role === 'citizen' ? 'citizen-profile' : 'role-menu'}" aria-label="${state.role === 'citizen' ? 'Open citizen profile' : 'Open officer profile'}" title="Profile">${esc(userInitials)}</button>
          </div>
        </header>
        <div class="page">${content}</div>
      </main>
    </div>
  `;
}

function heading(title, sub, actions = '') {
  return `
    <div class="page-heading">
      <div>
        <div class="eyebrow">${state.role === 'admin' ? 'OFFICE CONSOLE' : state.role === 'staff' ? 'STAFF WORKSPACE' : 'CITIZEN SERVICES'}</div>
        <h1>${title}</h1>
        <p class="subheading">${sub}</p>
      </div>
      ${actions ? `<div class="heading-actions">${actions}</div>` : ''}
    </div>
  `;
}

function stat(label, value, foot, ic) {
  return `
    <div class="stat-card">
      <div class="stat-head"><span>${label}</span><span class="stat-icon">${icon(ic)}</span></div>
      <div class="stat-value">${value}</div>
      <div class="stat-foot">${foot}</div>
    </div>
  `;
}

function status(s) {
  return `<span class="badge ${esc(s)}"><i class="live-dot" style="width:5px;height:5px;box-shadow:none;background:currentColor"></i>${esc(s)}</span>`;
}

function countdown(t) {
  if (t.status === 'called' || t.status === 'serving') return 'Your turn now';
  if (t.status !== 'waiting') return '—';
  const left = Math.max(0, Number(t.etaAt || Date.now() + Number(t.wait || 0) * 60000) - Date.now());
  if (left <= 0) return 'You’re next';
  const seconds = Math.floor(left / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = seconds % 60;
  return `${h ? `${String(h).padStart(2, '0')}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function tokenCard(t) {
  const progress = Math.min(94, Math.max(12, 100 - (t.ahead || 0) * 7));
  const isNear = t.status === 'waiting' && t.ahead <= 2;

  return `
    <section class="active-token">
      <div class="token-top">
        <div>
          <div class="token-label">${t.status === 'waiting' ? 'YOUR ACTIVE TOKEN' : 'TOKEN STATUS'}</div>
          <div class="token-number">${esc(t.number)}</div>
          <div class="token-service">${esc(t.service)} · ${esc(t.office.split(' ').slice(0, 3).join(' '))}</div>
        </div>
        <span class="token-live">● ${esc(t.status)}</span>
      </div>
      <div class="token-meta">
        <div><small>PEOPLE AHEAD</small><strong>${t.ahead === 0 ? 'You’re next' : t.ahead + ' people'}</strong></div>
        <div><small>EST. WAIT</small><strong>${t.wait ? t.wait + ' min' : 'Ready now'}</strong></div>
        <div><small>APPOINTMENT</small><strong>${esc(t.slot)}</strong></div>
      </div>
      <div class="eta-panel">
        <div><small>COUNTDOWN TO YOUR TURN</small><strong class="eta-countdown" data-id="${t.id}">${countdown(t)}</strong></div>
        <span>Based on the live queue estimate</span>
      </div>
      <div class="progress-line"><span style="width:${progress}%"></span></div>
      <div class="token-bottom">
        <span>Timer updates in real-time as counters call citizens</span>
        <button class="btn saffron small" data-action="qr" data-id="${t.id}">▦ &nbsp;View QR</button>
      </div>
    </section>

    ${isNear ? `
      <div class="sms-banner">
        <span class="sms-badge">SMS ALERT</span>
        <div class="sms-body">
          <b>Simulated SMS notification dispatched</b>
          <p>"Tap Token alert: Token ${esc(t.number)} is ${t.ahead === 1 ? '1 person' : `${t.ahead} people`} away from the counter. Please proceed to ${esc(t.counter || 'the assigned counter')}."</p>
        </div>
      </div>
    ` : ''}
  `;
}

function officeRows() {
  return `<div class="office-list">${state.data.offices.map(o => `
    <button class="office-row office-click" data-office-details="${o.id}">
      <span class="office-pin">⌖</span>
      <span>
        <span class="office-name">${esc(o.short)}</span>
        <span class="office-desc">${esc(o.distance)} away · ${esc(o.address)}</span>
      </span>
      <span class="office-right"><strong>${o.wait} min</strong><small>${o.people} waiting</small></span>
    </button>
  `).join('')}</div>`;
}

function activityRows() {
  return `<div>${state.data.notifications.slice(0, 3).map(n => `
    <div class="activity">
      <i class="activity-dot"></i>
      <div class="activity-text">${esc(n.title)}<small>${esc(n.text)} · ${esc(n.time)}</small></div>
    </div>
  `).join('')}</div>`;
}

function getMyActiveToken() {
  if (!state.data || !state.data.tokens) return null;
  return myCitizenTokens().find(x => ['waiting', 'called', 'serving'].includes(x.status)) || null;
}

function myCitizenTokens() {
  if (!state.data?.tokens) return [];
  if (state.citizenProfile?.id) return state.data.tokens.filter(token => token.citizenId === state.citizenProfile.id);
  const myTokens = JSON.parse(localStorage.getItem('gq-my-tokens') || '[]');
  return state.data.tokens.filter(token => myTokens.includes(token.id));
}

function citizenHome() {
  const t = getMyActiveToken();
  return `
    <section class="home-clean">
      <span class="eyebrow">CITIZEN SERVICES</span>
      <h1>How can we help today?</h1>
      <p>Every citizen’s time matters. Book a service or manage your visit.</p>
      <a class="btn primary" href="#/book">＋ &nbsp;Book a service</a>
    </section>
    ${t ? `<a class="home-token-link" href="#/track"><span class="shortcut-icon">◷</span><span><b>Track token ${esc(t.number)}</b><small>${esc(t.service)} · ${esc(t.slot)} · ${esc(t.status)}</small></span><span class="shortcut-arrow">→</span></a>` : ''}
    <nav class="home-quick-links" aria-label="Quick links">
      <a class="home-action" href="#/track"><span class="home-action-icon">◷</span><span class="home-action-copy"><b>Track queue</b><small>Check your token status, people ahead, and estimated wait time.</small></span><span class="home-action-arrow" aria-hidden="true">→</span></a>
      <a class="home-action" href="#/offices"><span class="home-action-icon">⌖</span><span class="home-action-copy"><b>Find an office</b><small>See Rajkot office locations, available services, and directions.</small></span><span class="home-action-arrow" aria-hidden="true">→</span></a>
      <a class="home-action" href="#/services"><span class="home-action-icon">▤</span><span class="home-action-copy"><b>Browse services</b><small>Choose the service you need and see what to prepare.</small></span><span class="home-action-arrow" aria-hidden="true">→</span></a>
      <a class="home-action" href="#/documents"><span class="home-action-icon">▧</span><span class="home-action-copy"><b>Check documents</b><small>Review the checklist before you visit an office.</small></span><span class="home-action-arrow" aria-hidden="true">→</span></a>
    </nav>
  `;
}

function serviceMini(s) {
  return `
    <a class="service-card" href="#/book" data-service="${s.id}">
      <div class="service-emoji">${serviceEmoji(s.category)}</div>
      <h3>${esc(s.name)}</h3>
      <p>${s.duration} min · ${esc(s.fee)}</p>
      <div class="service-foot"><span>${s.docs.length} documents</span><b style="color:var(--teal)">Book →</b></div>
    </a>
  `;
}

function serviceEmoji(c) {
  return ({ Identity: '🪪', Certificates: '📄', Transport: '🚘', Municipal: '🏠' })[c] || '📋';
}

function officesPage() {
  if (!state.data.offices.length) return `
    ${heading('Find an office', 'Office locations will appear here once they are configured.')}
    <section class="card"><div class="empty">No offices have been added yet.</div></section>
  `;
  return `
    ${heading('Find an office', 'Browse verified office locations and visit the official directory for current services and hours.')}
    <div class="grid-main" style="grid-template-columns:minmax(0,2fr) minmax(240px,.8fr);align-items:start">
      <div class="office-grid">
        ${state.data.offices.map(o => `
          <section class="card office-card">
            <button class="office-open" data-office-details="${o.id}" aria-label="View ${esc(o.name)} details">
              <div class="map-art"><span class="map-bubble">${o.directoryOnly ? 'RMC location' : `${o.wait} min wait`}</span></div>
              <div class="office-content">
                <h3>${esc(o.name)}</h3>
                <div class="muted">⌖ &nbsp;${esc(o.address)}</div>
                ${o.directoryOnly ? `<div style="margin-top:8px;font-size:10px;line-height:1.5;color:var(--muted)"><b>Services:</b> ${o.servicesAvailable?.length ? `${o.servicesAvailable.slice(0, 2).map(esc).join(' · ')}${o.servicesAvailable.length > 2 ? ` · +${o.servicesAvailable.length - 2} more` : ''}` : 'Zone administration; counter services not listed'}</div>` : ''}
                <div class="office-stats">
                  ${o.directoryOnly
                    ? '<span><b>Rajkot</b>City</span><span><b>Official</b>Directory source</span><span><b>—</b>Live queue</span>'
                    : `<span><b>${o.wait} min</b>Wait now</span><span><b>${o.people}</b>In queue</span><span><b>★ ${o.rating}</b>Rating</span>`}
                </div>
                <div class="office-bottom">
                  <span class="chip">${o.directoryOnly ? 'Office location' : `${o.services.length} services · Open`}</span>
                  <span class="btn outline small">${o.directoryOnly ? 'Official details →' : 'See services & documents →'}</span>
                </div>
              </div>
            </button>
            ${o.directoryOnly ? `<a class="btn outline small" style="display:flex;justify-content:center;margin:0 18px 18px" href="https://www.google.com/maps/dir/?api=1&amp;destination=${encodeURIComponent(o.address + ', Rajkot, Gujarat')}" target="_blank" rel="noopener noreferrer">Get directions ↗</a>` : ''}
          </section>
        `).join('')}
      </div>
      <div>
        <section class="card">
          <h2 class="card-title">Smart recommendation</h2>
          <p class="card-sub" style="line-height:1.6;margin:8px 0 14px">We compare distance, live queue and service availability to find your best option.</p>
          ${state.data.offices.slice().sort((a, b) => a.wait - b.wait).map((o, i) => `
            <button class="office-row office-click" data-office-details="${o.id}" style="padding:10px 0;border:0;border-bottom:1px solid var(--line);border-radius:0;width:100%">
              <span class="office-pin">${i === 0 ? '★' : '⌖'}</span>
              <span>
                <span class="office-name">${esc(o.short)} ${i === 0 ? '<span style="color:var(--teal)">Best</span>' : ''}</span>
                <span class="office-desc">${o.distance} · ${o.people} people</span>
              </span>
              <span class="office-right"><strong>${o.wait}m</strong></span>
            </button>
          `).join('')}
          <div class="hint"><strong>When should I go?</strong>Queue is usually lighter between 1:00 and 2:00 PM.</div>
        </section>
      </div>
    </div>
  `;
}

function servicesPage() {
  const serviceNames = [...new Set([
    ...state.data.services.map(service => service.name),
    ...state.data.offices.flatMap(office => office.servicesAvailable || [])
  ])].sort((a, b) => a.localeCompare(b));
  if (!serviceNames.length) return `
    ${heading('Explore help', 'Choose a government service to see what to prepare.')}
    <section class="card"><div class="empty">No services are listed yet.</div></section>
  `;

  const selectedName = serviceNames.includes(state.helpServiceName) ? state.helpServiceName : '';
  const selectedService = state.data.services.find(service => service.name === selectedName);
  const officeList = selectedName ? state.data.offices.filter(office => (office.servicesAvailable || []).includes(selectedName)) : [];
  const guide = servicePreparationGuide(selectedName);
  const documents = selectedService?.docs?.length ? selectedService.docs : guide.items;
  const selectedCategory = selectedService?.category || (/aadhaar|aadhar/i.test(selectedName) ? 'Identity' : 'Municipal');
  return `
    ${heading('Explore help', 'Select the service you need to see what documents and details to prepare.')}
    <section class="card" style="max-width:820px">
      <div class="field" style="margin:0">
        <label for="help-service-select">WHAT DO YOU NEED HELP WITH?</label>
        <select id="help-service-select" aria-describedby="help-service-hint">
          <option value="">Choose a service</option>
          ${serviceNames.map(name => `<option value="${esc(name)}" ${selectedName === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}
        </select>
        <small id="help-service-hint">We’ll show the office listings and preparation details for your selection.</small>
      </div>
    </section>
    ${selectedName ? `
      <section class="card" style="max-width:820px;margin-top:16px" aria-live="polite">
        <span class="eyebrow">${esc(selectedCategory)} service</span>
        <h2 class="card-title" style="margin:7px 0 5px">What to prepare</h2>
        <p class="card-sub">${esc(guide.intro)}</p>
        <div class="doc-list" style="margin:16px 0">
          ${documents.map(item => `<div class="doc-row"><span class="doc-check missing">•</span><span>${esc(item)}</span></div>`).join('')}
        </div>
        <div class="hint"><strong>Please confirm before you visit.</strong>${esc(guide.note)}</div>
        <div class="service-foot" style="margin-top:16px">
          <span>${officeList.length ? `Listed at ${officeList.length} ${officeList.length === 1 ? 'office' : 'offices'}: ${officeList.map(office => esc(office.short || office.name)).join(', ')}` : 'Ask the office to confirm availability.'}</span>
          <a class="btn outline small" href="${guide.url}" target="_blank" rel="noopener noreferrer">Official information ↗</a>
          <a class="btn primary small" href="#/book?service=${encodeURIComponent(selectedName)}">Book now →</a>
        </div>
      </section>
    ` : `
      <section class="card" style="max-width:820px;margin-top:16px"><p class="card-sub">Choose a service above and its preparation checklist will appear here.</p></section>
    `}
  `;
}

function servicePreparationGuide(name) {
  const guides = {
    'Aadhaar Centre': {
      items: ['Bring the original supporting document(s) for the enrolment or update you need.', 'For a demographic or biometric update, bring your Aadhaar number/card.'],
      intro: 'The documents depend on whether you are enrolling or changing your details.',
      note: 'Use UIDAI’s current accepted-document list for your exact update type. Originals may be checked and returned.',
      url: 'https://www.uidai.gov.in/enrolment-and-updates?isFilter=false&source=documents&sourceTitle=Documents'
    },
    'Property tax assessment and collection': {
      items: ['Property or assessment number, ward and house number.', 'Property holder’s name and address.', 'Latest property tax bill or receipt; include the water connection registration number if known.'],
      intro: 'Have your property account details ready so the office can find the correct assessment.',
      note: 'The exact papers depend on whether you are paying, requesting an assessment copy or raising an objection.',
      url: 'https://www.rmc.gov.in/FormsMobile'
    },
    'Water charges assessment and collection': {
      items: ['Water connection/account number and property address.', 'Latest water bill or payment receipt.', 'Account holder’s name and contact details.'],
      intro: 'Prepare your water account and property details.',
      note: 'Confirm the supporting papers for your particular request with Rajkot Municipal Corporation.',
      url: 'https://www.rmc.gov.in/FormsMobile'
    },
    'New water connections': {
      items: ['Property address, ward and house number.', 'Applicant and property owner details, plus a contact number.', 'Property or water-account details, if already assigned.'],
      intro: 'Have the property and applicant details ready for the connection application.',
      note: 'The RMC form and required supporting papers can depend on the property and application type. Ask the office for the current list.',
      url: 'https://www.rmc.gov.in/rmcwebsite/docs/forms/WaterConnection.pdf'
    },
    'Birth and death certificates': {
      items: ['Date and place of the birth or death event.', 'Name(s) shown on the record and applicant’s relationship to the person.', 'Applicant name, address and phone number.'],
      intro: 'Prepare the event and applicant details used to locate the municipal record.',
      note: 'The RMC copy-request form asks for these details. Ask the office whether your request needs any additional proof.',
      url: 'https://www.rmc.gov.in/rmcwebsite/docs/forms/BirthCertificateCopy.pdf'
    },
    'Shop and establishment permissions': {
      items: ['Business name, address, type of business and start date.', 'Owner/employer details and number of employees.', 'For Form A, RMC’s form says to attach the original Form C certificate.'],
      intro: 'Prepare the business details requested on the RMC shop form.',
      note: 'Use the current form for your application type and confirm any additional supporting papers with RMC.',
      url: 'https://www.rmc.gov.in/rmcwebsite/docs/forms/ShopFormA.pdf'
    },
    'Building plan permissions': {
      items: ['Property ownership or right-to-build records.', 'Site, layout and building plans prepared for the application.', 'Any permissions or no-objection certificates that apply to your project.'],
      intro: 'Building applications need project-specific plans and property records.',
      note: 'Requirements vary by project. Ask a registered professional or RMC for the current checklist before submitting.',
      url: 'https://www.rmc.gov.in/FormsMobile'
    },
    'Municipal tax collection': {
      items: ['Property/assessment number or water connection number.', 'Latest tax bill or receipt.', 'Property address and account holder’s name.'],
      intro: 'Bring the bill or account details for the tax you need to pay.',
      note: 'If you are requesting a correction or account change, ask the office which additional proof is needed.',
      url: 'https://www.rmc.gov.in/FormsMobile'
    },
    'Complaint redressal': {
      items: ['Clear description of the issue and when it happened.', 'Exact location, ward or nearby landmark.', 'Your contact details and any related bill/account number.'],
      intro: 'A clear location and description help the office route your complaint.',
      note: 'If available, bring a copy of the related bill or reference number. Ask the office whether your complaint type needs anything else.',
      url: 'https://www.rmc.gov.in/FormsMobile'
    }
  };
  return guides[name] || {
    items: ['Service or application reference number, if you have one.', 'Your name and contact details.', 'Any related bill, notice or previous application.'],
    intro: 'Prepare the information related to your request.',
    note: 'The office listing does not provide a document checklist yet. Contact the office to confirm what is required.',
    url: 'https://www.rmc.gov.in/FormsMobile'
  };
}

function bookingPage() {
  if (!state.data.offices.length) return `
    ${heading('Book a token', 'Office locations must be added before a visit token can be requested.')}
    <section class="card"><div class="empty">No office locations are configured yet.</div><a class="btn outline" href="#/offices">View offices</a></section>
  `;
  const knownServices = [...new Set([
    ...state.data.services.map(service => service.name),
    ...state.data.offices.flatMap(office => office.servicesAvailable || [])
  ])];
  return `
    ${heading('Book a token', 'Request a same-day Tap Token for a Rajkot office visit.')}
    <div class="grid-main booking-grid">
      <section class="card">
        <div class="card-title-row">
          <div><h2 class="card-title">Request a visit token</h2><p class="card-sub">Usually takes less than a minute</p></div>
          <span class="chip">Step 1 of 1</span>
        </div>
        <form id="booking-form">
          <div class="field">
            <label for="service-name">WHAT DO YOU NEED HELP WITH?</label>
            <select id="service-name" required>
              <option value="">Choose a service</option>
              ${knownServices.map(service => `<option value="${esc(service)}">${esc(service)}</option>`).join('')}
            </select>
            <div class="location-tools">
              <button type="button" class="btn outline small" data-action="use-location">${state.userLocation ? 'Clear my location' : 'Use my location for distances'}</button>
              <small>Your location is used only in this page to estimate distance.</small>
            </div>
          </div>
          <div id="office-recommendations" class="office-recommendations-list"></div>
          <div class="field">
            <label for="office-select">CHOOSE AN OFFICE</label>
            <select id="office-select" required>
              <option value="">Choose an office</option>
              ${state.data.offices.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field-grid">
            <div class="field">
              <label for="booking-date">DATE</label>
              <input id="booking-date" type="date" value="${todayISO()}" min="${todayISO()}" max="${todayISO()}" required>
            </div>
            <div class="field">
              <label for="booking-slot">AVAILABLE TIME</label>
              <select id="booking-slot">
                <option>11:30 AM</option>
                <option>12:00 PM</option>
                <option>12:30 PM</option>
                <option>01:00 PM</option>
                <option>02:00 PM</option>
                <option>02:30 PM</option>
                <option>03:00 PM</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label for="citizen-name">YOUR NAME</label>
            <input id="citizen-name" autocomplete="name" value="${esc(state.citizenProfile?.name || '')}" required>
          </div>
          <div class="hint"><strong>Before you visit</strong>This creates a Tap Token request, not an official RMC appointment. Confirm the office’s service availability before traveling.</div>
          <div class="modal-actions">
            <button class="btn primary" type="submit">Get my token &nbsp;→</button>
          </div>
        </form>
      </section>
      <div>
        <section class="card">
          <h2 class="card-title">Your visit at a glance</h2>
          <p class="card-sub" style="margin:7px 0 15px">What happens after booking</p>
          <div class="activity"><i class="activity-dot"></i><div class="activity-text"><b>Get a digital request token</b><small>Keep the QR code for your Tap Token visit request</small></div></div>
          <div class="activity"><i class="activity-dot" style="background:#5b9da7"></i><div class="activity-text"><b>Watch your place in line</b><small>Instant live updates as counter officers call tokens</small></div></div>
          <div class="activity"><i class="activity-dot" style="background:#62a17d"></i><div class="activity-text"><b>Audio announcements</b><small>Chime sounds automatically when your turn arrives</small></div></div>
          <div class="hint"><strong>Track your request</strong>Follow token updates here. The selected office must confirm its service availability.</div>
        </section>
      </div>
    </div>
  `;
}

function tokensPage() {
  const mine = myCitizenTokens();
  return `
    ${heading('My tokens', 'All your appointments in one place. Queue information updates automatically.', `
      <a class="btn primary" href="#/book">＋ &nbsp;Book a token</a>
    `)}
    <div class="tabs">
      <button class="tab ${state.filter === 'all' ? 'active' : ''}" data-filter="all">All tokens</button>
      <button class="tab ${state.filter === 'active' ? 'active' : ''}" data-filter="active">Active</button>
      <button class="tab ${state.filter === 'completed' ? 'active' : ''}" data-filter="completed">Completed</button>
    </div>
    <div class="grid-main" style="grid-template-columns:minmax(0,1.4fr) minmax(260px,.7fr);align-items:start">
      <div class="card">
        ${mine.filter(t => state.filter === 'all' || (state.filter === 'active' ? ['waiting', 'called', 'serving'].includes(t.status) : t.status === 'completed')).map(t => `
          <div class="queue-row" style="grid-template-columns:60px 1fr auto;padding:16px 0">
            <div style="font:800 15px Manrope;color:var(--navy)">${esc(t.number)}</div>
            <div>
              <div class="queue-person">${esc(t.service)}</div>
              <div class="queue-detail">${esc(t.office)} · ${esc(t.date)} at ${esc(t.slot)}<br>${t.status === 'waiting' ? `${t.ahead} people ahead · ${t.wait} min wait` : status(t.status)}</div>
            </div>
            <button class="text-action" data-action="qr" data-id="${t.id}">View token</button>
          </div>
        `).join('') || '<div class="empty">No tokens in this view yet.</div>'}
      </div>
      <div>
        ${mine.find(t => t.status === 'waiting') ? tokenCard(mine.find(t => t.status === 'waiting')) : ''}
        <section class="card">
          <h2 class="card-title">Before your visit</h2>
          <p class="card-sub" style="line-height:1.6;margin:7px 0 12px">Check your documents to avoid a second trip.</p>
          <a class="btn outline small" href="#/documents">Check requirements →</a>
        </section>
      </div>
    </div>
  `;
}

function documentsPage() {
  const svc = state.data.services.find(s => s.id === state.docServiceId) || state.data.services[1];
  if (!svc) return `
    ${heading('My documents', 'Document checklists will appear when services are configured.')}
    <section class="card"><div class="empty">No service requirements have been added yet.</div><a class="btn outline" href="#/services">Browse services</a></section>
  `;
  const readyCount = svc.docs.filter(d => state.readyDocs.includes(d)).length;
  const allReady = readyCount === svc.docs.length;
  return `
    ${heading('My documents', 'Know exactly what to bring before visiting a service centre.')}
    <div class="grid-main" style="grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);align-items:start">
      <section class="card">
        <div class="card-title-row">
          <div><h2 class="card-title">Am I ready?</h2><p class="card-sub">Check off each document you have ready.</p></div>
          <span class="badge ${allReady ? 'completed' : 'waiting'}" id="doc-ready-status">${readyCount} / ${svc.docs.length} ready</span>
        </div>
        <div class="field">
          <label>CHOOSE A SERVICE</label>
          <select id="doc-service">
            ${state.data.services.map(s => `<option value="${s.id}" ${s.id === svc.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="doc-list">
          ${svc.docs.map(d => {
            const ready = state.readyDocs.includes(d);
            return `
              <label class="doc-row">
                <span class="doc-check ${ready ? '' : 'missing'}">${ready ? '✓' : '!'}</span>
                <span>${esc(d)}<small>${ready ? 'Marked ready' : 'Still needed before your visit'}</small></span>
                <input type="checkbox" data-doc-toggle="${esc(d)}" ${ready ? 'checked' : ''} style="margin-left:auto;accent-color:var(--teal)" aria-label="Mark ${esc(d)} ready">
              </label>
            `;
          }).join('')}
        </div>
        <div class="hint">
          <strong>${allReady ? 'You’re ready to go!' : `${svc.docs.length - readyCount} document${svc.docs.length - readyCount === 1 ? '' : 's'} still to prepare`}</strong>
          Bring originals where possible. Requirements can vary by local office.
        </div>
      </section>
      <section class="card">
        <h2 class="card-title">Your saved documents</h2>
        <p class="card-sub">Personal documents are managed on this device.</p>
        <div class="doc-list" style="margin-top:17px">
          <div class="empty">No personal documents are saved on this device.</div>
          <button class="btn outline" data-action="toast" data-message="Secure document upload can be connected when storage is configured.">＋ Add a document</button>
        </div>
      </section>
    </div>
  `;
}

function trackPage() {
  const t = getMyActiveToken();
  const todayTokens = state.data.tokens.filter(token => token.date === 'Today' || token.date === todayISO());
  const officeQueues = state.data.offices.map(office => {
    const queue = todayTokens.filter(token => token.officeId === office.id && ['waiting', 'called', 'serving'].includes(token.status));
    return { office, waiting: queue.filter(token => token.status === 'waiting').length, serving: queue.find(token => token.status === 'called' || token.status === 'serving') };
  });
  return `
    ${heading('Live queue', 'Your place is refreshed instantly as counter staff call tokens.', `
      <span class="live-pill"><i class="live-dot"></i> Real-time stream active</span>
      <a class="btn outline small" href="#/display">🖵 &nbsp;Lobby TV view</a>
    `)}
    <div class="grid-main" style="grid-template-columns:minmax(0,1.2fr) minmax(270px,.8fr);align-items:start">
      ${t ? `
        <div>
          ${tokenCard(t)}
          <section class="card">
            <div class="card-title-row">
              <div><h2 class="card-title">Queue around you</h2><p class="card-sub">${esc(t.office)}</p></div>
              <span class="chip">${t.counter || '6'} counters open</span>
            </div>
            <div class="queue-list">
              ${state.data.tokens.filter(x => x.officeId === t.officeId && x.date === 'Today').slice(0, 5).map((x, i) => `
                <div class="queue-row">
                  <div class="queue-no">${x.status === 'serving' ? 'NOW' : `#${i + 1}`}</div>
                  <div>
                    <div class="queue-person">${myTokens.includes(x.id) ? 'You' : esc(x.citizen)}</div>
                    <div class="queue-detail">${esc(x.service)} · ${esc(x.number)}</div>
                  </div>
                  ${status(x.status)}
                </div>
              `).join('')}
            </div>
          </section>
        </div>
      ` : `
        <div>
          <section class="card">
            <div class="empty">No active personal token is linked to this browser yet.</div>
            <a class="btn primary" href="#/book">Book a token</a>
          </section>
          <section class="card section-gap">
            <div class="card-title-row"><div><h2 class="card-title">Live queues by office</h2><p class="card-sub">People waiting today in Tap Token</p></div><span class="chip">${todayTokens.filter(token => token.status === 'waiting').length} waiting</span></div>
            <div class="office-list">
              ${officeQueues.map(({ office, waiting, serving }) => `
                <div class="office-row">
                  <span class="office-pin">⌖</span>
                  <span><span class="office-name">${esc(office.short || office.name)}</span><span class="office-desc">${serving ? `${esc(serving.number)} called / serving` : 'No token at a counter'}</span></span>
                  <span class="office-right"><strong>${waiting}</strong><small>waiting</small></span>
                </div>
              `).join('') || '<div class="empty">No offices are available.</div>'}
            </div>
            <small class="office-distance-note">Counts include Tap Token requests only, not official RMC queues.</small>
          </section>
        </div>
      `}
      ${t ? `<div>
        <section class="card">
          <h2 class="card-title">You don’t need to wait here</h2>
          <p class="card-sub" style="line-height:1.6;margin:8px 0 15px">You can step away. The chime will alert you and an SMS is sent when your token is 2 ahead.</p>
          <div class="checkin-card">
            <span style="font-size:23px">⌖</span>
            <div>
              <strong>Arrive when you’re 2 tokens away</strong>
              <p>Keep sound on for instant call notifications.</p>
            </div>
          </div>
          <div class="hint">
            <strong>Current estimate: ${t?.wait || 0} minutes</strong>
            Wait estimates adjust as counters open, close and finish service.
          </div>
        </section>
        <section class="card section-gap">
          <h2 class="card-title">Office details</h2>
          <p class="card-sub" style="margin:8px 0 12px">
            ${t ? `⌖ &nbsp;${esc(t.office)}` : 'Book a token to see the selected office here.'}
          </p>
          <button class="btn outline small" data-action="toast" data-message="Directions are available in the full office map.">Get directions →</button>
        </section>
      </div>` : `<section class="card"><h2 class="card-title">How tracking works</h2><p class="card-sub" style="line-height:1.6;margin-top:8px">After you book a token in this browser, this page shows your status, people ahead, and estimated wait. The office counts update as Tap Token requests change.</p></section>`}
    </div>
  `;
}

// Waiting Hall TV Lobby Board Page
function displayBoardPage() {
  const today = state.data.tokens.filter(t => t.date === 'Today');
  const counters = [...new Set(today.map(t => t.counter).filter(Boolean))];
  const waitingTokens = today.filter(t => t.status === 'waiting').slice(0, 7);

  return `
    <div class="display-page">
      <div class="display-header">
        <div>
          <div class="eyebrow" style="color:#ffc966">SERVICE WAITING HALL</div>
          <h1>Public Waiting Hall Display</h1>
          <p>Tokens are called automatically in order of appointment and document verification.</p>
        </div>
        <div class="display-clock">
          <strong id="live-board-clock">${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong>
          <small><i class="live-dot" style="display:inline-block;margin-right:4px"></i> LIVE BOARD</small>
        </div>
      </div>

      <div class="display-board-grid">
        <section class="display-card">
          <div class="display-section-title">
            <h2>NOW SERVING AT COUNTERS</h2>
            <button class="btn saffron small" data-action="sound-test">🔊 Test chime</button>
          </div>
          <div class="counter-grid">
            ${counters.map(c => {
              const active = today.find(t => t.counter === c && (t.status === 'called' || t.status === 'serving'));
              const isCalling = active && active.status === 'called';
              return `
                <div class="counter-box ${isCalling ? 'calling' : active ? 'serving' : ''}">
                  <div class="counter-num-badge">${c}</div>
                  <div class="counter-status-pill">
                    ${active ? status(active.status) : '<span class="chip">Ready</span>'}
                  </div>
                  <div class="counter-token ${!active ? 'empty' : ''}">${active ? esc(active.number) : '—'}</div>
                  <div class="counter-citizen">${active ? esc(active.citizen) : 'Counter Open'}</div>
                  <div class="counter-service">${active ? esc(active.service) : 'Next citizen ready'}</div>
                </div>
              `;
            }).join('') || '<div class="empty">Counter displays will appear after queue activity is recorded.</div>'}
          </div>
        </section>

        <section class="display-card">
          <div class="display-section-title">
            <h2>UP NEXT IN LINE</h2>
            <span class="chip">${waitingTokens.length} in queue</span>
          </div>
          <div>
            ${waitingTokens.map((t, idx) => `
              <div class="display-next-item">
                <div>
                  <strong>${esc(t.number)}</strong>
                  <div class="muted" style="font-size:11px;margin-top:2px">${esc(t.citizen)} · ${esc(t.service)}</div>
                </div>
                <div style="text-align:right">
                  <div style="font-size:12px;font-weight:700;color:var(--teal)">${t.wait}m wait</div>
                  <small style="color:var(--muted);font-size:10px">${t.counter}</small>
                </div>
              </div>
            `).join('') || '<div class="empty">No citizens waiting currently.</div>'}
          </div>
        </section>
      </div>

      <div class="display-footer-banner">
        <div>📢 <b>Announcement:</b> Please keep your original documents and digital QR token ready before your number is called.</div>
        <div>Audible chime triggers on every counter call</div>
      </div>
    </div>
  `;
}

function notificationPage() {
  return `
    ${heading('Notifications', 'Updates about your bookings, queue and office visits.', `
      <button class="btn outline" data-action="read-all">Mark all as read</button>
    `)}
    <section class="card bell-list">
      ${state.data.notifications.map(n => `
        <div class="activity ${n.unread ? 'notification-unread' : ''}">
          <i class="activity-dot" style="background:${n.unread ? 'var(--saffron)' : '#c8d2da'}"></i>
          <div class="activity-text">
            <b>${esc(n.title)}</b>
            <small>${esc(n.text)} · ${esc(n.time)}</small>
          </div>
          ${n.unread ? '<span class="chip" style="margin-left:auto">New</span>' : ''}
        </div>
      `).join('') || '<div class="empty">No notifications yet.</div>'}
    </section>
  `;
}

function adminHome() {
  const today = state.data.tokens.filter(t => t.date === 'Today');
  const waitingList = today.filter(t => t.status === 'waiting');
  const completed = today.filter(t => t.status === 'completed');
  const wait = Math.round(waitingList.reduce((n, t) => n + t.wait, 0) / Math.max(1, waitingList.length));
  return `
    ${heading('Office overview', 'Live service activity across your configured offices.', `
      <a class="btn outline" href="#/display">🖵 &nbsp;Lobby display</a>
      <a class="btn primary" href="#/admin/queue">Manage queue →</a>
    `)}
    <div class="stats-grid">
      ${stat('Visitors today', today.length, 'Bookings recorded today', 'people')}
      ${stat('Currently waiting', waitingList.length, 'Across configured counters', 'queue')}
      ${stat('Average wait', `${wait} min`, 'Live calculated', 'track')}
      ${stat('Service completion', `${today.length ? Math.round(completed.length / today.length * 100) : 0}%`, 'Based on today’s bookings', 'analytics')}
    </div>
    <div class="grid-main">
      <div>
        <section class="card">
          <div class="card-title-row">
            <div><h2 class="card-title">Live queue</h2><p class="card-sub">Current citizens and their estimated wait</p></div>
            <a class="btn ghost" href="#/admin/queue">Manage all →</a>
          </div>
          ${queueTable(today.filter(t => ['waiting', 'called', 'serving'].includes(t.status)).slice(0, 5), true)}
        </section>
        <section class="card section-gap">
          <div class="card-title-row"><h2 class="card-title">Today’s service volume</h2><span class="chip">By hour</span></div>
          ${miniChart()}
        </section>
      </div>
      <div>
        <section class="card">
            <div class="card-title-row">
            <div><h2 class="card-title">Staff</h2><p class="card-sub">Configured service staff</p></div>
            <span class="chip">Live</span>
          </div>
          ${state.data.staff.map(person => `
            <div class="office-row" style="padding:10px 0;border:0;border-bottom:1px solid var(--line);border-radius:0">
              <span class="office-pin">${esc((person.initials || person.name || '?').slice(0, 2))}</span>
              <span>
                <span class="office-name">${esc(person.name)}</span>
                <span class="office-desc">${esc(person.role)} · ${esc(person.office)}</span>
              </span>
              <span class="office-right"><span class="badge ${person.status === 'On break' ? 'skipped' : 'completed'}">${esc(person.status || 'Configured')}</span></span>
            </div>
          `).join('') || '<div class="empty">No staff have been added yet.</div>'}
        </section>
        <section class="card section-gap">
          <div class="card-title-row"><h2 class="card-title">Recent actions</h2><a class="btn ghost" href="#/admin/audit">Audit log</a></div>
          ${state.data.audit.slice(0, 3).map(a => `
            <div class="activity">
              <i class="activity-dot"></i>
              <div class="activity-text">${esc(a.action)} · ${esc(a.token)}<small>${esc(a.actor)} · ${esc(a.time)}</small></div>
            </div>
          `).join('') || '<div class="empty">No actions have been recorded yet.</div>'}
        </section>
      </div>
    </div>
  `;
}

function queueTable(tokens, controls = false) {
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Token / Citizen</th>
            <th>Service</th>
            <th>Time</th>
            <th>Queue</th>
            <th>Status</th>
            ${controls ? '<th>Actions</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${tokens.map(t => `
            <tr>
              <td><span class="table-primary">${esc(t.number)}</span><span class="table-muted">${esc(t.citizen)}</span></td>
              <td>${esc(t.service)}</td>
              <td>${esc(t.slot)}</td>
              <td>${t.status === 'waiting' ? `${t.ahead} ahead · ${t.wait}m` : '—'}</td>
              <td>${status(t.status)}</td>
              ${controls ? `
                <td>
                  <div class="action-row">
                    ${t.status === 'waiting' ? `
                      <button class="text-action" data-token-action="call" data-id="${t.id}">Call</button>
                      <button class="text-action red" data-token-action="skip" data-id="${t.id}">Skip</button>
                    ` : t.status === 'called' || t.status === 'serving' ? `
                      <button class="text-action" data-token-action="complete" data-id="${t.id}">Complete</button>
                    ` : ''}
                    <button class="text-action" data-token-action="reschedule" data-id="${t.id}">Move</button>
                  </div>
                </td>
              ` : ''}
            </tr>
          `).join('') || '<tr><td colspan="6" class="empty">No queue entries match.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function adminQueue() {
  const q = state.data.tokens.filter(t => t.date === 'Today');
  const wait = Math.round(q.filter(t => t.status === 'waiting').reduce((sum, token) => sum + Number(token.wait || 0), 0) / Math.max(1, q.filter(t => t.status === 'waiting').length));
  return `
    ${heading('Live queue management', 'Call, move or skip tokens. Instant push keeps citizens notified.', `
      <a class="btn outline" href="#/display">🖵 &nbsp;Open TV display</a>
    `)}
    <div class="stats-grid">
      ${stat('In queue', q.filter(t => t.status === 'waiting').length, 'Across all counters', 'queue')}
      ${stat('Called', q.filter(t => t.status === 'called').length, 'Awaiting citizen arrival', 'track')}
      ${stat('Serving', q.filter(t => t.status === 'serving').length, 'At a counter now', 'people')}
      ${stat('Average wait', `${wait} min`, 'Live dynamic estimate', 'analytics')}
    </div>
    <section class="card">
      <div class="card-title-row">
        <div><h2 class="card-title">Today’s tokens</h2><p class="card-sub">Actions broadcast in real-time to all screens.</p></div>
        <div class="filter-row">
          <select class="filter-select" id="queue-filter">
            <option value="all">All statuses</option>
            <option value="waiting">Waiting</option>
            <option value="called">Called</option>
            <option value="serving">Serving</option>
            <option value="completed">Completed</option>
          </select>
          <div class="search-box"><input id="queue-search" placeholder="Search token or citizen"></div>
        </div>
      </div>
      <div id="admin-queue-table">${queueTable(q, true)}</div>
    </section>
  `;
}

function adminBookings() {
  const tokens = state.data.tokens.filter(t => t.date === 'Today');
  return `
    ${heading('Booking management', 'Review appointments and make controlled changes with a clear reason.', `
      <button class="btn primary" data-go="/book">＋ &nbsp;Create booking</button>
    `)}
    <section class="card">
      <div class="card-title-row">
        <div><h2 class="card-title">All bookings</h2><p class="card-sub">${tokens.length} appointments scheduled today</p></div>
        <div class="filter-row"><span class="chip">Today</span><span class="chip">All offices</span></div>
      </div>
      ${queueTable(tokens, true)}
    </section>
  `;
}

function miniChart() {
  const served = state.data.tokens.filter(t => t.date === 'Today' && t.status === 'completed');
  if (!served.length) return '<div class="empty">Visit activity will appear here when tokens are completed.</div>';
  const vals = Array(12).fill(0);
  served.forEach(token => {
    const match = String(token.createdAt || '').match(/^(\d{1,2})(?::\d{2})?\s*(AM|PM)$/i);
    if (!match) return;
    let hour = Number(match[1]) % 12;
    if (match[2].toUpperCase() === 'PM') hour += 12;
    const index = hour - 8;
    if (index >= 0 && index < vals.length) vals[index]++;
  });
  const max = Math.max(1, ...vals);
  return `
    <div class="chart">
      ${vals.map((v, i) => `
        <div class="bar-wrap">
          <div class="bar-value">${v}</div>
          <div class="bar" style="height:${Math.max(8, v / max * 110)}px"></div>
          <div class="bar-label">${(i + 8) % 12 || 12}${i + 8 < 12 ? 'a' : 'p'}</div>
        </div>
      `).join('')}
    </div>
    <div class="chart-legend" style="margin-top:12px"><i class="legend-dot"></i>Visitors served by hour</div>
  `;
}

function adminAnalytics() {
  const completed = state.data.tokens.filter(t => t.status === 'completed');
  const allWaits = state.data.tokens.filter(t => Number.isFinite(Number(t.wait)));
  const averageWait = Math.round(allWaits.reduce((sum, token) => sum + Number(token.wait), 0) / Math.max(1, allWaits.length));
  const servicesCount = state.data.services.length;
  const total = state.data.tokens.length;
  return `
    ${heading('Queue analytics', 'A clearer picture of service demand and office performance.')}
    <div class="stats-grid">
      ${stat('Visitors served', completed.length, 'Completed tokens recorded', 'people')}
      ${stat('Average wait', `${averageWait} min`, 'Across recorded tokens', 'track')}
      ${stat('Configured services', servicesCount, 'Available in the service directory', 'service')}
      ${stat('Recorded bookings', total, 'Across all dates', 'calendar')}
    </div>
    <div class="grid-main">
      <section class="card">
        <div class="card-title-row"><div><h2 class="card-title">Visitors served</h2><p class="card-sub">Today by hour</p></div><span class="chip">Today</span></div>
        ${miniChart()}
      </section>
      <section class="card">
        <h2 class="card-title">Service demand</h2>
        <p class="card-sub" style="margin:5px 0 14px">Share of today’s bookings</p>
        ${state.data.services.map(s => {
          const count = state.data.tokens.filter(token => token.service === s.name).length;
          const percent = total ? Math.round(count / total * 100) : 0;
          return `
          <div style="margin:14px 0">
            <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:6px">
              <b>${esc(s.name)}</b><span style="color:var(--muted)">${percent}%</span>
            </div>
            <div class="progress-line" style="background:#edf1f2;margin:0">
              <span style="width:${percent}%;background:var(--teal)"></span>
            </div>
          </div>
        `;
        }).join('') || '<div class="empty">No service demand to report yet.</div>'}
      </section>
    </div>
    <section class="card section-gap">
      <div class="card-title-row"><div><h2 class="card-title">Office comparison</h2><p class="card-sub">Live service performance</p></div></div>
      <div class="office-grid">
        ${state.data.offices.map(o => `
          <div class="office-row">
            <span class="office-pin">⌖</span>
            <span><span class="office-name">${esc(o.short)}</span><span class="office-desc">${o.people} waiting now</span></span>
            <span class="office-right"><strong>${o.wait}m</strong><small>average wait</small></span>
          </div>
        `).join('') || '<div class="empty">No offices have been configured yet.</div>'}
      </div>
    </section>
  `;
}

function staffPage() {
  const today = state.data.tokens.filter(t => t.date === 'Today');
  const active = today.filter(t => ['waiting', 'called', 'serving'].includes(t.status));
  const completed = today.filter(t => t.status === 'completed');
  const next = active.find(t => t.status === 'waiting');
  return `
    ${heading(`Welcome, ${esc(state.officerName || 'Staff member')}`, 'Your current queue and service activity.')}
    <div class="stats-grid">
      ${stat('Active queue', active.length, 'Waiting, called or in service', 'queue')}
      ${stat('Completed today', completed.length, 'Completed tokens recorded', 'people')}
      ${stat('Next token', next?.number || '—', next?.service || 'No one waiting', 'tokens')}
      ${stat('Service mode', 'Ready', 'Live queue updates enabled', 'service')}
    </div>
    <div class="grid-main">
      <section class="card">
        <div class="card-title-row">
          <div><h2 class="card-title">Next in line</h2><p class="card-sub">Call next when ready at counter</p></div>
          <a class="btn ghost" href="#/staff/queue">Full queue →</a>
        </div>
        ${state.data.tokens.filter(t => t.date === 'Today' && ['waiting', 'called', 'serving'].includes(t.status)).slice(0, 4).map(t => `
          <div class="queue-row">
            <span class="queue-no">${t.number}</span>
            <div><div class="queue-person">${esc(t.citizen)}</div><div class="queue-detail">${esc(t.service)} · ${t.slot}</div></div>
            <div class="action-row">
              ${t.status === 'waiting' ? `
                <button class="btn primary small" data-token-action="call" data-id="${t.id}">Call</button>
              ` : `
                <button class="btn outline small" data-token-action="complete" data-id="${t.id}">Done</button>
              `}
            </div>
          </div>
        `).join('')}
      </section>
      <div>
        <section class="card">
          <h2 class="card-title">Queue controls</h2>
          <p class="card-sub">Use the actions beside each appointment.</p>
          <div class="hint" style="margin-top:16px;background:#edf7f4;color:#2a6554">
            <strong>Real-time broadcast enabled</strong>
            Calling a token sounds an audio chime and updates the Lobby TV display immediately.
          </div>
          <a class="btn outline" style="margin-top:12px;display:block;text-align:center" href="#/display">View lobby display board →</a>
        </section>
      </div>
    </div>
  `;
}

function staffQueue() {
  const q = state.data.tokens.filter(t => t.date === 'Today' && ['waiting', 'called', 'serving'].includes(t.status));
  return `
    ${heading('Current queue', 'Changes push instantly to all connected screens.', `
      <a class="btn outline small" href="#/display">🖵 &nbsp;Lobby board</a>
    `)}
    <section class="card">
      <div class="card-title-row">
        <div><h2 class="card-title">Citizens waiting</h2><p class="card-sub">Call next, begin service or finish a visit.</p></div>
        <span class="chip">${q.length} active</span>
      </div>
      ${queueTable(q, true)}
    </section>
  `;
}

function adminOffices() {
  return `
    ${heading('Office locations', 'Monitor availability, queue levels and services at each location.')}
    <div class="office-grid">
      ${state.data.offices.map(o => `
        <section class="card office-card">
          <div class="map-art"><span class="map-bubble">Open today</span></div>
          <div class="office-content">
            <h3>${esc(o.name)}</h3>
            <div class="muted">${esc(o.address)}</div>
            <div class="office-stats">
              <span><b>${o.counters}</b>Counters</span>
              <span><b>${o.people}</b>Waiting</span>
              <span><b>${o.wait} min</b>Wait</span>
            </div>
            <div class="office-bottom">
              <span class="chip">${o.services.length} services</span>
              <button class="text-action" data-action="toast" data-message="Office settings can be connected to your data store.">Manage office →</button>
            </div>
          </div>
        </section>
      `).join('') || '<section class="card"><div class="empty">No offices have been configured yet.</div></section>'}
    </div>
  `;
}

function staffManagement() {
  return `
    ${heading('Staff & counters', 'Manage staff assignments and see who is serving citizens today.')}
    <section class="card">
      <div class="card-title-row">
        <div><h2 class="card-title">Office team</h2><p class="card-sub">${state.data.staff.length} staff members across ${state.data.offices.length} offices</p></div>
        <span class="chip">${state.data.staff.filter(s => s.status === 'On duty').length} on duty</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>Staff member</th><th>Role</th><th>Office</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${state.data.staff.map(s => `
              <tr>
                <td><div style="display:flex;align-items:center;gap:9px"><div class="avatar">${s.initials}</div><span class="table-primary">${esc(s.name)}</span></div></td>
                <td>${esc(s.role)}</td>
                <td>${esc(s.office)}</td>
                <td><span class="badge ${s.status === 'On duty' ? 'completed' : 'waiting'}">${esc(s.status)}</span></td>
                <td><button class="text-action" data-action="toast" data-message="Staff details opened.">View details</button></td>
              </tr>
            `).join('') || '<tr><td colspan="5" class="empty">No staff have been added yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function auditPage() {
  return `
    ${heading('Audit log', 'A transparent record of queue and booking changes.', `
      <button class="btn outline" data-action="toast" data-message="Audit log is current.">↓ &nbsp;Export log</button>
    `)}
    <section class="card">
      <div class="card-title-row">
        <div><h2 class="card-title">Recent actions</h2><p class="card-sub">Every skip, move and cancellation requires a reason.</p></div>
        <span class="chip">${state.data.audit.length} records</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>Time</th><th>Action</th><th>Token</th><th>Performed by</th><th>Reason</th></tr>
          </thead>
          <tbody>
            ${state.data.audit.map(a => `
              <tr>
                <td>${esc(a.time)}</td>
                <td class="table-primary">${esc(a.action)}</td>
                <td>${esc(a.token)}</td>
                <td>${esc(a.actor)}</td>
                <td>${esc(a.reason)}</td>
              </tr>
            `).join('') || '<tr><td colspan="5" class="empty">No actions have been recorded yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

// Targeted and intelligent rendering to preserve active focus and avoid DOM destruction
function render(fullShell = false) {
  if (!state.data) return;

  const adminRoute = state.path.startsWith('/admin');
  const staffRoute = state.path.startsWith('/staff');
  const allowed = adminRoute ? state.role === 'admin' : staffRoute ? ['staff', 'admin'].includes(state.role) : true;
  if (!allowed) {
    const needsSignIn = state.role === 'citizen';
    state.path = '/home';
    history.replaceState(null, '', `${location.pathname}${location.search}#/home`);
    render(true);
    if (needsSignIn) openRoleMenu();
    else toast(`This page is not available to ${state.role} accounts.`, false);
    return;
  }

  const pages = {
    '/home': citizenHome,
    '/offices': officesPage,
    '/services': servicesPage,
    '/book': bookingPage,
    '/track': trackPage,
    '/tokens': tokensPage,
    '/documents': documentsPage,
    '/display': displayBoardPage,
    '/notifications': notificationPage,
    '/admin': adminHome,
    '/admin/queue': adminQueue,
    '/admin/bookings': adminBookings,
    '/admin/offices': adminOffices,
    '/admin/staff': staffManagement,
    '/admin/analytics': adminAnalytics,
    '/admin/audit': auditPage,
    '/staff': staffPage,
    '/staff/queue': staffQueue,
    '/staff/appointments': staffQueue,
    '/staff/notifications': notificationPage
  };

  const view = (pages[state.path] || pages['/home'])();
  const pageContainer = $('.page');
  const existingLayout = $('.layout');

  // If fullShell is requested or layout is not yet rendered, render full shell
  if (fullShell || !existingLayout || !pageContainer) {
    $('#app').innerHTML = shell(view);
  } else {
    // Targeted update: update only page contents and breadcrumb/nav states
    const activeInputId = document.activeElement?.id;
    const activeInputVal = document.activeElement?.value;

    pageContainer.innerHTML = view;

    // Update breadcrumb
    const crumbEl = $('.crumb b');
    if (crumbEl) crumbEl.textContent = titleMap[state.path] || 'Your day, made simpler';

    // Update active nav-links
    document.querySelectorAll('.sidebar .nav-link').forEach(link => {
      const href = link.getAttribute('href')?.slice(1);
      const isActive = state.path === href || (href !== '/home' && href !== '/admin' && href !== '/staff' && state.path.startsWith(href));
      link.classList.toggle('active', !!isActive);
    });

    // Update sound toggle button state
    const soundBtn = $('.sound-toggle');
    if (soundBtn) {
      soundBtn.className = `sound-toggle ${state.soundEnabled ? 'active' : ''}`;
      soundBtn.innerHTML = state.soundEnabled ? '🔊 Sound on' : '🔇 Muted';
    }

    // Restore focus if the user was typing in a search or filter input
    if (activeInputId && $('#' + activeInputId)) {
      const el = $('#' + activeInputId);
      if (activeInputVal !== undefined) el.value = activeInputVal;
      el.focus();
    }
  }

  document.title = `${titleMap[state.path] || 'Tap Token'} — Tap Token`;

  if (state.path === '/book') {
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const sv = params.get('service');
    const office = params.get('office');
    if (sv && $('#service-name')) $('#service-name').value = state.data.services.find(s => s.id === sv)?.name || sv;
    if (office && $('#office-select')) $('#office-select').value = office;
    renderOfficeRecommendations();
  }

  if (state.path === '/admin/queue') {
    filterQueue();
  }
}

function updateRequirements() {
  const id = $('#service-select')?.value;
  const box = $('#requirements-preview');
  if (!box) return;
  const svc = state.data.services.find(s => s.id === id);
  if (!svc) {
    box.innerHTML = '';
    return;
  }
  const ready = svc.docs.filter(d => state.readyDocs.includes(d)).length;
  box.innerHTML = `
    <div class="hint" style="margin:4px 0 0;background:#eff7f5;color:#35645e">
      <strong>Documents ready: ${ready} / ${svc.docs.length}</strong>
      ${svc.docs.map(d => `${state.readyDocs.includes(d) ? '✓' : '○'} ${esc(d)}`).join(' &nbsp; · &nbsp;')}
      <div style="margin-top:7px"><a href="#/documents" style="color:var(--teal);font-weight:700">Update my checklist →</a></div>
    </div>
  `;
}

function toast(message, success = true) {
  const el = document.createElement('div');
  el.className = `toast ${success ? 'success' : ''}`;
  el.textContent = message;
  $('#toast-root').append(el);
  setTimeout(() => el.remove(), 3400);
}

function openModal(title, bodyHtml, buttons = '') {
  document.querySelectorAll('.modal-backdrop').forEach(modal => modal.remove());
  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `
    <section class="modal">
      <div class="modal-head">
        <div>
          <div class="eyebrow">TAP TOKEN</div>
          <h2>${title}</h2>
        </div>
        <button class="modal-close" data-action="close-modal">×</button>
      </div>
      ${bodyHtml}
      ${buttons ? `<div class="modal-actions">${buttons}</div>` : ''}
    </section>
  `;
  document.body.append(el);
  return el;
}

function renderOfficeChecklist(officeId, serviceId) {
  const office = state.data.offices.find(o => o.id === officeId);
  const service = state.data.services.find(s => s.id === serviceId);
  const box = $('#office-doc-checklist');
  if (!office || !service || !box) return;
  const ready = service.docs.filter(d => state.readyDocs.includes(d)).length;
  $('#office-doc-status').innerHTML = `<span class="badge ${ready === service.docs.length ? 'completed' : 'waiting'}">${ready} / ${service.docs.length} documents ready</span>`;
  box.innerHTML = `
    <div class="doc-list">
      ${service.docs.map(d => {
        const has = state.readyDocs.includes(d);
        return `
          <label class="doc-row">
            <span class="doc-check ${has ? '' : 'missing'}">${has ? '✓' : '!'}</span>
            <span>${esc(d)}<small>${has ? 'Ready to bring' : 'Mark when you have it ready'}</small></span>
            <input type="checkbox" data-doc-toggle="${esc(d)}" ${has ? 'checked' : ''} style="margin-left:auto;accent-color:var(--teal)">
          </label>
        `;
      }).join('')}
    </div>
    <div class="hint">
      <strong>${ready === service.docs.length ? 'You’re ready for this service' : 'Check off what you have'}</strong>
      Your checklist is saved on this device and will also appear when booking.
    </div>
  `;
}

function openOfficeDetails(officeId) {
  const office = state.data.offices.find(o => o.id === officeId);
  if (!office) return;
  const services = state.data.services.filter(s => office.services.includes(s.name));
  const first = services[0];
  if (!first) {
    if (office.directoryOnly) {
      const services = office.servicesAvailable || [];
      const serviceContent = services.length
        ? `<div class="doc-list" style="margin:14px 0">${services.map(service => `<div class="doc-row" style="padding:8px 0">✓ &nbsp;${esc(service)}</div>`).join('')}</div><p class="card-sub" style="line-height:1.5">${esc(office.servicesNote || 'Confirm current availability with RMC before visiting.')}</p>`
        : `<div class="hint"><strong>Services not listed by branch</strong>${esc(office.servicesNote || 'Contact RMC to confirm which citizen-counter services are available here.')}</div>`;
      openModal(
        esc(office.short),
        `
          <p class="subheading">${esc(office.address)}</p>
          <h3 class="card-title" style="margin-top:16px">Services at this location</h3>
          ${serviceContent}
        <div class="hint"><strong>Tap Token status</strong>These are directory details only. Office hours and appointments are not connected to Tap Token.</div>
          <div class="modal-actions">
            <a class="btn primary" href="https://www.google.com/maps/dir/?api=1&amp;destination=${encodeURIComponent(office.address + ', Rajkot, Gujarat')}" target="_blank" rel="noopener noreferrer">Get directions ↗</a>
            <a class="btn outline" href="${esc(office.source)}" target="_blank" rel="noopener noreferrer">RMC directory →</a>
            <button class="btn outline" data-action="close-modal">Close</button>
          </div>
        `
      );
    } else {
      toast('No services are listed for this office.', false);
    }
    return;
  }
  openModal(
    esc(office.short),
    `
      <p class="subheading">${esc(office.address)} · ${office.distance} away · ${office.wait} min estimated wait</p>
      <div class="field" style="margin-top:16px">
        <label>CHOOSE A SERVICE TO CHECK</label>
        <select id="office-service">
          ${services.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
        </select>
      </div>
      <div class="card-title-row" style="margin-bottom:10px">
        <h3 class="card-title" style="font-size:13px">Documents for your visit</h3>
        <span id="office-doc-status"></span>
      </div>
      <div id="office-doc-checklist"></div>
      <div class="modal-actions">
        <button class="btn primary" data-office-book="${office.id}" data-service-id="${first.id}">Continue to booking →</button>
        <button class="btn outline" data-action="close-modal">Close</button>
      </div>
    `
  );
  renderOfficeChecklist(office.id, first.id);
}

function showQR(id) {
  const t = state.data.tokens.find(x => x.id === id);
  if (!t) return;
  return openModal(
    'Your digital token',
    `
      <div class="token-confirm">
        <div class="token-label">TOKEN NUMBER</div>
        <div class="token-number">${esc(t.number)}</div>
        <div>${esc(t.service)}</div>
        <div class="qr"><span>▦</span></div>
        <div style="font-size:11px;color:#cce1e1">${esc(t.office)} · ${esc(t.slot)}</div>
      </div>
      <p class="subheading" style="text-align:center;margin-top:15px">Show this QR at the entry kiosk to check in. Your token is safely saved in My tokens.</p>
      <div class="modal-actions">
        <button class="btn primary" data-action="checkin" data-id="${t.id}">✓ &nbsp;Check in at office</button>
        <button class="btn outline" data-action="close-modal">Close</button>
      </div>
    `
  );
}

function openCitizenProfile() {
  if (state.citizenProfile) {
    openModal('Your profile', `
      <div class="profile-summary">
        <div class="avatar">${esc(state.citizenProfile.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase())}</div>
        <div><strong>${esc(state.citizenProfile.name)}</strong><small>${esc(state.citizenProfile.email)}</small></div>
      </div>
      <p class="subheading" style="margin:14px 0">Your Tap Token profile is signed in on this device.</p>
      <div class="modal-actions">
        <button class="btn outline" data-go="#/tokens">My tokens</button>
        <button class="btn danger" data-action="citizen-logout">Sign out</button>
      </div>
    `);
    return;
  }
  state.citizenAuthMode = state.citizenAuthMode || 'login';
  renderCitizenAuthModal();
}

function renderCitizenAuthModal() {
  const signup = state.citizenAuthMode === 'signup';
  openModal(signup ? 'Create your citizen account' : 'Sign in to Tap Token', `
    <p class="subheading" style="margin-bottom:16px">${signup ? 'Save your profile and manage your visit tokens.' : 'Sign in to view your profile and manage visit tokens.'}</p>
    <div class="auth-tabs" role="tablist" aria-label="Citizen account options">
      <button class="tab ${signup ? '' : 'active'}" type="button" data-citizen-mode="login">Sign in</button>
      <button class="tab ${signup ? 'active' : ''}" type="button" data-citizen-mode="signup">Create account</button>
    </div>
    <form id="citizen-auth-form" data-mode="${signup ? 'signup' : 'login'}">
      ${signup ? `<div class="field"><label for="citizen-account-name">YOUR NAME</label><input id="citizen-account-name" name="name" autocomplete="name" minlength="2" maxlength="80"><small>Needed when creating a new account.</small></div>` : ''}
      <div class="field"><label for="citizen-account-email">EMAIL</label><input id="citizen-account-email" name="email" type="email" autocomplete="email" maxlength="254" required></div>
      <div class="field"><label for="citizen-account-password">PASSWORD</label><input id="citizen-account-password" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="8" maxlength="128" required>${signup ? '<small>Use at least 8 characters.</small>' : ''}</div>
      <div id="citizen-auth-error" role="alert" style="color:var(--red);font-size:11px;display:none"></div>
      <div class="modal-actions"><button class="btn primary" type="submit" style="width:100%">${signup ? 'Create account' : 'Sign in'} →</button></div>
    </form>
  `);
  setTimeout(() => (signup ? $('#citizen-account-name') : $('#citizen-account-email'))?.focus(), 50);
}

function openRoleMenu() {
  const isOfficer = state.role !== 'citizen';
  const setupNotice = !state.officerConfigured.admin || !state.officerConfigured.staff
    ? `<div class="hint" style="margin-bottom:14px"><strong>Officer accounts need setup</strong>${!state.officerConfigured.admin ? 'Set ADMIN_NAME and ADMIN_PIN' : ''}${!state.officerConfigured.admin && !state.officerConfigured.staff ? ' and ' : ''}${!state.officerConfigured.staff ? 'set STAFF_NAME and STAFF_PIN' : ''} in the project’s .env file, then restart Tap Token.</div>`
    : '';
  openModal(
    'Government Officer Portal',
    `
      <p class="subheading" style="margin-bottom:16px">
        Restricted area for government employees. Enter your officer name and security PIN to access counter and office controls.
      </p>
      ${setupNotice}

      ${isOfficer ? `
        <div style="background:#f0f5f7;border:1px solid #d2e3eb;border-radius:12px;padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--navy)">Active Officer Session</div>
            <div style="font-size:10px;color:var(--muted)">Signed in as ${esc(state.officerName || 'Officer')}</div>
          </div>
          <button class="btn outline small" data-switch-public="citizen" style="padding:6px 10px">Sign Out to Citizen View</button>
        </div>
      ` : ''}

      <div class="field">
        <label for="officer-name">OFFICER NAME / USERNAME</label>
        <input id="officer-name" placeholder="Enter your configured officer name" autocomplete="username" required>
      </div>

      <div class="field" style="margin-top:14px">
        <label for="officer-pin">SECURITY PIN</label>
        <input type="password" id="officer-pin" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="6-digit PIN" autocomplete="off" required>
        <div id="pin-error-msg" style="color:var(--red);font-size:11px;font-weight:700;display:none;margin-top:6px"></div>
      </div>

      <div class="modal-actions" style="margin-top:20px">
        <button type="button" class="btn primary" id="btn-verify-officer" style="width:100%">Authenticate & Sign In →</button>
      </div>
    `
  );
  setTimeout(() => $('#officer-name')?.focus(), 80);
}

function actionModal(kind, id) {
  const t = state.data.tokens.find(x => x.id === id);
  if (!t) return;
  if (kind === 'reschedule') {
    openModal(
      `Move ${t.number}`,
      `
        <p class="subheading">Choose a new time and record why the appointment is changing.</p>
        <div class="field" style="margin-top:17px">
          <label>NEW TIME</label>
          <select id="new-slot">
            <option>12:00 PM</option>
            <option>12:30 PM</option>
            <option>01:00 PM</option>
            <option>01:30 PM</option>
            <option>02:00 PM</option>
            <option>02:30 PM</option>
            <option>03:00 PM</option>
          </select>
        </div>
        <div class="field">
          <label>REASON (REQUIRED)</label>
          <input id="change-reason" placeholder="e.g. Counter temporarily unavailable">
        </div>
        <div class="modal-actions">
          <button class="btn primary" data-confirm-action="reschedule" data-id="${id}">Save change</button>
          <button class="btn outline" data-action="close-modal">Keep current time</button>
        </div>
      `
    );
    return;
  }
  if (kind === 'skip' || kind === 'cancel') {
    const isSkip = kind === 'skip';
    const reasons = isSkip ? [
      'Citizen not present at counter (No-show)',
      'Required documents missing or invalid',
      'Citizen requested more preparation time',
      'Sent to help desk / another counter',
      'Incorrect service selected by citizen',
      'Technical or biometric device failure',
      'Other reason (custom note)'
    ] : [
      'Citizen requested cancellation',
      'Duplicate booking detected',
      'Service unavailable today',
      'Office closing early / emergency',
      'Other reason (custom note)'
    ];

    openModal(
      `${isSkip ? 'Skip' : 'Cancel'} ${t.number}`,
      `
        <p class="subheading">Select a reason for ${isSkip ? 'skipping' : 'cancelling'} this token. This will be recorded in the public audit trail.</p>
        
        <div class="field" style="margin-top:16px">
          <label for="skip-reason-select">COMMON REASONS</label>
          <select id="skip-reason-select">
            ${reasons.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
          </select>
        </div>

        <div class="field">
          <label>QUICK OPTIONS</label>
          <div class="reason-chips">
            ${isSkip ? `
              <button type="button" class="reason-chip active" data-chip-reason="Citizen not present at counter (No-show)">👤 No-show</button>
              <button type="button" class="reason-chip" data-chip-reason="Required documents missing or invalid">📄 Missing docs</button>
              <button type="button" class="reason-chip" data-chip-reason="Citizen requested more preparation time">⏱ Needs time</button>
              <button type="button" class="reason-chip" data-chip-reason="Sent to help desk / another counter">🔄 Wrong counter</button>
              <button type="button" class="reason-chip" data-chip-reason="Technical or biometric device failure">⚙ Tech issue</button>
            ` : `
              <button type="button" class="reason-chip active" data-chip-reason="Citizen requested cancellation">❌ Citizen request</button>
              <button type="button" class="reason-chip" data-chip-reason="Duplicate booking detected">📑 Duplicate</button>
              <button type="button" class="reason-chip" data-chip-reason="Service unavailable today">🚫 Unavailable</button>
            `}
          </div>
        </div>

        <div class="field">
          <label for="change-reason">REASON DETAILS / NOTES (REQUIRED)</label>
          <input id="change-reason" value="${esc(reasons[0])}" placeholder="Enter reason or additional notes" required>
        </div>

        <div class="modal-actions">
          <button class="btn danger" data-confirm-action="${kind}" data-id="${id}">Confirm ${isSkip ? 'Skip Token' : 'Cancel Token'}</button>
          <button class="btn outline" data-action="close-modal">Go back</button>
        </div>
      `
    );
    return;
  }
  performTokenAction(kind, id);
}

async function performTokenAction(action, id, extra = {}) {
  try {
    const updated = await api(`/api/tokens/${encodeURIComponent(id)}`, 'PATCH', {
      action,
      ...extra
    });
    syncAcrossTabs(state.data, action, updated);
    toast(action === 'call' ? 'Citizen called to the counter.' : action === 'complete' ? 'Visit marked complete.' : action === 'checkin' ? 'You are checked in.' : `Token ${action} updated.`);
  } catch (e) {
    toast(e.message, false);
  }
}

function filterQueue() {
  const q = $('#admin-queue-table');
  if (!q) return;
  const statusFilter = $('#queue-filter')?.value || 'all';
  const term = ($('#queue-search')?.value || '').toLowerCase();
  const rows = state.data.tokens.filter(t => t.date === 'Today' && (statusFilter === 'all' || t.status === statusFilter) && `${t.number} ${t.citizen} ${t.service}`.toLowerCase().includes(term));
  q.innerHTML = queueTable(rows, true);
}

// Global Event Listeners
document.addEventListener('click', async e => {
  const side = $('#sidebar');
  const clickedMenu = e.target.closest('.sidebar-toggle');
  if (side && !clickedMenu && !side.contains(e.target)) {
    if (window.matchMedia('(max-width: 760px)').matches && side.classList.contains('open')) {
      side.classList.remove('open');
      $('#overlay')?.classList.remove('show');
      $('.sidebar-toggle')?.setAttribute('aria-expanded', 'false');
    } else if (!window.matchMedia('(max-width: 760px)').matches && !state.sidebarCollapsed) {
      state.sidebarCollapsed = true;
      side.classList.add('collapsed');
      $('.main')?.classList.add('sidebar-collapsed');
      $('.sidebar-toggle')?.setAttribute('aria-expanded', 'false');
    }
  }

  const link = e.target.closest('a[href^="#"]');
  if (link) {
    let path = link.getAttribute('href').slice(1);
    if (path) {
      e.preventDefault();
      if (link.dataset.service) path = `/book?service=${link.dataset.service}`;
      location.hash = path;
      $('#sidebar')?.classList.remove('open');
      $('#overlay')?.classList.remove('show');
    }
    return;
  }

  const switchPublic = e.target.closest('[data-switch-public]');
  if (switchPublic) {
    await api('/api/session/logout', 'POST', {});
    state.role = 'citizen';
    state.officerName = '';
    location.hash = '#/home';
    document.querySelector('.modal-backdrop')?.remove();
    toast('Switched to Public Citizen portal');
    render(true);
    return;
  }

  const citizenMode = e.target.closest('[data-citizen-mode]');
  if (citizenMode) {
    state.citizenAuthMode = citizenMode.dataset.citizenMode;
    document.querySelectorAll('.modal-backdrop').forEach(modal => modal.remove());
    renderCitizenAuthModal();
    return;
  }
  if (e.target.closest('[data-action="citizen-profile"]')) {
    openCitizenProfile();
    return;
  }
  if (e.target.closest('[data-action="citizen-logout"]')) {
    await api('/api/session/logout', 'POST', {});
    state.citizenProfile = null;
    state.citizenAuthMode = 'login';
    state.path = '/home';
    location.hash = '#/home';
    document.querySelectorAll('.modal-backdrop').forEach(modal => modal.remove());
    render(true);
    toast('You are signed out.');
    return;
  }

  const verifyBtn = e.target.closest('#btn-verify-officer');
  if (verifyBtn) {
    verifyOfficerCredentials();
    return;
  }

  const go = e.target.closest('[data-go]');
  if (go) {
    document.querySelector('.modal-backdrop')?.remove();
    location.hash = go.dataset.go;
    return;
  }

  const f = e.target.closest('[data-filter]');
  if (f) {
    state.filter = f.dataset.filter;
    render(false);
    return;
  }

  const ta = e.target.closest('[data-token-action]');
  if (ta) {
    actionModal(ta.dataset.tokenAction, ta.dataset.id);
    return;
  }

  const confirm = e.target.closest('[data-confirm-action]');
  if (confirm) {
    const act = confirm.dataset.confirmAction;
    const id = confirm.dataset.id;
    const reason = $('#change-reason')?.value;
    if ((act === 'skip' || act === 'cancel' || act === 'reschedule') && !reason?.trim()) {
      toast('Add a reason before saving.', false);
      return;
    }
    const extra = act === 'reschedule' ? { slot: $('#new-slot').value, reason } : { reason };
    document.querySelector('.modal-backdrop')?.remove();
    await performTokenAction(act, id, extra);
    return;
  }

  const chip = e.target.closest('[data-chip-reason]');
  if (chip) {
    const r = chip.dataset.chipReason;
    const input = $('#change-reason');
    const sel = $('#skip-reason-select');
    if (input) input.value = r;
    if (sel) sel.value = r;
    document.querySelectorAll('.reason-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'done-to-waiting-hall') {
    document.querySelector('.modal-backdrop')?.remove();
    location.hash = '#/display';
    return;
  }

  if (action === 'toggle-sound') {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem('gq-sound', state.soundEnabled);
    if (state.soundEnabled) {
      playChime();
      toast('Audio chime & voice announcements enabled 🔊');
    } else {
      toast('Audio muted 🔇');
    }
    render(false);
  }
  if (action === 'sound-test') {
    playChime();
    speak('Audio announcements are enabled.');
    toast('Playing audio test chime...');
  }
  if (action === 'menu') {
    const side = $('#sidebar');
    if (window.matchMedia('(max-width: 760px)').matches) {
      state.sidebarCollapsed = false;
      side.classList.remove('collapsed');
      $('.main').classList.remove('sidebar-collapsed');
      side.classList.toggle('open');
      $('#overlay').classList.toggle('show', side.classList.contains('open'));
      btn.setAttribute('aria-expanded', String(side.classList.contains('open')));
    } else {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      side.classList.toggle('collapsed', state.sidebarCollapsed);
      $('.main').classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
      btn.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
    }
  }
  if (action === 'use-location') {
    if (state.userLocation) {
      state.userLocation = null;
      btn.textContent = 'Use my location for distances';
      renderOfficeRecommendations();
      return;
    }
    if (!navigator.geolocation) {
      toast('Location is not available in this browser.', false);
      return;
    }
    navigator.geolocation.getCurrentPosition(position => {
      state.userLocation = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      const locationButton = $('[data-action="use-location"]');
      if (locationButton) locationButton.textContent = 'Clear my location';
      renderOfficeRecommendations();
      toast('Office distances updated. Your location stays on this page.');
    }, () => {
      toast('Location was not available. Allow it in your browser to see distances.', false);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    return;
  }
  if (action === 'recommend-office') {
    const office = state.data.offices.find(item => item.id === btn.dataset.officeId);
    const select = $('#office-select');
    if (office && select) {
      select.value = office.id;
      renderOfficeRecommendations();
    }
    return;
  }
  if (action === 'role-menu') openRoleMenu();
  if (action === 'close-modal') btn.closest('.modal-backdrop')?.remove();
  if (action === 'qr') showQR(btn.dataset.id);
  if (action === 'toast') toast(btn.dataset.message);
  if (action === 'read-all') {
    await api('/api/notifications/read', 'POST', {});
    toast('All notifications marked as read.');
  }
  if (action === 'checkin') {
    document.querySelector('.modal-backdrop')?.remove();
    await performTokenAction('checkin', btn.dataset.id);
  }
});

document.addEventListener('change', e => {
  if (e.target.id === 'help-service-select') {
    state.helpServiceName = e.target.value;
    render(false);
  }
  if (e.target.id === 'doc-service') {
    state.docServiceId = e.target.value;
    render(false);
  }
  if (e.target.id === 'queue-filter') filterQueue();
  if (e.target.id === 'skip-reason-select') {
    const r = e.target.value;
    const input = $('#change-reason');
    if (input) {
      if (r.includes('custom')) {
        input.value = '';
        input.focus();
      } else {
        input.value = r;
      }
    }
    document.querySelectorAll('.reason-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.chipReason === r);
    });
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'queue-search') filterQueue();
  if (e.target.id === 'service-name') renderOfficeRecommendations();
  if (e.target.id === 'officer-pin') e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
});

document.addEventListener('click', e => {
  const office = e.target.closest('[data-office-details]');
  if (office) {
    openOfficeDetails(office.dataset.officeDetails);
    return;
  }
  const book = e.target.closest('[data-office-book]');
  if (book) {
    document.querySelector('.modal-backdrop')?.remove();
    location.hash = `/book?office=${encodeURIComponent(book.dataset.officeBook)}&service=${encodeURIComponent(book.dataset.serviceId)}`;
    return;
  }
});

document.addEventListener('change', e => {
  if (e.target.id === 'service-name') renderOfficeRecommendations();
  if (e.target.id === 'office-select') renderOfficeRecommendations();
  if (e.target.id === 'office-service') {
    const officeId = $('[data-office-book]')?.dataset.officeBook;
    if (officeId) {
      const button = $('[data-office-book]');
      button.dataset.serviceId = e.target.value;
      renderOfficeChecklist(officeId, e.target.value);
    }
    return;
  }
  if (e.target.matches('[data-doc-toggle]')) {
    const doc = e.target.dataset.docToggle;
    state.readyDocs = state.readyDocs.filter(d => d !== doc);
    if (e.target.checked) state.readyDocs.push(doc);
    localStorage.setItem('gq-ready-docs', JSON.stringify(state.readyDocs));
    const officeId = $('[data-office-book]')?.dataset.officeBook;
    if (officeId) renderOfficeChecklist(officeId, $('#office-service').value);
    else render(false);
  }
});

document.addEventListener('submit', async e => {
  if (e.target.id === 'citizen-auth-form') {
    e.preventDefault();
    const form = e.target;
    const mode = form.dataset.mode;
    const input = {
      email: $('#citizen-account-email')?.value.trim(),
      password: $('#citizen-account-password')?.value,
      ...(mode === 'signup' ? { name: $('#citizen-account-name')?.value.trim() } : {})
    };
    const errorEl = $('#citizen-auth-error');
    const submitButton = form.querySelector('button[type="submit"]');
    if (errorEl) errorEl.style.display = 'none';
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Please wait…';
    }
    try {
      const session = await api(`/api/citizens/${mode}`, 'POST', input);
      state.role = 'citizen';
      state.officerName = '';
      state.citizenProfile = { id: session.id, name: session.name, email: session.email };
      state.citizenAuthMode = 'login';
      state.path = '/home';
      location.hash = '#/home';
      document.querySelectorAll('.modal-backdrop').forEach(modal => modal.remove());
      render(true);
      toast(mode === 'signup' && session.created ? `Account created. Welcome, ${session.name}.` : `Sign-in successful. Welcome, ${session.name}.`);
    } catch (error) {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = mode === 'signup' ? 'Create account →' : 'Sign in →';
      }
      if (errorEl) {
        errorEl.textContent = error.message;
        errorEl.style.display = 'block';
      }
    }
    return;
  }
  if (e.target.id !== 'booking-form') return;
  e.preventDefault();
  const input = {
    service: $('#service-name').value.trim(),
    officeId: $('#office-select').value,
    citizen: $('#citizen-name').value,
    slot: $('#booking-slot').value,
    date: $('#booking-date').value
  };
  if (!input.service || !input.officeId) {
    toast('Enter what you need and choose an office.', false);
    return;
  }
  try {
    const token = await api('/api/tokens', 'POST', input);
    const myTokens = JSON.parse(localStorage.getItem('gq-my-tokens') || '[]');
    myTokens.unshift(token.id);
    localStorage.setItem('gq-my-tokens', JSON.stringify(myTokens));
    state.data.tokens.unshift(token);
    syncAcrossTabs(state.data, 'book', token);
    openModal(
      'Tap Token request ready',
      `
        <div class="token-confirm">
          <div class="token-label">YOUR TAP TOKEN</div>
          <div class="token-number">${esc(token.number)}</div>
          <div>${esc(token.service)} · ${esc(token.slot)}</div>
          <div class="qr"><span>▦</span></div>
          <div style="font-size:11px;color:#cce1e1">${esc(token.office)}</div>
        </div>
        <p class="subheading" style="text-align:center;margin-top:14px">Your request is saved in Tap Token. Confirm service availability with the office before you travel.</p>
        <div class="modal-actions">
          <button class="btn primary" data-action="done-to-waiting-hall">Done</button>
        </div>
      `
    );
    toast(`${token.number} request is ready.`);
  } catch (err) {
    toast(err.message, false);
  }
});

window.addEventListener('hashchange', () => {
  state.path = location.hash.slice(1).split('?')[0] || '/home';
  render(true);
  window.scrollTo(0, 0);
});

async function verifyOfficerCredentials() {
  const nameInput = $('#officer-name')?.value.trim();
  const pinInput = $('#officer-pin')?.value.trim();
  const errorMsg = $('#pin-error-msg');
  const nameEl = $('#officer-name');
  const pinEl = $('#officer-pin');

  if (nameEl) nameEl.classList.remove('error');
  if (pinEl) pinEl.classList.remove('error');

  if (!nameInput) {
    if (errorMsg) {
      errorMsg.style.display = 'block';
      errorMsg.textContent = 'Please enter an authorized officer name.';
    }
    if (nameEl) {
      nameEl.classList.add('error');
      nameEl.focus();
    }
    return;
  }

  if (!/^\d{6}$/.test(pinInput)) {
    if (errorMsg) {
      errorMsg.style.display = 'block';
      errorMsg.textContent = 'Enter all 6 digits of your PIN.';
    }
    if (pinEl) {
      pinEl.classList.add('error');
      pinEl.focus();
    }
    return;
  }

  try {
    const session = await api('/api/session', 'POST', { username: nameInput, pin: pinInput });
    state.role = session.role;
    state.officerName = session.name;
    document.querySelector('.modal-backdrop')?.remove();
    playChime();
    toast(`✓ Verified: Welcome ${session.name}`);
    location.hash = session.role === 'admin' ? '#/admin' : '#/staff';
    render(true);
  } catch (err) {
    if (errorMsg) {
      errorMsg.style.display = 'block';
      errorMsg.textContent = err.message;
    }
    if (nameEl) nameEl.classList.add('error');
    if (pinEl) {
      pinEl.classList.add('error');
      pinEl.focus();
      pinEl.select();
    }
    toast(err.message, false);
  }
}

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelector('.modal-backdrop')?.remove();
  if (e.key === 'Enter' && (e.target.id === 'officer-pin' || e.target.id === 'officer-name')) {
    verifyOfficerCredentials();
  }
});

// Initialization
loadData();
initSSE();

// Live countdown timers (1 sec tick) and board clock
setInterval(() => {
  if (!state.data) return;

  // Update countdown timers on any active token card
  document.querySelectorAll('.eta-countdown[data-id]').forEach(el => {
    const token = state.data.tokens.find(t => t.id === el.dataset.id);
    if (token) el.textContent = countdown(token);
  });

  // Update lobby display clock if open
  const boardClock = $('#live-board-clock');
  if (boardClock) {
    boardClock.textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}, 1000);

// Polling fallback every 30s just in case SSE drops
setInterval(() => {
  if (document.visibilityState === 'visible') {
    fetch('/api/data')
      .then(r => r.json())
      .then(data => {
        state.data = data;
        checkForAnnouncements(state.data.tokens);
        render(false);
      })
      .catch(() => {});
  }
}, 30000);
