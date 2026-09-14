// SONIQ — Search screen logic
// Written in ES5 style (var, explicit classList add/remove, no fetch,
// no optional chaining) for Phoenix/Acode WebView compatibility.

(function () {

  var MUSIC_DATA = [
    { type: 'Song', title: 'Midnight Echoes', sub: 'Nova Ray' },
    { type: 'Song', title: 'Solar Drift', sub: 'Kalene' },
    { type: 'Song', title: 'Glass Horizon', sub: 'Reyes & Wolfe' },
    { type: 'Song', title: 'Slow Static', sub: 'Marlowe' },
    { type: 'Song', title: 'Paper Moonlight', sub: 'Odalys' },
    { type: 'Song', title: 'Velvet Hour', sub: 'Nova Ray' },
    { type: 'Song', title: 'Amber Room', sub: 'Reyes & Wolfe' },
    { type: 'Artist', title: 'Nova Ray', sub: '1.2M monthly listeners' },
    { type: 'Artist', title: 'Kalene', sub: '840K monthly listeners' },
    { type: 'Artist', title: 'Marlowe', sub: '512K monthly listeners' },
    { type: 'Artist', title: 'Odalys', sub: '2.3M monthly listeners' },
    { type: 'Playlist', title: 'Discover Weekly', sub: 'By Soniq \u2022 40 songs' },
    { type: 'Playlist', title: 'Late Night Focus', sub: 'By Soniq \u2022 32 songs' },
    { type: 'Playlist', title: 'Midnight Drive', sub: 'By Soniq \u2022 25 songs' },
    { type: 'Playlist', title: 'Slow Sundays', sub: 'By Soniq \u2022 18 songs' },
    { type: 'Playlist', title: 'Rainy Day Reverb', sub: 'By Soniq \u2022 21 songs' }
  ];

  var TRENDING = ['Midnight Echoes', 'Nova Ray', 'Late Night Focus', 'Solar Drift', 'Discover Weekly'];
  var RECENT_LIMIT = 6;
  var debounceTimer = null;

  function qs(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function hasClass(el, cls) {
    return el.className.indexOf(cls) !== -1;
  }

  function closestByClass(el, cls) {
    var node = el;
    while (node && node !== document.body) {
      if (node.className && typeof node.className === 'string' && hasClass(node, cls)) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  /* ---------- Firebase (compat SDK, global-script style — see index.html) ----------
     initializeApp() runs once, guarded, since a blocked/offline CDN load
     (gstatic unreachable, e.g. no network at all) would otherwise throw
     and take the rest of script.js down with it. fbAuth/fbDb stay null
     in that case and every helper below just no-ops back to local-only
     behavior, which is exactly how the app already worked before today.
  */
  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBTSpvyeLHY59auyLHZS78YcFLZmPaNCjQ',
    authDomain: 'soniq-1.firebaseapp.com',
    projectId: 'soniq-1',
    storageBucket: 'soniq-1.firebasestorage.app',
    messagingSenderId: '266464393949',
    appId: '1:266464393949:web:c090ae41a5c1835a20f934'
  };

  var fbAuth = null;
  var fbDb = null;

  function initFirebase() {
    try {
      if (typeof firebase === 'undefined') { return; }
      firebase.initializeApp(FIREBASE_CONFIG);
      fbAuth = firebase.auth();
      fbDb = firebase.firestore();
    } catch (e) {
      // SDK failed to load/init (offline, blocked CDN, etc.) — app keeps
      // working local-only, same as it did before Firebase existed.
      fbAuth = null;
      fbDb = null;
    }
  }

  function isSignedIn() {
    return !!(fbAuth && fbAuth.currentUser);
  }

  /* Every preference setter below queues a debounced merge-write of just
     its own field — a slider being dragged fires many times a second,
     so each field gets its own timer and only the last value in a burst
     actually reaches Firestore. Silently a no-op while signed out. */
  var CLOUD_SYNC_DEBOUNCE_MS = 800;
  var cloudSyncTimers = {};

  function queueCloudSync(field, value) {
    if (!isSignedIn()) { return; }
    if (cloudSyncTimers[field]) { clearTimeout(cloudSyncTimers[field]); }
    cloudSyncTimers[field] = setTimeout(function () {
      var uid = fbAuth.currentUser.uid;
      var data = {};
      data[field] = value;
      fbDb.collection('users').doc(uid).set(data, { merge: true }).catch(function () {
        // offline or rules-rejected — local copy already saved, fail silently
      });
    }, CLOUD_SYNC_DEBOUNCE_MS);
  }

  /* ---------- Recent searches (in-memory only — see note above initFirebase) ---------- */

  var memRecentSearches = [];

  function getRecent() {
    return memRecentSearches;
  }

  function saveRecent(list) {
    memRecentSearches = list;
  }

  function addRecent(query) {
    query = query.trim();
    if (query.length === 0) { return; }
    var list = getRecent();
    var filtered = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].toLowerCase() !== query.toLowerCase()) {
        filtered.push(list[i]);
      }
    }
    filtered.unshift(query);
    if (filtered.length > RECENT_LIMIT) {
      filtered = filtered.slice(0, RECENT_LIMIT);
    }
    saveRecent(filtered);
    renderRecent();
  }

  function removeRecent(query) {
    var list = getRecent();
    var filtered = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] !== query) { filtered.push(list[i]); }
    }
    saveRecent(filtered);
    renderRecent();
  }

  function clearRecent() {
    saveRecent([]);
    renderRecent();
  }

  function renderRecent() {
    var list = getRecent();
    var block = qs('recent-block');
    var box = qs('recent-chips');
    if (list.length === 0) {
      block.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    block.classList.remove('hidden');
    var html = '';
    for (var i = 0; i < list.length; i++) {
      html += '<div class="chip recent-chip" data-query="' + escapeHtml(list[i]) + '">' +
        '<span class="chip-text">' + escapeHtml(list[i]) + '</span>' +
        '<i class="fas fa-xmark chip-remove"></i></div>';
    }
    box.innerHTML = html;
  }

  function renderTrending() {
    var box = qs('trending-chips');
    var html = '';
    for (var i = 0; i < TRENDING.length; i++) {
      html += '<div class="chip trending-chip" data-query="' + escapeHtml(TRENDING[i]) + '">' +
        '<i class="fas fa-fire"></i><span class="chip-text">' + escapeHtml(TRENDING[i]) + '</span></div>';
    }
    box.innerHTML = html;
  }

  /* ---------- Home screen filter pills ----------
     Single-select segmented control. There's no differentiated content
     behind each filter yet — that's a separate, bigger gap — but this
     makes the tap register and the selection actually switch, instead
     of "All" being permanently stuck active while the other three sit
     there doing nothing. */
  function initHomeFilterPills() {
    var pills = document.querySelectorAll('.pill-row .pill');
    for (var i = 0; i < pills.length; i++) {
      pills[i].addEventListener('click', function (e) {
        for (var j = 0; j < pills.length; j++) {
          pills[j].classList.remove('active');
        }
        e.target.classList.add('active');
        hapticPulse();
      });
    }
  }

  /* ---------- App theme (Account screen) ----------
     Now a real, working swap — sets data-theme on <body>, and the CSS
     [data-theme="..."] blocks override the :root custom properties that
     the app's chrome (backgrounds, nav, cards, text, accent) reads from.
  */

  var THEME_KEY = 'soniq_theme_pref';

  function getThemePref() {
    try {
      return localStorage.getItem(THEME_KEY) || 'light';
    } catch (e) {
      return 'light';
    }
  }

  function saveThemePref(value) {
    try {
      localStorage.setItem(THEME_KEY, value);
    } catch (e) {
      // storage unavailable — selection just won't persist
    }
    queueCloudSync('theme', value);
  }

  function themeLabelFor(key) {
    if (key === 'oled-dark') { return 'OLED Dark'; }
    if (key === 'soniq-orange') { return 'SONIQ Orange'; }
    if (key === 'high-contrast') { return 'High Contrast'; }
    return 'Soft Neumorphic Light';
  }

  function applyTheme(key) {
    if (key === 'light') {
      document.body.removeAttribute('data-theme');
    } else {
      document.body.setAttribute('data-theme', key);
    }
  }

  function initThemeToggles() {
    var pref = getThemePref();
    applyTheme(pref);
    var toggles = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].checked = (toggles[i].getAttribute('data-theme') === pref);
    }
    var valueEl = qs('theme-current-value');
    if (valueEl) { valueEl.textContent = themeLabelFor(pref); }
  }

  function handleThemeToggleChange(e) {
    var el = e.target;
    if (!el.checked) {
      // theme selection can't be empty — snap the active one back on
      el.checked = true;
      return;
    }
    var toggles = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < toggles.length; i++) {
      if (toggles[i] !== el) { toggles[i].checked = false; }
    }
    var key = el.getAttribute('data-theme');
    saveThemePref(key);
    applyTheme(key);
    hapticPulse();
    var valueEl = qs('theme-current-value');
    if (valueEl) { valueEl.textContent = themeLabelFor(key); }
  }

  /* ---------- Playback & Accessibility preferences ----------
     In-memory only (session-scoped) — each independent (unlike the
     theme radio-group). Every getter has a safe default. Firestore is
     now the only durable store; signed-out sessions just start fresh.
  */
  var PREF_KEYS = {
    crossfadeEnabled: 'crossfadeEnabled',
    normalize: 'normalizeVolume',
    autoplay: 'autoplaySimilar',
    reduceMotion: 'reduceMotion',
    haptics: 'haptics'
  };

  var memBoolPrefs = {};

  function getBoolPref(key, fallback) {
    if (!(key in memBoolPrefs)) { return fallback; }
    return memBoolPrefs[key];
  }

  function saveBoolPref(key, value) {
    memBoolPrefs[key] = !!value;
  }

  function getCrossfadeEnabled() { return getBoolPref(PREF_KEYS.crossfadeEnabled, false); }
  function saveCrossfadeEnabled(v) { saveBoolPref(PREF_KEYS.crossfadeEnabled, v); queueCloudSync('crossfadeEnabled', v); }

  var memCrossfadeDuration = null;

  function getCrossfadeDuration() {
    return memCrossfadeDuration === null ? 3 : memCrossfadeDuration;
  }
  function saveCrossfadeDuration(seconds) {
    memCrossfadeDuration = seconds;
    queueCloudSync('crossfadeDuration', seconds);
  }

  function getNormalizeEnabled() { return getBoolPref(PREF_KEYS.normalize, false); }
  function saveNormalizeEnabled(v) { saveBoolPref(PREF_KEYS.normalize, v); queueCloudSync('normalizeVolume', v); }

  function getAutoplayEnabled() { return getBoolPref(PREF_KEYS.autoplay, true); }
  function saveAutoplayEnabled(v) { saveBoolPref(PREF_KEYS.autoplay, v); queueCloudSync('autoplaySimilar', v); }

  function getReduceMotionEnabled() { return getBoolPref(PREF_KEYS.reduceMotion, false); }
  function saveReduceMotionEnabled(v) { saveBoolPref(PREF_KEYS.reduceMotion, v); queueCloudSync('reduceMotion', v); }

  function getHapticsEnabled() { return getBoolPref(PREF_KEYS.haptics, false); }
  function saveHapticsEnabled(v) { saveBoolPref(PREF_KEYS.haptics, v); queueCloudSync('haptics', v); }

  function applyReduceMotion(on) {
    if (on) {
      document.body.classList.add('reduce-motion');
    } else {
      document.body.classList.remove('reduce-motion');
    }
  }

  /* Feature-detected — navigator.vibrate isn't guaranteed inside every
     WebView wrapper (Acode's in-app browser in particular is unlikely to
     support it), so this silently no-ops rather than erroring. */
  function hapticPulse() {
    if (!getHapticsEnabled()) { return; }
    if (navigator.vibrate) {
      try { navigator.vibrate(12); } catch (e) {}
    }
  }

  function crossfadeValueLabel(enabled, duration) {
    return enabled ? (duration + 's') : 'Off';
  }

  function initPreferenceToggles() {
    var crossfadeOn = getCrossfadeEnabled();
    var crossfadeDuration = getCrossfadeDuration();
    qs('pref-crossfade-enabled').checked = crossfadeOn;
    qs('crossfade-duration-slider').value = crossfadeDuration;
    qs('crossfade-duration-slider').disabled = !crossfadeOn;
    qs('crossfade-duration-value').textContent = crossfadeDuration + 's';
    qs('crossfade-current-value').textContent = crossfadeValueLabel(crossfadeOn, crossfadeDuration);

    qs('pref-normalize-volume').checked = getNormalizeEnabled();
    qs('pref-autoplay').checked = getAutoplayEnabled();

    var reduceMotionOn = getReduceMotionEnabled();
    qs('pref-reduce-motion').checked = reduceMotionOn;
    applyReduceMotion(reduceMotionOn);

    qs('pref-haptics').checked = getHapticsEnabled();
  }

  /* ---------- Profile: name ----------
     In-memory only. Updates both places the name shows — the Account
     page and the Sonic ID card on the EQ screen — plus the Home
     greeting. Firestore (once signed in) is what actually persists it
     across sessions now. */
  var memDisplayName = null;

  function getDisplayName() {
    return memDisplayName || 'User';
  }

  function saveDisplayName(name) {
    memDisplayName = name;
    queueCloudSync('displayName', name);
  }

  function applyDisplayName(name) {
    qs('account-name-display').textContent = name;
    qs('sonic-id-name').textContent = name;
    var homeGreeting = qs('home-greeting');
    if (homeGreeting) { homeGreeting.textContent = 'Hi ' + name; }
  }

  function enterNameEditMode() {
    qs('account-name-input').value = getDisplayName();
    qs('account-name-display-row').style.display = 'none';
    qs('account-name-edit-row').classList.add('shown');
    qs('account-name-input').focus();
  }

  function exitNameEditMode() {
    qs('account-name-display-row').style.display = 'flex';
    qs('account-name-edit-row').classList.remove('shown');
  }

  function saveNameFromInput() {
    var raw = qs('account-name-input').value.replace(/^\s+|\s+$/g, '');
    var name = raw.length > 0 ? raw : 'User';
    saveDisplayName(name);
    applyDisplayName(name);
    exitNameEditMode();
  }

  /* ---------- Profile: avatar picture ----------
     A picked image is drawn to an offscreen canvas (center-cropped to a
     square, exported as a compressed JPEG data URL), then the base64
     payload is uploaded to ImgBB — no local file/blob involved, so this
     works the same in the WebView as it does in a normal browser. The
     hosted URL ImgBB hands back is what actually gets saved (session +
     Firestore); nothing image-sized ever touches localStorage. */
  var AVATAR_SIZE = 200;
  var IMGBB_API_KEY = '1818099fc1153750c4725c9009e29e2b';
  var IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';

  var memAvatarUrl = '';

  function getAvatarUrl() {
    return memAvatarUrl;
  }

  function saveAvatarUrl(url) {
    memAvatarUrl = url || '';
    queueCloudSync('avatarUrl', memAvatarUrl);
  }

  function applyAvatarUrl(url) {
    var hasUrl = !!url;

    qs('account-avatar-icon').style.display = hasUrl ? 'none' : '';
    qs('account-avatar-img').style.display = hasUrl ? 'block' : 'none';
    if (hasUrl) { qs('account-avatar-img').src = url; }

    qs('sonic-id-avatar-icon').style.display = hasUrl ? 'none' : '';
    qs('sonic-id-avatar-img').style.display = hasUrl ? 'block' : 'none';
    if (hasUrl) { qs('sonic-id-avatar-img').src = url; }

    qs('home-avatar-icon').style.display = hasUrl ? 'none' : '';
    qs('home-avatar-img').style.display = hasUrl ? 'block' : 'none';
    if (hasUrl) { qs('home-avatar-img').src = url; }
  }

  function setAvatarUploadStatus(text) {
    var el = qs('avatar-upload-status');
    if (!text) {
      el.textContent = '';
      el.classList.add('hidden');
    } else {
      el.textContent = text;
      el.classList.remove('hidden');
    }
  }

  /* XMLHttpRequest, not fetch() — fetch() fails silently in this WebView.
     FormData works fine over XHR; ImgBB accepts the base64 payload as a
     plain 'image' field, so no real file/Blob has to survive the trip. */
  function uploadAvatarToImgbb(base64Payload, onDone) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', IMGBB_UPLOAD_URL + '?key=' + IMGBB_API_KEY, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      if (xhr.status >= 200 && xhr.status < 300) {
        var res = null;
        try {
          res = JSON.parse(xhr.responseText);
        } catch (e) {
          onDone(new Error('bad response'), null);
          return;
        }
        if (res && res.success && res.data && res.data.url) {
          onDone(null, res.data.url);
        } else {
          onDone(new Error('upload rejected'), null);
        }
      } else {
        onDone(new Error('upload failed'), null);
      }
    };
    xhr.onerror = function () {
      onDone(new Error('network error'), null);
    };
    var form = new FormData();
    form.append('image', base64Payload);
    xhr.send(form);
  }

  function processAvatarFile(file) {
    var reader = new FileReader();
    reader.onload = function (loadEvent) {
      var img = new Image();
      img.onload = function () {
        var srcSize = Math.min(img.width, img.height);
        var sx = (img.width - srcSize) / 2;
        var sy = (img.height - srcSize) / 2;
        var canvas = document.createElement('canvas');
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        var base64Payload = dataUrl.split(',')[1];

        setAvatarUploadStatus('Uploading...');
        uploadAvatarToImgbb(base64Payload, function (err, url) {
          if (err) {
            setAvatarUploadStatus("Couldn't upload \u2014 try again.");
            return;
          }
          setAvatarUploadStatus(null);
          saveAvatarUrl(url);
          applyAvatarUrl(url);
        });
      };
      img.src = loadEvent.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* ---------- Music Preference (genres) ----------
     A real preference with a real effect: matching Library tracks are
     moved to the top. Only reorders the DOM — TRACKS itself and every
     data-index never move, so playback lookups stay correct regardless
     of visual order. */
  var memGenrePrefs = null;

  function getGenrePrefs() {
    return memGenrePrefs || [];
  }

  function saveGenrePrefs(list) {
    memGenrePrefs = list;
    queueCloudSync('genrePrefs', list);
  }

  function genrePrefsLabel(list) {
    if (list.length === 0) { return 'Not set'; }
    if (list.length <= 2) { return list.join(', '); }
    return list.length + ' genres selected';
  }

  function reorderLibraryByGenrePref() {
    var container = qs('library-cards');
    var prefs = getGenrePrefs();
    if (prefs.length === 0) { return; }

    var cards = Array.prototype.slice.call(container.querySelectorAll('.lib-card'));
    cards.sort(function (a, b) {
      var aMatch = prefs.indexOf(a.getAttribute('data-genre')) !== -1 ? 0 : 1;
      var bMatch = prefs.indexOf(b.getAttribute('data-genre')) !== -1 ? 0 : 1;
      return aMatch - bMatch;
    });

    for (var i = 0; i < cards.length; i++) {
      container.appendChild(cards[i]);
    }
  }

  function toggleGenreChip(chip) {
    var genre = chip.getAttribute('data-genre');
    var prefs = getGenrePrefs();
    var idx = prefs.indexOf(genre);

    if (hasClass(chip, 'active')) {
      chip.classList.remove('active');
      if (idx !== -1) { prefs.splice(idx, 1); }
    } else {
      chip.classList.add('active');
      if (idx === -1) { prefs.push(genre); }
    }

    saveGenrePrefs(prefs);
    qs('genre-current-value').textContent = genrePrefsLabel(prefs);
    reorderLibraryByGenrePref();
  }

  function initAccountProfile() {
    applyDisplayName(getDisplayName());
    applyAvatarUrl(getAvatarUrl());

    var prefs = getGenrePrefs();
    qs('genre-current-value').textContent = genrePrefsLabel(prefs);
    var chips = document.querySelectorAll('.genre-chip');
    for (var i = 0; i < chips.length; i++) {
      if (prefs.indexOf(chips[i].getAttribute('data-genre')) !== -1) {
        chips[i].classList.add('active');
      }
    }
    reorderLibraryByGenrePref();
  }

  /* ---------- Equalizer ----------
     Real Web Audio API routing:
     audioEl -> 5 chained BiquadFilterNodes -> compressor -> masterGain
     -> destination. createMediaElementSource() can only ever be called
     ONCE per <audio> element, hence the audioCtx null-guard — this is
     built lazily on first real playback (or first slider touch), since
     AudioContext needs a user gesture to start in most browsers anyway.

     The compressor node is always in the chain but sits at neutral
     (threshold 0dB, ratio 1:1 — effectively a pass-through) unless
     Normalize Volume is on. masterGain stays at 1 during normal
     playback and is only ever animated during a Crossfade transition.

     Important: this only affects imported audio. The 3 demo tracks are
     a simulated progress timer with no real sound running through
     audioEl at all, so there's nothing for the EQ/compressor to touch.
  */
  function ensureAudioGraph() {
    if (audioCtx) { return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { return; }
    audioCtx = new AC();
    var source = audioCtx.createMediaElementSource(audioEl);

    var bands = [
      { freq: 60, type: 'lowshelf' },
      { freq: 250, type: 'peaking' },
      { freq: 1000, type: 'peaking' },
      { freq: 4000, type: 'peaking' },
      { freq: 12000, type: 'highshelf' }
    ];

    var node = source;
    eqFilters = [];
    for (var i = 0; i < bands.length; i++) {
      var filter = audioCtx.createBiquadFilter();
      filter.type = bands[i].type;
      filter.frequency.value = bands[i].freq;
      if (bands[i].type === 'peaking') { filter.Q.value = 1; }
      filter.gain.value = eqGains[i];
      node.connect(filter);
      node = filter;
      eqFilters.push(filter);
    }

    compressorNode = audioCtx.createDynamicsCompressor();
    applyNormalizePref();
    node.connect(compressorNode);

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1;
    compressorNode.connect(masterGain);

    masterGain.connect(audioCtx.destination);
  }

  function applyNormalizePref() {
    if (!compressorNode) { return; }
    if (getNormalizeEnabled()) {
      compressorNode.threshold.value = -24;
      compressorNode.knee.value = 6;
      compressorNode.ratio.value = 4;
      compressorNode.attack.value = 0.003;
      compressorNode.release.value = 0.25;
    } else {
      compressorNode.threshold.value = 0;
      compressorNode.knee.value = 0;
      compressorNode.ratio.value = 1;
    }
  }

  function setEqGain(bandIndex, gainValue) {
    eqGains[bandIndex] = gainValue;
    if (eqFilters[bandIndex]) {
      eqFilters[bandIndex].gain.value = gainValue;
    }
    queueCloudSync('eqGains', eqGains);
  }

  function renderEqSliders() {
    var bands = document.querySelectorAll('.eq-band');
    for (var i = 0; i < bands.length; i++) {
      var slider = bands[i].querySelector('.eq-slider');
      var valueLabel = bands[i].querySelector('.eq-band-value');
      slider.value = eqGains[i];
      valueLabel.textContent = eqGains[i] + 'dB';
    }
  }

  function applyEqPreset(name) {
    var values = EQ_PRESETS[name];
    if (!values) { return; }
    hapticPulse();
    for (var i = 0; i < values.length; i++) {
      setEqGain(i, values[i]);
    }
    renderEqSliders();

    var presetBtns = document.querySelectorAll('.eq-preset-btn');
    for (var p = 0; p < presetBtns.length; p++) {
      if (presetBtns[p].getAttribute('data-preset') === name) {
        presetBtns[p].classList.add('active');
      } else {
        presetBtns[p].classList.remove('active');
      }
    }
  }

  function clearEqPresetHighlight() {
    var presetBtns = document.querySelectorAll('.eq-preset-btn');
    for (var p = 0; p < presetBtns.length; p++) {
      presetBtns[p].classList.remove('active');
    }
  }

  /* ---------- Search / autocomplete ---------- */

  function highlight(text, query) {
    var idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) { return escapeHtml(text); }
    var before = escapeHtml(text.slice(0, idx));
    var match = escapeHtml(text.slice(idx, idx + query.length));
    var after = escapeHtml(text.slice(idx + query.length));
    return before + '<span class="hl">' + match + '</span>' + after;
  }

  function iconFor(type) {
    if (type === 'Artist') { return 'fa-user'; }
    if (type === 'Playlist') { return 'fa-list'; }
    return 'fa-music';
  }

  function showDefault() {
    qs('search-default').classList.remove('hidden');
    var results = qs('search-results');
    results.classList.add('hidden');
    results.innerHTML = '';
  }

  function showResults(matches, query) {
    qs('search-default').classList.add('hidden');
    var box = qs('search-results');
    box.classList.remove('hidden');

    if (matches.length === 0) {
      box.innerHTML = '<p class="no-results">No matches for &quot;' + escapeHtml(query) + '&quot;</p>';
      return;
    }

    var groups = { Song: [], Artist: [], Playlist: [] };
    for (var i = 0; i < matches.length; i++) {
      groups[matches[i].type].push(matches[i]);
    }

    var order = ['Song', 'Artist', 'Playlist'];
    var html = '';
    for (var g = 0; g < order.length; g++) {
      var key = order[g];
      var arr = groups[key];
      if (arr.length === 0) { continue; }
      html += '<p class="result-group-label">' + key + 's</p>';
      for (var j = 0; j < arr.length; j++) {
        var item = arr[j];
        html += '<div class="result-row" data-query="' + escapeHtml(item.title) + '">' +
          '<div class="result-icon"><i class="fas ' + iconFor(item.type) + '"></i></div>' +
          '<div class="result-text">' +
          '<p class="result-title">' + highlight(item.title, query) + '</p>' +
          '<span class="result-sub">' + item.type + ' \u2022 ' + escapeHtml(item.sub) + '</span>' +
          '</div>' +
          '<i class="fas fa-arrow-up result-fill"></i></div>';
      }
    }
    box.innerHTML = html;
  }

  function runSearch(query) {
    query = query.trim();
    if (query.length === 0) {
      showDefault();
      return;
    }
    var q = query.toLowerCase();
    var matches = [];
    for (var i = 0; i < MUSIC_DATA.length; i++) {
      if (MUSIC_DATA[i].title.toLowerCase().indexOf(q) !== -1) {
        matches.push(MUSIC_DATA[i]);
      }
    }
    showResults(matches, query);
  }

  /* ---------- Screen router (Home / Search / Library) ---------- */

  var SCREENS = ['home', 'search', 'library', 'account', 'eq', 'auth'];

  var currentScreenName = 'home';

  function showScreen(name) {
    currentScreenName = name;

    for (var i = 0; i < SCREENS.length; i++) {
      var s = SCREENS[i];
      var el = qs('screen-' + s);
      if (s === name) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
      var navEl = qs('nav-' + s);
      if (navEl) {
        if (s === name) {
          navEl.classList.add('active');
        } else {
          navEl.classList.remove('active');
        }
      }
    }

    var bottomNav = document.querySelector('.bottom-nav');
    if (bottomNav) {
      if (name === 'search' || name === 'eq' || name === 'auth') {
        bottomNav.classList.add('nav-hidden');
      } else {
        bottomNav.classList.remove('nav-hidden');
      }
    }

    if (name === 'search') {
      setTimeout(function () {
        qs('search-input').focus();
      }, 220);
    } else {
      // leaving search — reset it so it's fresh next time it's opened
      var input = qs('search-input');
      input.value = '';
      qs('search-clear').classList.remove('shown');
      showDefault();
    }

    syncMiniPlayerVisibility();
  }

  /* ---------- Now Playing (player sheet) ---------- */

  var TRACKS = [
    {
      title: 'Midnight Echoes',
      artist: 'Nova Ray',
      art: 'https://images.pexels.com/photos/9401734/pexels-photo-9401734.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=600&w=600',
      duration: 204,
      isLocal: false,
      genre: 'Electronic'
    },
    {
      title: 'Solar Drift',
      artist: 'Kalene',
      art: 'https://images.pexels.com/photos/12858796/pexels-photo-12858796.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=600&w=600',
      duration: 187,
      isLocal: false,
      genre: 'Afrobeats'
    },
    {
      title: 'Glass Horizon',
      artist: 'Reyes & Wolfe',
      art: 'https://images.pexels.com/photos/20131950/pexels-photo-20131950.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=600&w=600',
      duration: 231,
      isLocal: false,
      genre: 'R&B'
    }
  ];

  var currentTrackIndex = 0;
  var isPlaying = false;
  var progressSeconds = 0;
  var progressTimer = null;
  var audioEl = null;

  /* ---------- Equalizer state ----------
     eqGains holds the desired dB values even before the Web Audio graph
     exists (e.g. if someone drags a slider before any track has played),
     so nothing is lost — ensureAudioGraph() applies them the moment it runs.
  */
  var audioCtx = null;
  var eqFilters = [];
  var compressorNode = null;
  var masterGain = null;
  var eqGains = [0, 0, 0, 0, 0];
  var EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0],
    bass: [7, 4, 0, -1, -1],
    vocal: [-2, 1, 4, 3, 0]
  };

  function formatTime(sec) {
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    var sStr = s < 10 ? '0' + s : String(s);
    return m + ':' + sStr;
  }

  function updateProgressUI() {
    var t = TRACKS[currentTrackIndex];
    var pct = (progressSeconds / t.duration) * 100;
    if (pct > 100) { pct = 100; }
    qs('player-fill').style.width = pct + '%';
    qs('player-thumb').style.left = pct + '%';
    qs('player-elapsed').textContent = formatTime(progressSeconds);
  }

  function updatePlayPauseIcons() {
    if (isPlaying) {
      qs('player-playpause').innerHTML = '<i class="fas fa-pause"></i>';
      qs('mini-playpause').innerHTML = '<i class="hgi hgi-stroke hgi-rounded hgi-pause"></i>';
    } else {
      qs('player-playpause').innerHTML = '<i class="fas fa-play"></i>';
      qs('mini-playpause').innerHTML = '<i class="hgi hgi-stroke hgi-rounded hgi-play"></i>';
    }
    var wave = qs('sonic-wave');
    if (wave) {
      if (isPlaying) {
        wave.classList.add('active');
      } else {
        wave.classList.remove('active');
      }
    }
  }

  function setLikedState(liked) {
    var playerLike = qs('player-like');
    var miniLike = qs('mini-like');
    if (liked) {
      playerLike.classList.add('liked');
      playerLike.classList.remove('far');
      playerLike.classList.add('fas');
      if (miniLike) { miniLike.classList.add('liked'); }
    } else {
      playerLike.classList.remove('liked');
      playerLike.classList.remove('fas');
      playerLike.classList.add('far');
      if (miniLike) { miniLike.classList.remove('liked'); }
    }
  }

  function pauseTrack() {
    isPlaying = false;
    updatePlayPauseIcons();
    var t = TRACKS[currentTrackIndex];
    if (t && t.isLocal) {
      audioEl.pause();
    } else {
      clearInterval(progressTimer);
    }
  }

  function playTrack() {
    isPlaying = true;
    updatePlayPauseIcons();
    var t = TRACKS[currentTrackIndex];
    if (t.isLocal) {
      clearInterval(progressTimer);
      ensureAudioGraph();
      audioEl.play();
    } else {
      clearInterval(progressTimer);
      progressTimer = setInterval(function () {
        var tt = TRACKS[currentTrackIndex];
        progressSeconds = progressSeconds + 1;
        if (progressSeconds >= tt.duration) {
          goNext();
          return;
        }
        updateProgressUI();
      }, 1000);
    }
  }

  function togglePlay() {
    hapticPulse();
    if (isPlaying) {
      pauseTrack();
    } else {
      playTrack();
    }
  }

  function loadTrack(index, autoplay) {
    currentTrackIndex = index;
    var t = TRACKS[index];
    qs('player-title').textContent = t.title;
    qs('player-artist').textContent = t.artist;

    // Safety reset — a track load should always start audible. Only a
    // live crossfade explicitly re-fades this right after this function
    // returns; every other path (Library tap, plain skip, etc.) needs
    // this or a track loaded mid-fade could otherwise stay silent.
    if (masterGain) {
      masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
      masterGain.gain.setValueAtTime(1, audioCtx.currentTime);
    }

    var artEl = qs('player-art');
    var glowEl = qs('player-glow');
    var miniArtEl = qs('mini-art');
    progressSeconds = 0;

    if (t.art) {
      artEl.classList.remove('local-placeholder');
      artEl.innerHTML = '';
      artEl.style.backgroundImage = "url('" + t.art + "')";
      glowEl.style.opacity = '0.5';
      glowEl.style.backgroundImage = "url('" + t.art + "')";
      miniArtEl.classList.remove('local-placeholder');
      miniArtEl.innerHTML = '';
      miniArtEl.style.backgroundImage = "url('" + t.art + "')";
    } else {
      artEl.classList.add('local-placeholder');
      artEl.style.backgroundImage = 'none';
      artEl.innerHTML = '<i class="fas fa-music"></i>';
      glowEl.style.opacity = '0';
      glowEl.style.backgroundImage = 'none';
      miniArtEl.classList.add('local-placeholder');
      miniArtEl.style.backgroundImage = 'none';
      miniArtEl.innerHTML = '<i class="fas fa-music"></i>';
    }

    if (t.isLocal) {
      qs('player-duration').textContent = t.duration ? formatTime(t.duration) : '0:00';
      updateProgressUI();
      audioEl.pause();
      audioEl.src = t.url;
      audioEl.currentTime = 0;
    } else {
      qs('player-duration').textContent = formatTime(t.duration);
      updateProgressUI();
      audioEl.pause();
    }

    var isLastTrack = (index === TRACKS.length - 1);
    if (isLastTrack && !getAutoplayEnabled()) {
      qs('player-next-title').textContent = 'End of queue';
      qs('player-next-artist').textContent = '';
    } else {
      var nextIndex = (index + 1) % TRACKS.length;
      qs('player-next-title').textContent = TRACKS[nextIndex].title;
      qs('player-next-artist').textContent = TRACKS[nextIndex].artist;
    }

    if (autoplay) {
      playTrack();
    } else {
      pauseTrack();
    }
  }

  /* Crossfade — a real gain-ramp fade-out/fade-in around the transition,
     not a true dual-track overlap (this app only ever has one <audio>
     element). Only kicks in when something is actually playing, both
     the current and upcoming tracks are imported audio, and the Web
     Audio graph already exists. Everything else (demo tracks, a paused
     player, crossfade turned off) falls straight back to a plain load. */
  function transitionToTrack(nextIndex) {
    var current = TRACKS[currentTrackIndex];
    var upcoming = TRACKS[nextIndex];
    var canCrossfade = getCrossfadeEnabled() && isPlaying && audioCtx && masterGain &&
      current && current.isLocal && upcoming && upcoming.isLocal;

    if (!canCrossfade) {
      loadTrack(nextIndex, true);
      return;
    }

    var dur = getCrossfadeDuration();
    var now = audioCtx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(0, now + dur);

    setTimeout(function () {
      loadTrack(nextIndex, true);
      var now2 = audioCtx.currentTime;
      masterGain.gain.cancelScheduledValues(now2);
      masterGain.gain.setValueAtTime(0, now2);
      masterGain.gain.linearRampToValueAtTime(1, now2 + dur);
    }, dur * 1000);
  }

  function goNext() {
    var isLastTrack = (currentTrackIndex === TRACKS.length - 1);
    if (isLastTrack && !getAutoplayEnabled()) {
      pauseTrack();
      return;
    }
    var nextIndex = (currentTrackIndex + 1) % TRACKS.length;
    transitionToTrack(nextIndex);
  }

  function goPrev() {
    var prevIndex = (currentTrackIndex - 1 + TRACKS.length) % TRACKS.length;
    transitionToTrack(prevIndex);
  }

  /* The mini player only ever shows while the user is on the Library
     screen — miniPlayerActive tracks whether a track is loaded/minimized
     at all (regardless of screen), and syncMiniPlayerVisibility() is what
     actually decides whether the DOM element is shown, based on both that
     and the current screen. Playback itself is never affected by this —
     audio keeps going on every screen, only the widget's visibility is
     restricted. */
  var miniPlayerActive = false;

  function syncMiniPlayerVisibility() {
    var el = qs('mini-player');
    if (miniPlayerActive && currentScreenName === 'library') {
      el.classList.add('visible');
    } else {
      el.classList.remove('visible');
    }
  }

  function showMiniPlayer() {
    miniPlayerActive = true;
    syncMiniPlayerVisibility();
  }

  function hideMiniPlayer() {
    miniPlayerActive = false;
    syncMiniPlayerVisibility();
  }

  function openPlayer(index) {
    loadTrack(index, true);
    hideMiniPlayer();
    qs('player-screen').classList.add('open');
  }

  /* Brings the full screen back over whatever is already loaded/playing,
     without touching playback at all — no loadTrack(), no reset. This is
     what the mini player's artwork uses, since it's re-opening the same
     session, not starting a new one. */
  function reopenPlayer() {
    hideMiniPlayer();
    qs('player-screen').classList.add('open');
  }

  /* Tapping back on the full Now Playing screen only minimizes it —
     playback keeps going, and the mini player takes over as the control
     surface. Nothing here pauses the audio; that was the original bug. */
  function closePlayer() {
    qs('player-screen').classList.remove('open');
    showMiniPlayer();
  }

  /* Only the mini player's X actually stops playback and dismisses
     everything — the one action meant to end the session entirely. */
  function stopPlayerEntirely() {
    pauseTrack();
    hideMiniPlayer();
    qs('player-screen').classList.remove('open');
  }

  /* ---------- Keep bottom nav clear of the on-screen keyboard ----------
     position:fixed alone isn't reliable once a WebView's keyboard opens —
     depending on how the native wrapper resizes/pans, a fixed element can
     end up floating mid-screen instead of staying pinned. The
     visualViewport API reports the actual visible area regardless of how
     the wrapper handles it, so we measure it directly and nudge the nav
     up by whatever amount is currently hidden (i.e. the keyboard height).
  */
  /* ---------- Swipe-down to dismiss the Now Playing sheet ----------
     Dragging from the handle/top bar tracks the finger 1:1 (no CSS
     transition while active — that's what .dragging disables). On
     release: dismiss if dragged past 120px, OR if released with enough
     downward velocity even on a short drag (a fast flick). Otherwise it
     snaps back open. Dismissing calls closePlayer(), which only
     minimizes — playback keeps going, same as the back-arrow path.
  */
  function initPlayerSwipeToDismiss() {
    var zone = qs('player-drag-zone');
    var sheet = qs('player-screen');
    var startY = 0;
    var startTime = 0;
    var currentDelta = 0;
    var dragging = false;

    zone.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { return; }
      startY = e.touches[0].clientY;
      startTime = Date.now();
      currentDelta = 0;
      dragging = true;
      sheet.classList.add('dragging');
    }, { passive: true });

    zone.addEventListener('touchmove', function (e) {
      if (!dragging) { return; }
      currentDelta = e.touches[0].clientY - startY;
      if (currentDelta < 0) { currentDelta = 0; }
      sheet.style.transform = 'translateY(' + currentDelta + 'px)';
      e.preventDefault();
    }, { passive: false });

    zone.addEventListener('touchend', function () {
      if (!dragging) { return; }
      dragging = false;
      sheet.classList.remove('dragging');

      var elapsed = Date.now() - startTime;
      var velocity = elapsed > 0 ? currentDelta / elapsed : 0;

      sheet.style.transform = '';

      if (currentDelta > 120 || (currentDelta > 10 && velocity > 0.5)) {
        closePlayer();
      }
      // otherwise: 'open' class is untouched, so clearing the inline
      // transform just snaps it back to translateY(0) via the CSS transition
    }, { passive: true });
  }

  function initKeyboardSafeNav() {
    var nav = document.querySelector('.bottom-nav');
    if (!nav) { return; }
    if (!window.visualViewport) { return; } // no support — CSS fixed positioning is the fallback

    function reposition() {
      if (hasClass(nav, 'nav-hidden')) { return; }
      var vv = window.visualViewport;
      var hidden = window.innerHeight - vv.height - vv.offsetTop;
      if (hidden < 0) { hidden = 0; }
      nav.style.transform = 'translateX(-50%) translateY(-' + hidden + 'px)';
    }

    window.visualViewport.addEventListener('resize', reposition);
    window.visualViewport.addEventListener('scroll', reposition);
    reposition();
  }

  /* ---------- Onboarding (first-run only) ----------
     3 steps: name -> genre picks -> "Let's start". Shown once, gated by
     ONBOARD_KEY in localStorage. Deliberately its own onboard-* classes
     throughout so it never gets swept into the Account screen's real
     .genre-chip querySelectorAll loop. */
  var ONBOARD_KEY = 'soniq_onboarding_complete';
  var onboardSelectedGenres = [];

  function isOnboardingComplete() {
    try {
      return localStorage.getItem(ONBOARD_KEY) === '1';
    } catch (e) {
      return true; // storage unavailable — don't trap the user behind a wall that can never be dismissed
    }
  }

  function markOnboardingComplete() {
    try {
      localStorage.setItem(ONBOARD_KEY, '1');
    } catch (e) {
      // storage unavailable — overlay will just show again next launch
    }
  }

  function showOnboardStep(stepNumber) {
    var steps = document.querySelectorAll('.onboard-step');
    for (var i = 0; i < steps.length; i++) {
      var isTarget = parseInt(steps[i].getAttribute('data-step'), 10) === stepNumber;
      if (isTarget) {
        steps[i].classList.add('active');
      } else {
        steps[i].classList.remove('active');
      }
    }
  }

  function toggleOnboardGenreChip(chip) {
    var genre = chip.getAttribute('data-genre');
    var idx = onboardSelectedGenres.indexOf(genre);
    if (hasClass(chip, 'active')) {
      chip.classList.remove('active');
      if (idx !== -1) { onboardSelectedGenres.splice(idx, 1); }
    } else {
      chip.classList.add('active');
      if (idx === -1) { onboardSelectedGenres.push(genre); }
    }
  }

  function finishOnboardStep1() {
    var raw = qs('onboard-name-input').value.replace(/^\s+|\s+$/g, '');
    var name = raw.length > 0 ? raw : 'User';
    saveDisplayName(name);
    applyDisplayName(name);
    qs('onboard-step3-heading').textContent = name + ', your library is ready';
    showOnboardStep(2);
  }

  function finishOnboardStep2() {
    saveGenrePrefs(onboardSelectedGenres);
    qs('genre-current-value').textContent = genrePrefsLabel(onboardSelectedGenres);
    var chips = document.querySelectorAll('.genre-chip');
    for (var i = 0; i < chips.length; i++) {
      if (onboardSelectedGenres.indexOf(chips[i].getAttribute('data-genre')) !== -1) {
        chips[i].classList.add('active');
      }
    }
    reorderLibraryByGenrePref();
    showOnboardStep(3);
  }

  function finishOnboarding() {
    markOnboardingComplete();
    qs('onboarding-overlay').classList.add('dismissed');
  }

  function initOnboarding() {
    if (isOnboardingComplete()) {
      qs('onboarding-overlay').classList.add('dismissed');
      return;
    }

    qs('onboard-step1-continue').addEventListener('click', finishOnboardStep1);
    qs('onboard-name-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { finishOnboardStep1(); }
    });

    var onboardGenreChips = document.querySelectorAll('.onboard-genre-chip');
    for (var ogc = 0; ogc < onboardGenreChips.length; ogc++) {
      onboardGenreChips[ogc].addEventListener('click', function (e) {
        toggleOnboardGenreChip(e.target);
      });
    }
    qs('onboard-step2-continue').addEventListener('click', finishOnboardStep2);

    qs('onboard-step3-finish').addEventListener('click', finishOnboarding);
  }

  /* ---------- Auth screen (email / password) ----------
     One screen, two modes (login/signup) toggled in place. Firebase
     error codes are mapped to short human text rather than leaking a
     raw SDK error string at the user. */
  var authMode = 'login';

  function authErrorMessage(err) {
    var code = err && err.code;
    if (code === 'auth/email-already-in-use') { return 'That email already has an account \u2014 try signing in instead.'; }
    if (code === 'auth/invalid-email') { return "That email address doesn't look right."; }
    if (code === 'auth/weak-password') { return 'Password should be at least 6 characters.'; }
    if (code === 'auth/wrong-password') { return 'Wrong password \u2014 try again.'; }
    if (code === 'auth/user-not-found') { return 'No account found for that email.'; }
    if (code === 'auth/invalid-credential') { return 'Email or password is incorrect.'; }
    if (code === 'auth/too-many-requests') { return 'Too many attempts \u2014 wait a bit and try again.'; }
    if (code === 'auth/network-request-failed') { return 'Network error \u2014 check your connection and try again.'; }
    return 'Something went wrong \u2014 please try again.';
  }

  function setAuthMode(mode) {
    authMode = mode;
    qs('auth-error').classList.add('hidden');
    qs('auth-error').textContent = '';
    if (mode === 'signup') {
      qs('auth-heading').textContent = 'Create Account';
      qs('auth-submit-label').textContent = 'Sign Up';
      qs('auth-toggle-lead').textContent = 'Already have an account?';
      qs('auth-toggle-link').textContent = 'Sign in';
    } else {
      qs('auth-heading').textContent = 'Sign In';
      qs('auth-submit-label').textContent = 'Sign In';
      qs('auth-toggle-lead').textContent = "Don't have an account?";
      qs('auth-toggle-link').textContent = 'Sign up';
    }
  }

  function openAuthScreen() {
    qs('auth-email-input').value = '';
    qs('auth-password-input').value = '';
    qs('auth-error').classList.add('hidden');
    setAuthMode('login');
    showScreen('auth');
  }

  /* Cloud -> local hydration on login. Reuses the existing save-then-apply
     pairs so hydrated data flows through the exact same paths a real
     local edit would. Each also re-queues an (idempotent) cloud sync of
     the value it just read back — harmless, just a redundant merge. */
  function hydrateFromCloudDoc(data) {
    if (!data) { return; }
    if (typeof data.displayName === 'string') {
      saveDisplayName(data.displayName);
      applyDisplayName(data.displayName);
    }
    if (typeof data.avatarUrl === 'string' && data.avatarUrl) {
      saveAvatarUrl(data.avatarUrl);
      applyAvatarUrl(data.avatarUrl);
    }
    if (data.genrePrefs) {
      saveGenrePrefs(data.genrePrefs);
      qs('genre-current-value').textContent = genrePrefsLabel(data.genrePrefs);
      var chips = document.querySelectorAll('.genre-chip');
      for (var i = 0; i < chips.length; i++) {
        if (data.genrePrefs.indexOf(chips[i].getAttribute('data-genre')) !== -1) {
          chips[i].classList.add('active');
        } else {
          chips[i].classList.remove('active');
        }
      }
      reorderLibraryByGenrePref();
    }
    if (typeof data.theme === 'string') {
      saveThemePref(data.theme);
      applyTheme(data.theme);
      var toggles = document.querySelectorAll('.theme-toggle');
      for (var t = 0; t < toggles.length; t++) {
        toggles[t].checked = (toggles[t].getAttribute('data-theme') === data.theme);
      }
      qs('theme-current-value').textContent = themeLabelFor(data.theme);
    }
    if (typeof data.crossfadeEnabled === 'boolean') {
      saveCrossfadeEnabled(data.crossfadeEnabled);
      qs('pref-crossfade-enabled').checked = data.crossfadeEnabled;
      qs('crossfade-duration-slider').disabled = !data.crossfadeEnabled;
    }
    if (typeof data.crossfadeDuration === 'number') {
      saveCrossfadeDuration(data.crossfadeDuration);
      qs('crossfade-duration-slider').value = data.crossfadeDuration;
      qs('crossfade-duration-value').textContent = data.crossfadeDuration + 's';
    }
    qs('crossfade-current-value').textContent = crossfadeValueLabel(getCrossfadeEnabled(), getCrossfadeDuration());
    if (typeof data.normalizeVolume === 'boolean') {
      saveNormalizeEnabled(data.normalizeVolume);
      qs('pref-normalize-volume').checked = data.normalizeVolume;
      applyNormalizePref();
    }
    if (typeof data.autoplaySimilar === 'boolean') {
      saveAutoplayEnabled(data.autoplaySimilar);
      qs('pref-autoplay').checked = data.autoplaySimilar;
    }
    if (typeof data.reduceMotion === 'boolean') {
      saveReduceMotionEnabled(data.reduceMotion);
      qs('pref-reduce-motion').checked = data.reduceMotion;
      applyReduceMotion(data.reduceMotion);
    }
    if (typeof data.haptics === 'boolean') {
      saveHapticsEnabled(data.haptics);
      qs('pref-haptics').checked = data.haptics;
    }
    if (data.eqGains && data.eqGains.length === eqGains.length) {
      for (var g = 0; g < data.eqGains.length; g++) {
        setEqGain(g, data.eqGains[g]);
      }
      renderEqSliders();
    }
  }

  function buildCloudSnapshot() {
    return {
      displayName: getDisplayName(),
      avatarUrl: getAvatarUrl() || null,
      genrePrefs: getGenrePrefs(),
      theme: getThemePref(),
      crossfadeEnabled: getCrossfadeEnabled(),
      crossfadeDuration: getCrossfadeDuration(),
      normalizeVolume: getNormalizeEnabled(),
      autoplaySimilar: getAutoplayEnabled(),
      reduceMotion: getReduceMotionEnabled(),
      haptics: getHapticsEnabled(),
      eqGains: eqGains
    };
  }

  function updateAccountSyncUI() {
    var signedOutRow = qs('account-signed-out-row');
    var signedInRow = qs('account-signed-in-row');
    if (isSignedIn()) {
      signedOutRow.classList.add('hidden');
      signedInRow.classList.remove('hidden');
      qs('account-signed-in-email').textContent = fbAuth.currentUser.email || '';
    } else {
      signedOutRow.classList.remove('hidden');
      signedInRow.classList.add('hidden');
    }
  }

  function returnFromAuthSuccess() {
    showScreen('account');
  }

  function submitAuthForm() {
    if (!fbAuth) {
      qs('auth-error').textContent = "Sign-in isn't available right now \u2014 check your connection.";
      qs('auth-error').classList.remove('hidden');
      return;
    }
    var email = qs('auth-email-input').value.replace(/^\s+|\s+$/g, '');
    var password = qs('auth-password-input').value;
    qs('auth-error').classList.add('hidden');

    if (email.length === 0 || password.length === 0) {
      qs('auth-error').textContent = 'Enter both an email and a password.';
      qs('auth-error').classList.remove('hidden');
      return;
    }

    qs('auth-submit-btn').disabled = true;

    if (authMode === 'signup') {
      fbAuth.createUserWithEmailAndPassword(email, password).then(function (cred) {
        var snapshot = buildCloudSnapshot();
        return fbDb.collection('users').doc(cred.user.uid).set(snapshot);
      }).then(function () {
        qs('auth-submit-btn').disabled = false;
        updateAccountSyncUI();
        returnFromAuthSuccess();
      }).catch(function (err) {
        qs('auth-submit-btn').disabled = false;
        qs('auth-error').textContent = authErrorMessage(err);
        qs('auth-error').classList.remove('hidden');
      });
    } else {
      fbAuth.signInWithEmailAndPassword(email, password).then(function (cred) {
        return fbDb.collection('users').doc(cred.user.uid).get();
      }).then(function (doc) {
        qs('auth-submit-btn').disabled = false;
        if (doc.exists) { hydrateFromCloudDoc(doc.data()); }
        updateAccountSyncUI();
        returnFromAuthSuccess();
      }).catch(function (err) {
        qs('auth-submit-btn').disabled = false;
        qs('auth-error').textContent = authErrorMessage(err);
        qs('auth-error').classList.remove('hidden');
      });
    }
  }

  function signOutOfAccount() {
    if (!fbAuth) { return; }
    fbAuth.signOut().then(function () {
      updateAccountSyncUI();
    });
  }

  function initAuthUI() {
    qs('account-sign-in-btn').addEventListener('click', openAuthScreen);
    qs('account-sign-out-btn').addEventListener('click', signOutOfAccount);
    qs('auth-back').addEventListener('click', function () {
      showScreen('account');
    });
    qs('auth-toggle-link').addEventListener('click', function () {
      setAuthMode(authMode === 'login' ? 'signup' : 'login');
    });
    qs('auth-submit-btn').addEventListener('click', submitAuthForm);
    qs('auth-password-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { submitAuthForm(); }
    });

    updateAccountSyncUI();
    if (fbAuth) {
      fbAuth.onAuthStateChanged(function () {
        updateAccountSyncUI();
      });
    }
  }

  /* ---------- Wire everything up ---------- */

  document.addEventListener('DOMContentLoaded', function () {
    initFirebase();
    initKeyboardSafeNav();
    initPlayerSwipeToDismiss();
    renderRecent();
    renderTrending();
    initThemeToggles();
    initPreferenceToggles();
    initAccountProfile();
    renderEqSliders();
    initOnboarding();
    initAuthUI();
    initHomeFilterPills();

    audioEl = qs('audio-el');

    audioEl.addEventListener('timeupdate', function () {
      var t = TRACKS[currentTrackIndex];
      if (!t || !t.isLocal) { return; }
      var dur = audioEl.duration || 0;
      var cur = audioEl.currentTime || 0;
      var pct = dur > 0 ? (cur / dur) * 100 : 0;
      qs('player-fill').style.width = pct + '%';
      qs('player-thumb').style.left = pct + '%';
      qs('player-elapsed').textContent = formatTime(cur);
    });

    audioEl.addEventListener('loadedmetadata', function () {
      var t = TRACKS[currentTrackIndex];
      if (!t || !t.isLocal) { return; }
      qs('player-duration').textContent = formatTime(audioEl.duration || 0);
    });

    audioEl.addEventListener('ended', function () {
      goNext();
    });

    qs('open-search-header').addEventListener('click', function () {
      showScreen('search');
    });

    qs('nav-home').addEventListener('click', function (e) {
      e.preventDefault();
      showScreen('home');
    });

    qs('nav-search').addEventListener('click', function (e) {
      e.preventDefault();
      showScreen('search');
    });

    qs('nav-library').addEventListener('click', function (e) {
      e.preventDefault();
      showScreen('library');
    });

    qs('nav-account').addEventListener('click', function (e) {
      e.preventDefault();
      showScreen('account');
    });

    qs('theme-dropdown-toggle').addEventListener('click', function () {
      var row = qs('theme-setting');
      if (hasClass(row, 'open')) {
        row.classList.remove('open');
      } else {
        row.classList.add('open');
      }
    });

    var themeToggles = document.querySelectorAll('.theme-toggle');
    for (var tt = 0; tt < themeToggles.length; tt++) {
      themeToggles[tt].addEventListener('change', handleThemeToggleChange);
    }

    qs('crossfade-dropdown-toggle').addEventListener('click', function () {
      var row = qs('crossfade-setting');
      if (hasClass(row, 'open')) {
        row.classList.remove('open');
      } else {
        row.classList.add('open');
      }
    });

    qs('pref-crossfade-enabled').addEventListener('change', function (e) {
      var on = e.target.checked;
      saveCrossfadeEnabled(on);
      qs('crossfade-duration-slider').disabled = !on;
      qs('crossfade-current-value').textContent = crossfadeValueLabel(on, getCrossfadeDuration());
    });

    qs('crossfade-duration-slider').addEventListener('input', function (e) {
      var seconds = parseInt(e.target.value, 10);
      saveCrossfadeDuration(seconds);
      qs('crossfade-duration-value').textContent = seconds + 's';
      if (getCrossfadeEnabled()) {
        qs('crossfade-current-value').textContent = crossfadeValueLabel(true, seconds);
      }
    });

    qs('pref-normalize-volume').addEventListener('change', function (e) {
      saveNormalizeEnabled(e.target.checked);
      applyNormalizePref();
    });

    qs('pref-autoplay').addEventListener('change', function (e) {
      saveAutoplayEnabled(e.target.checked);
    });

    qs('pref-reduce-motion').addEventListener('change', function (e) {
      var on = e.target.checked;
      saveReduceMotionEnabled(on);
      applyReduceMotion(on);
    });

    qs('pref-haptics').addEventListener('change', function (e) {
      saveHapticsEnabled(e.target.checked);
      // fire one immediately so toggling it on gives instant confirmation
      if (e.target.checked && navigator.vibrate) {
        try { navigator.vibrate(12); } catch (err) {}
      }
    });

    qs('avatar-edit-btn').addEventListener('click', function () {
      qs('avatar-file-input').click();
    });

    qs('avatar-file-input').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) {
        processAvatarFile(e.target.files[0]);
      }
      e.target.value = '';
    });

    qs('name-edit-btn').addEventListener('click', enterNameEditMode);
    qs('name-save-btn').addEventListener('click', saveNameFromInput);

    qs('account-name-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        saveNameFromInput();
      }
    });

    qs('genre-dropdown-toggle').addEventListener('click', function () {
      var row = qs('genre-setting');
      if (hasClass(row, 'open')) {
        row.classList.remove('open');
      } else {
        row.classList.add('open');
      }
    });

    var genreChips = document.querySelectorAll('.genre-chip');
    for (var gc = 0; gc < genreChips.length; gc++) {
      genreChips[gc].addEventListener('click', function (e) {
        toggleGenreChip(e.target);
      });
    }

    var eqBands = document.querySelectorAll('.eq-band');
    for (var eb = 0; eb < eqBands.length; eb++) {
      (function (bandEl) {
        var bandIndex = parseInt(bandEl.getAttribute('data-band'), 10);
        var slider = bandEl.querySelector('.eq-slider');
        var valueLabel = bandEl.querySelector('.eq-band-value');
        slider.addEventListener('input', function () {
          var val = parseInt(slider.value, 10);
          setEqGain(bandIndex, val);
          valueLabel.textContent = val + 'dB';
          clearEqPresetHighlight();
        });
      })(eqBands[eb]);
    }

    var eqPresetBtns = document.querySelectorAll('.eq-preset-btn');
    for (var ep = 0; ep < eqPresetBtns.length; ep++) {
      eqPresetBtns[ep].addEventListener('click', function (e) {
        applyEqPreset(e.target.getAttribute('data-preset'));
      });
    }

    qs('player-eq-link').addEventListener('click', function () {
      // Leaving the Now Playing sheet for the EQ screen — this only
      // minimizes it, same as the back arrow; playback isn't affected.
      qs('player-screen').classList.remove('open');
      showMiniPlayer();
      showScreen('eq');
    });

    qs('eq-back').addEventListener('click', function () {
      showScreen('library');
    });

    qs('search-back').addEventListener('click', function () {
      showScreen('home');
    });

    qs('player-back').addEventListener('click', closePlayer);
    qs('player-playpause').addEventListener('click', togglePlay);
    qs('player-next').addEventListener('click', goNext);
    qs('player-prev').addEventListener('click', goPrev);

    qs('player-like').addEventListener('click', function () {
      setLikedState(!hasClass(qs('player-like'), 'liked'));
    });

    qs('mini-close').addEventListener('click', function (e) {
      e.stopPropagation();
      stopPlayerEntirely();
    });

    qs('mini-next').addEventListener('click', function (e) {
      e.stopPropagation();
      goNext();
    });

    qs('mini-playpause').addEventListener('click', function (e) {
      e.stopPropagation();
      togglePlay();
    });

    qs('mini-prev').addEventListener('click', function (e) {
      e.stopPropagation();
      goPrev();
    });

    qs('mini-like').addEventListener('click', function (e) {
      e.stopPropagation();
      setLikedState(!hasClass(qs('player-like'), 'liked'));
    });

    // Tapping the mini player's artwork brings the full Now Playing
    // screen back — the expected gesture on basically every platform
    // that has a mini player, so it's included even though it wasn't
    // spelled out explicitly.
    qs('mini-art').addEventListener('click', function () {
      reopenPlayer();
    });

    qs('player-track').addEventListener('click', function (e) {
      var rect = this.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var pct = x / rect.width;
      if (pct < 0) { pct = 0; }
      if (pct > 1) { pct = 1; }
      var t = TRACKS[currentTrackIndex];
      if (t.isLocal) {
        if (audioEl.duration) {
          audioEl.currentTime = pct * audioEl.duration;
        }
      } else {
        progressSeconds = Math.floor(pct * t.duration);
        updateProgressUI();
      }
    });

    var input = qs('search-input');
    var clearBtn = qs('search-clear');

    input.addEventListener('input', function () {
      if (input.value.length > 0) {
        clearBtn.classList.add('shown');
      } else {
        clearBtn.classList.remove('shown');
      }
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        runSearch(input.value);
      }, 150);
    });

    clearBtn.addEventListener('click', function () {
      input.value = '';
      clearBtn.classList.remove('shown');
      showDefault();
      input.focus();
    });

    qs('clear-recent').addEventListener('click', clearRecent);

    document.addEventListener('click', function (e) {
      var target = e.target;

      var cardPlayBtn = closestByClass(target, 'play-btn');
      if (cardPlayBtn && closestByClass(target, 'feature-card')) {
        var playIcon = cardPlayBtn.querySelector('i');
        if (hasClass(playIcon, 'fa-play')) {
          playIcon.classList.remove('fa-play');
          playIcon.classList.add('fa-pause');
        } else {
          playIcon.classList.remove('fa-pause');
          playIcon.classList.add('fa-play');
        }
        return;
      }

      if (target.classList.contains('card-heart')) {
        if (hasClass(target, 'liked')) {
          target.classList.remove('liked');
          target.classList.remove('fas');
          target.classList.add('far');
        } else {
          target.classList.add('liked');
          target.classList.remove('far');
          target.classList.add('fas');
        }
        return;
      }

      if (target.classList.contains('card-download')) {
        if (hasClass(target, 'saved')) {
          target.classList.remove('saved');
        } else {
          target.classList.add('saved');
          target.classList.add('pulse');
          setTimeout(function () {
            target.classList.remove('pulse');
          }, 420);
        }
        return;
      }

      if (target.classList.contains('lib-heart')) {
        if (hasClass(target, 'liked')) {
          target.classList.remove('liked');
          target.classList.remove('fas');
          target.classList.add('far');
        } else {
          target.classList.add('liked');
          target.classList.remove('far');
          target.classList.add('fas');
        }
        return;
      }

      var libCard = closestByClass(target, 'lib-card');
      if (libCard) {
        var idx = parseInt(libCard.getAttribute('data-index'), 10);
        openPlayer(idx);
        return;
      }

      if (target.classList.contains('chip-remove')) {
        var chipToRemove = target.parentNode;
        removeRecent(chipToRemove.getAttribute('data-query'));
        return;
      }

      var chipEl = closestByClass(target, 'chip');
      if (chipEl) {
        var chipQuery = chipEl.getAttribute('data-query');
        input.value = chipQuery;
        clearBtn.classList.add('shown');
        addRecent(chipQuery);
        runSearch(chipQuery);
        return;
      }

      var rowEl = closestByClass(target, 'result-row');
      if (rowEl) {
        var rowQuery = rowEl.getAttribute('data-query');
        input.value = rowQuery;
        addRecent(rowQuery);
      }
    });
  });

})();
