const CONFIG_KEY = 'carpoolDismissalConfigV2';
const state = {
  config: {
    schoolName: 'Carpool Dismissal',
    apiUrl: '',
    spreadsheetId: '',
    studentsSheet: 'Students',
    pickupsSheet: 'Pickups',
    communitiesSheet: 'Communities',
    settingsSheet: 'Settings',
    pollSeconds: 2,
    popupSeconds: 3,
    deviceName: '',
    appPin: ''
  },
  students: [],
  communities: {},
  selectedNumber: '',
  selectedStudent: null,
  selectedRow: null,
  pickups: [],
  seenPickupIds: new Set(),
  currentView: 'entry',
  community: '',
  audioReady: false,
  audioContext: null,
  pollTimer: null,
  unlocked: false,
  sessionPin: ''
};

const $ = id => document.getElementById(id);

function saveConfigToStorage() { localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config)); }
function loadConfigFromStorage() {
  const saved = localStorage.getItem(CONFIG_KEY);
  if (saved) state.config = { ...state.config, ...JSON.parse(saved) };
}
function sheetParams() {
  return {
    spreadsheetId: state.config.spreadsheetId,
    studentsSheet: state.config.studentsSheet,
    pickupsSheet: state.config.pickupsSheet,
    communitiesSheet: state.config.communitiesSheet,
    settingsSheet: state.config.settingsSheet
  };
}
async function api(action, params = {}, options = {}) {
  if (!state.config.apiUrl) throw new Error('Missing Apps Script Web App URL. Add it in Admin.');
  const payload = { action, ...sheetParams(), ...params };
  if (state.sessionPin && !payload.pin) payload.pin = state.sessionPin;
  const url = state.config.apiUrl + '?' + new URLSearchParams(payload).toString();
  const res = await fetch(url, { method: 'GET', cache: 'no-store', ...options });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'API request failed');
  return data;
}
function setMessage(id, text, type = 'info') {
  const el = $(id);
  el.className = `message ${type}`;
  el.textContent = text;
}
function communityStyle(name) {
  const c = state.communities[name] || state.communities.UNKNOWN || { backgroundColor: '#667EEA', textColor: '#FFFFFF' };
  return `background:${c.backgroundColor};color:${c.textColor};`;
}
function rowLabel(row) { return row === 'ONE' ? 'Row 1' : row === 'TWO' ? 'Row 2' : row; }
function studentForNumber(number) { return state.students.find(s => String(s.number) === String(number)); }
function applySettingsToForm() {
  $('schoolName').textContent = state.config.schoolName || 'Carpool Dismissal';
  $('settingSchoolName').value = state.config.schoolName || '';
  $('settingApiUrl').value = state.config.apiUrl || '';
  $('settingSpreadsheetId').value = state.config.spreadsheetId || '';
  $('settingStudentsSheet').value = state.config.studentsSheet || 'Students';
  $('settingPickupsSheet').value = state.config.pickupsSheet || 'Pickups';
  $('settingCommunitiesSheet').value = state.config.communitiesSheet || 'Communities';
  $('settingPollSeconds').value = state.config.pollSeconds || 2;
  $('settingPopupSeconds').value = state.config.popupSeconds || 3;
  $('settingDeviceName').value = state.config.deviceName || '';
  $('settingAppPin').value = state.config.appPin || '';
}
function readSettingsFromForm() {
  state.config.schoolName = $('settingSchoolName').value.trim() || 'Carpool Dismissal';
  state.config.apiUrl = $('settingApiUrl').value.trim();
  state.config.spreadsheetId = $('settingSpreadsheetId').value.trim();
  state.config.studentsSheet = $('settingStudentsSheet').value.trim() || 'Students';
  state.config.pickupsSheet = $('settingPickupsSheet').value.trim() || 'Pickups';
  state.config.communitiesSheet = $('settingCommunitiesSheet').value.trim() || 'Communities';
  state.config.pollSeconds = Number($('settingPollSeconds').value || 2);
  state.config.popupSeconds = Number($('settingPopupSeconds').value || 3);
  state.config.deviceName = $('settingDeviceName').value.trim();
  state.config.appPin = $('settingAppPin').value.trim();
}
function showLock() {
  $('app').classList.add('locked');
  $('lockScreen').classList.remove('hidden');
  $('lockApiUrl').value = state.config.apiUrl || '';
  $('lockSpreadsheetId').value = state.config.spreadsheetId || '';
  setTimeout(() => $('pinInput').focus(), 50);
}
function hideLock() {
  state.unlocked = true;
  $('lockScreen').classList.add('hidden');
  $('app').classList.remove('locked');
}
function readLockDeviceSetup() {
  state.config.apiUrl = $('lockApiUrl').value.trim() || state.config.apiUrl;
  state.config.spreadsheetId = $('lockSpreadsheetId').value.trim() || state.config.spreadsheetId;
  saveConfigToStorage();
  applySettingsToForm();
}
async function unlockWithPin() {
  const pin = $('pinInput').value.trim();
  if (!/^\d{4}$/.test(pin)) return setMessage('lockMessage', 'Enter the 4-digit PIN.', 'error');
  readLockDeviceSetup();
  if (!state.config.apiUrl || !state.config.spreadsheetId) {
    $('deviceSetup').classList.remove('hidden');
    return setMessage('lockMessage', 'Add the Apps Script URL and Spreadsheet ID for this device first.', 'error');
  }
  setMessage('lockMessage', 'Checking PIN...', 'info');
  try {
    const d = await api('validatePin', { pin });
    state.sessionPin = pin;
    sessionStorage.setItem('carpoolPinUnlocked', 'true');
    sessionStorage.setItem('carpoolSessionPin', pin);
    hideLock();
    await loadAppData();
    startPolling();
  } catch (err) {
    setMessage('lockMessage', 'Incorrect PIN or connection issue.', 'error');
  }
}
function setView(view) {
  state.currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $(`${view}View`)?.classList.add('active');
  location.hash = view;
  if (view === 'display' || view === 'community' || view === 'queue') startPolling();
}
async function loadAppData() {
  const data = await api('getAppData');
  state.students = data.students || [];
  state.communities = data.communities || {};
  $('studentCount').textContent = `${state.students.length} loaded`;
  renderStudents();
  renderCommunityOptions();
}
function renderStudents() {
  const term = $('studentSearch').value.toLowerCase().trim();
  const results = state.students
    .filter(s => !term || s.name.toLowerCase().includes(term) || String(s.number).includes(term))
    .sort((a,b) => a.name.localeCompare(b.name))
    .slice(0, term ? 30 : 80);
  $('studentResults').innerHTML = results.length ? results.map(s => `
    <button class="student-card" style="${communityStyle(s.community)}" data-number="${s.number}">
      <div><div class="student-name">${escapeHtml(s.name)}</div><div class="student-meta">#${escapeHtml(s.number)} · ${escapeHtml(s.community || 'UNKNOWN')}</div></div>
      <strong>Choose</strong>
    </button>`).join('') : '<div class="empty">No matching students</div>';
}
function renderCommunityOptions() {
  const names = Object.values(state.communities).sort((a,b) => (a.sortOrder || 99) - (b.sortOrder || 99)).map(c => c.name);
  const studentCommunities = [...new Set(state.students.map(s => s.community).filter(Boolean))];
  const all = [...new Set([...names, ...studentCommunities, 'UNKNOWN'])];
  $('communitySelect').innerHTML = all.map(name => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join('');
  if (state.community) $('communitySelect').value = state.community;
}
function selectStudent(number) {
  const student = studentForNumber(number);
  state.selectedNumber = String(number);
  state.selectedStudent = student || null;
  updateEntryDisplay();
}
function updateEntryDisplay() {
  $('displayNumber').textContent = state.selectedNumber || '---';
  $('displayStudent').textContent = state.selectedStudent ? state.selectedStudent.name : state.selectedNumber ? 'Unknown card number' : 'No student selected';
  $('displayRow').textContent = state.selectedRow ? rowLabel(state.selectedRow) : '';
  document.querySelectorAll('.row-buttons button').forEach(b => b.classList.toggle('active', b.dataset.row === state.selectedRow));
}
function clearEntry() {
  state.selectedNumber = '';
  state.selectedStudent = null;
  state.selectedRow = null;
  updateEntryDisplay();
}
async function submitPickup() {
  if (!state.selectedNumber) return setMessage('entryMessage', 'Enter or choose a student/card number first.', 'error');
  if (!state.selectedRow) return setMessage('entryMessage', 'Choose Row 1 or Row 2.', 'error');
  const student = state.selectedStudent || studentForNumber(state.selectedNumber);
  setMessage('entryMessage', 'Submitting...', 'info');
  try {
    const data = await api('createPickup', {
      cardNumber: state.selectedNumber,
      rowType: state.selectedRow,
      studentName: student ? student.name : 'Unknown',
      submittedBy: '',
      device: state.config.deviceName || ''
    });
    setMessage('entryMessage', `Submitted: ${data.pickup.name} #${data.pickup.number} to ${rowLabel(data.pickup.rowType)}`, 'success');
    clearEntry();
    await refreshPickups(false);
  } catch (err) { setMessage('entryMessage', err.message, 'error'); }
}
async function refreshPickups(alertNew = true) {
  const data = await api('getPickups', { status: 'active', limit: 100 });
  const previous = new Set(state.seenPickupIds);
  state.pickups = data.pickups || [];
  state.pickups.forEach(p => state.seenPickupIds.add(p.id));
  renderRecent();
  renderQueue();
  renderDisplay(alertNew ? previous : null);
  renderCommunity(alertNew ? previous : null);
}
function renderRecent() {
  const items = state.pickups.slice(0, 15);
  $('recentList').innerHTML = items.length ? items.map(pickupSmallHtml).join('') : '<div class="empty">No pickups yet</div>';
}
function renderQueue() {
  $('queueList').innerHTML = state.pickups.length ? state.pickups.map(p => pickupSmallHtml(p, true)).join('') : '<div class="empty">No active pickups</div>';
}
function renderDisplay(previousIds) {
  const rowOne = state.pickups.filter(p => p.rowType === 'ONE');
  const rowTwo = state.pickups.filter(p => p.rowType === 'TWO');
  $('displayRowOne').innerHTML = rowOne.map(bigPickupHtml).join('');
  $('displayRowTwo').innerHTML = rowTwo.map(bigPickupHtml).join('');
  if (state.currentView === 'display' && previousIds) {
    const newest = state.pickups.slice().reverse().find(p => !previousIds.has(p.id));
    if (newest) showPopup(newest);
  }
}
function renderCommunity(previousIds) {
  const community = $('communitySelect').value || state.community;
  state.community = community;
  if (!community) return;
  const matches = state.pickups.filter(p => {
    const student = studentForNumber(p.number);
    return (student ? student.community : 'UNKNOWN') === community;
  });
  $('communityList').innerHTML = matches.length ? matches.map(p => pickupSmallHtml(p, true)).join('') : '<div class="empty">No active pickups for this community</div>';
  const newest = previousIds ? matches.slice().reverse().find(p => !previousIds.has(p.id)) : null;
  if (newest && state.currentView === 'community') {
    $('communityCurrent').classList.remove('empty');
    $('communityCurrent').setAttribute('style', communityStyle(community));
    $('communityCurrent').innerHTML = `${escapeHtml(newest.name)}<br><span style="font-size:.45em">#${escapeHtml(newest.number)} · ${rowLabel(newest.rowType)}</span>`;
    buzz();
  } else if (!matches.length) {
    $('communityCurrent').className = 'community-current empty';
    $('communityCurrent').removeAttribute('style');
    $('communityCurrent').textContent = `${community} is clear`;
  }
}
function pickupSmallHtml(p, withActions = false) {
  const student = studentForNumber(p.number);
  const community = student ? student.community : 'UNKNOWN';
  return `<div class="pickup-card" style="${communityStyle(community)}">
    <div><div class="pickup-name">${escapeHtml(p.name)}</div><div class="pickup-meta">#${escapeHtml(p.number)} · ${rowLabel(p.rowType)} · ${escapeHtml(community)}</div></div>
    ${withActions ? `<button class="ghost-btn" data-dismiss="${escapeAttr(p.id)}">Dismiss</button>` : ''}
  </div>`;
}
function bigPickupHtml(p) {
  const student = studentForNumber(p.number);
  const community = student ? student.community : 'UNKNOWN';
  return `<div class="big-pickup" style="${communityStyle(community)}" data-dismiss="${escapeAttr(p.id)}"><div class="pickup-name">${escapeHtml(p.name)}</div><div class="pickup-meta">#${escapeHtml(p.number)}</div></div>`;
}
function showPopup(p) {
  const student = studentForNumber(p.number);
  const community = student ? student.community : 'UNKNOWN';
  const popup = $('popup');
  popup.setAttribute('style', communityStyle(community));
  $('popupName').textContent = p.name;
  $('popupMeta').textContent = `#${p.number} · ${rowLabel(p.rowType)} · ${community}`;
  popup.classList.remove('hidden');
  buzz();
  setTimeout(() => popup.classList.add('hidden'), state.config.popupSeconds * 1000);
}
async function dismissPickup(id) {
  try { await api('dismissPickup', { id }); await refreshPickups(false); }
  catch (err) { alert(err.message); }
}
function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  if (!state.config.apiUrl || !state.config.spreadsheetId) return;
  refreshPickups(false).catch(console.error);
  state.pollTimer = setInterval(() => refreshPickups(true).catch(console.error), Math.max(1, state.config.pollSeconds) * 1000);
}
function enableAudio() {
  state.audioReady = true;
  state.audioContext = state.audioContext || new (window.AudioContext || window.webkitAudioContext)();
  buzz();
}
function buzz() {
  if (navigator.vibrate) navigator.vibrate([250, 100, 250]);
  if (!state.audioReady || !state.audioContext) return;
  const ctx = state.audioContext;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
function escapeAttr(value) { return escapeHtml(value).replace(/'/g, '&#39;'); }
function bindEvents() {
  document.querySelectorAll('.nav button').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
  $('studentSearch').addEventListener('input', renderStudents);
  $('studentResults').addEventListener('click', e => { const card = e.target.closest('[data-number]'); if (card) selectStudent(card.dataset.number); });
  document.querySelector('.number-pad').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    const action = e.target.dataset.action;
    if (action === 'clear') return clearEntry();
    if (action === 'backspace') { state.selectedNumber = state.selectedNumber.slice(0, -1); state.selectedStudent = studentForNumber(state.selectedNumber) || null; return updateEntryDisplay(); }
    state.selectedNumber += e.target.textContent.trim();
    state.selectedStudent = studentForNumber(state.selectedNumber) || null;
    updateEntryDisplay();
  });
  $('clearBtn').addEventListener('click', clearEntry);
  document.querySelectorAll('.row-buttons button').forEach(btn => btn.addEventListener('click', () => { state.selectedRow = btn.dataset.row; updateEntryDisplay(); }));
  $('submitPickupBtn').addEventListener('click', submitPickup);
  $('refreshRecentBtn').addEventListener('click', () => refreshPickups(false));
  $('refreshQueueBtn').addEventListener('click', () => refreshPickups(false));
  document.body.addEventListener('click', e => { const btn = e.target.closest('[data-dismiss]'); if (btn) dismissPickup(btn.dataset.dismiss); });
  $('communitySelect').addEventListener('change', () => { state.community = $('communitySelect').value; localStorage.setItem('carpoolCommunity', state.community); renderCommunity(null); });
  $('enableSoundBtn').addEventListener('click', enableAudio);
  $('saveSettingsBtn').addEventListener('click', async () => {
    readSettingsFromForm();
    saveConfigToStorage();
    applySettingsToForm();
    try {
      if (state.config.appPin) {
        await api('saveSettings', { settingsJson: JSON.stringify({ AppPin: state.config.appPin }) });
        state.sessionPin = state.config.appPin;
        sessionStorage.setItem('carpoolSessionPin', state.sessionPin);
      }
      setMessage('adminMessage', 'Settings saved.', 'success');
      startPolling();
    } catch (err) { setMessage('adminMessage', err.message, 'error'); }
  });
  $('testApiBtn').addEventListener('click', async () => { readSettingsFromForm(); saveConfigToStorage(); try { const d = await api('health'); setMessage('adminMessage', d.message || 'Connection works.', 'success'); } catch (err) { setMessage('adminMessage', err.message, 'error'); } });
  $('setupSheetsBtn').addEventListener('click', async () => { readSettingsFromForm(); saveConfigToStorage(); try { const d = await api('setup'); setMessage('adminMessage', d.message || 'Sheets ready.', 'success'); await loadAppData(); } catch (err) { setMessage('adminMessage', err.message, 'error'); } });
  $('reloadStudentsBtn').addEventListener('click', async () => { try { await loadAppData(); setMessage('adminMessage', 'Data reloaded.', 'success'); } catch (err) { setMessage('adminMessage', err.message, 'error'); } });
  $('unlockBtn').addEventListener('click', unlockWithPin);
  $('pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') unlockWithPin(); });
  $('deviceSetupToggle').addEventListener('click', () => $('deviceSetup').classList.toggle('hidden'));
  $('saveDeviceSetupBtn').addEventListener('click', () => { readLockDeviceSetup(); setMessage('lockMessage', 'Device setup saved. Enter the PIN.', 'success'); });
}
async function init() {
  loadConfigFromStorage();
  state.community = localStorage.getItem('carpoolCommunity') || '';
  applySettingsToForm();
  bindEvents();
  updateEntryDisplay();
  setView((location.hash || '#entry').replace('#',''));
  const wasUnlocked = sessionStorage.getItem('carpoolPinUnlocked') === 'true';
  state.sessionPin = sessionStorage.getItem('carpoolSessionPin') || '';
  if (wasUnlocked && state.sessionPin) {
    hideLock();
    if (state.config.apiUrl && state.config.spreadsheetId) {
      try { await loadAppData(); startPolling(); } catch (err) { showLock(); }
    }
  } else {
    showLock();
  }
}
init();
