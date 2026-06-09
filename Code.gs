/**
 * Carpool Dismissal API
 * Google Sheets-backed API for a Vercel/static front end.
 *
 * Required tabs:
 * Students: Card Number | Student Name | Community | Grade | Active
 * Pickups: Timestamp | Card Number | Row | Student Name | Submission ID | Status | Submitted By | Device
 * Communities: Community | Background Color | Text Color | Sort Order | Active
 * Settings: Key | Value
 */

const DEFAULT_SHEETS = {
  students: 'Students',
  pickups: 'Pickups',
  communities: 'Communities',
  settings: 'Settings'
};

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const body = parseBody_(e);
    const request = Object.assign({}, params, body);
    const action = request.action || 'health';

    if (action === 'health') return json_({ success: true, message: 'Carpool API is running' });
    if (action === 'setup') return setupSheets_(request);
    if (action === 'validatePin') return validatePin_(request);
    requirePin_(request);
    if (action === 'getSettings') return getSettings_(request);
    if (action === 'saveSettings') return saveSettings_(request);
    if (action === 'getStudents') return getStudents_(request);
    if (action === 'getCommunities') return getCommunities_(request);
    if (action === 'getAppData') return getAppData_(request);
    if (action === 'createPickup') return createPickup_(request);
    if (action === 'getPickups') return getPickups_(request);
    if (action === 'dismissPickup') return updatePickupStatus_(request, 'dismissed');
    if (action === 'cancelPickup') return updatePickupStatus_(request, 'cancelled');
    if (action === 'restorePickup') return updatePickupStatus_(request, 'queued');

    return json_({ success: false, error: 'Invalid action: ' + action });
  } catch (error) {
    return json_({ success: false, error: error.toString(), stack: error.stack || '' });
  }
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    return {};
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet_(request) {
  if (!request.spreadsheetId) throw new Error('Missing spreadsheetId');
  return SpreadsheetApp.openById(request.spreadsheetId);
}

function sheetName_(request, key) {
  return request[key + 'Sheet'] || request[key + 'SheetName'] || DEFAULT_SHEETS[key];
}

function getSheet_(ss, name, required) {
  const sheet = ss.getSheetByName(name);
  if (!sheet && required !== false) {
    throw new Error('Sheet not found: ' + name + '. Available sheets: ' + ss.getSheets().map(s => s.getName()).join(', '));
  }
  return sheet;
}

function setupSheets_(request) {
  const ss = getSpreadsheet_(request);
  ensureSheet_(ss, sheetName_(request, 'students'), ['Card Number', 'Student Name', 'Community', 'Grade', 'Active']);
  ensureSheet_(ss, sheetName_(request, 'pickups'), ['Timestamp', 'Card Number', 'Row', 'Student Name', 'Submission ID', 'Status', 'Submitted By', 'Device']);
  ensureSheet_(ss, sheetName_(request, 'communities'), ['Community', 'Background Color', 'Text Color', 'Sort Order', 'Active']);
  ensureSheet_(ss, sheetName_(request, 'settings'), ['Key', 'Value']);
  seedCommunities_(ss, sheetName_(request, 'communities'));
  seedSettings_(ss, sheetName_(request, 'settings'));
  return json_({ success: true, message: 'Sheets are ready. Default PIN is 2025 until you change Settings > AppPin.' });
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else {
    const existing = sheet.getRange(1, 1, 1, Math.max(headers.length, sheet.getLastColumn())).getValues()[0];
    if (!existing[0]) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function seedCommunities_(ss, name) {
  const sheet = getSheet_(ss, name);
  if (sheet.getLastRow() > 1) return;
  sheet.getRange(2, 1, 7, 5).setValues([
    ['SH', '#FF6B00', '#FFFFFF', 1, 'TRUE'],
    ['NG', '#00C851', '#FFFFFF', 2, 'TRUE'],
    ['MA', '#FFD700', '#000000', 3, 'TRUE'],
    ['ZNH', '#616161', '#FFFFFF', 4, 'TRUE'],
    ['RF', '#2196F3', '#FFFFFF', 5, 'TRUE'],
    ['EG', '#DC143C', '#FFFFFF', 6, 'TRUE'],
    ['UNKNOWN', '#667EEA', '#FFFFFF', 99, 'TRUE']
  ]);
}


function seedSettings_(ss, name) {
  const sheet = getSheet_(ss, name);
  const existing = readSettingsMap_(sheet);
  if (!existing.AppPin) sheet.appendRow(['AppPin', '2025']);
}

function readSettingsMap_(sheet) {
  const settings = {};
  if (sheet && sheet.getLastRow() > 1) {
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    rows.forEach(row => {
      if (row[0]) settings[String(row[0]).trim()] = row[1];
    });
  }
  return settings;
}

function validatePin_(request) {
  const ss = getSpreadsheet_(request);
  const sheet = getSheet_(ss, sheetName_(request, 'settings'), false);
  const settings = readSettingsMap_(sheet);
  const expected = String(settings.AppPin || '2025').trim();
  const actual = String(request.pin || '').trim();
  if (actual && actual === expected) return json_({ success: true, message: 'PIN accepted' });
  return json_({ success: false, error: 'Invalid PIN' });
}

function requirePin_(request) {
  const ss = getSpreadsheet_(request);
  const sheet = getSheet_(ss, sheetName_(request, 'settings'), false);
  const settings = readSettingsMap_(sheet);
  const expected = String(settings.AppPin || '2025').trim();
  const actual = String(request.pin || '').trim();
  if (!actual || actual !== expected) throw new Error('Unauthorized');
}

function saveSettings_(request) {
  const ss = getSpreadsheet_(request);
  const sheet = getSheet_(ss, sheetName_(request, 'settings'));
  const incoming = JSON.parse(request.settingsJson || '{}');
  Object.keys(incoming).forEach(key => upsertSetting_(sheet, key, incoming[key]));
  return json_({ success: true, message: 'Settings saved' });
}

function upsertSetting_(sheet, key, value) {
  const last = sheet.getLastRow();
  if (last > 1) {
    const keys = sheet.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0] || '').trim());
    const index = keys.indexOf(key);
    if (index >= 0) {
      sheet.getRange(index + 2, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function getSettings_(request) {
  const ss = getSpreadsheet_(request);
  const sheet = getSheet_(ss, sheetName_(request, 'settings'), false);
  const settings = readSettingsMap_(sheet);
  delete settings.AppPin;
  return json_({ success: true, settings });
}

function getStudents_(request) {
  const ss = getSpreadsheet_(request);
  const sheet = getSheet_(ss, sheetName_(request, 'students'));
  const rows = sheet.getDataRange().getValues();
  const students = [];
  for (let i = 1; i < rows.length; i++) {
    const cardNumber = rows[i][0];
    const name = rows[i][1];
    const active = rows[i][4];
    if (!cardNumber || !name) continue;
    if (String(active).toLowerCase() === 'false' || String(active).toLowerCase() === 'no') continue;
    students.push({
      number: String(cardNumber),
      name: String(name),
      community: String(rows[i][2] || 'UNKNOWN'),
      grade: String(rows[i][3] || '')
    });
  }
  return json_({ success: true, students });
}

function getCommunities_(request) {
  const ss = getSpreadsheet_(request);
  const sheet = getSheet_(ss, sheetName_(request, 'communities'), false);
  const communities = {};
  if (!sheet || sheet.getLastRow() < 2) return json_({ success: true, communities });
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  rows.forEach(row => {
    const name = String(row[0] || '').trim();
    if (!name) return;
    const active = String(row[4] || 'TRUE').toLowerCase();
    if (active === 'false' || active === 'no') return;
    communities[name] = {
      name: name,
      backgroundColor: String(row[1] || '#667EEA'),
      textColor: String(row[2] || '#FFFFFF'),
      sortOrder: Number(row[3] || 99)
    };
  });
  return json_({ success: true, communities });
}

function getAppData_(request) {
  const studentsResponse = JSON.parse(getStudents_(request).getContent());
  const communitiesResponse = JSON.parse(getCommunities_(request).getContent());
  return json_({
    success: true,
    students: studentsResponse.students || [],
    communities: communitiesResponse.communities || {}
  });
}

function createPickup_(request) {
  const ss = getSpreadsheet_(request);
  const sheet = getSheet_(ss, sheetName_(request, 'pickups'));
  const submissionId = Utilities.getUuid();
  const timestamp = new Date();
  const row = [
    timestamp,
    request.cardNumber || request.number || '',
    request.rowType || request.row || '',
    request.studentName || request.name || 'Unknown',
    submissionId,
    'queued',
    request.submittedBy || '',
    request.device || ''
  ];
  sheet.appendRow(row);
  return json_({ success: true, pickup: pickupObject_(row), message: 'Pickup created' });
}

function getPickups_(request) {
  const ss = getSpreadsheet_(request);
  const sheet = getSheet_(ss, sheetName_(request, 'pickups'));
  const rows = sheet.getDataRange().getValues();
  const statusFilter = request.status || 'active';
  const limit = Number(request.limit || 75);
  const pickups = [];
  for (let i = Math.max(1, rows.length - 250); i < rows.length; i++) {
    const row = rows[i];
    if (!row[4]) continue;
    const pickup = pickupObject_(row);
    pickup.sheetRow = i + 1;
    if (statusFilter === 'active') {
      if (pickup.status !== 'queued' && pickup.status !== 'displayed') continue;
    } else if (statusFilter && statusFilter !== 'all' && pickup.status !== statusFilter) {
      continue;
    }
    pickups.push(pickup);
  }
  pickups.reverse();
  return json_({ success: true, pickups: pickups.slice(0, limit) });
}

function pickupObject_(row) {
  return {
    timestamp: row[0],
    number: String(row[1] || ''),
    rowType: String(row[2] || ''),
    name: String(row[3] || 'Unknown'),
    id: String(row[4] || ''),
    status: String(row[5] || 'queued'),
    submittedBy: String(row[6] || ''),
    device: String(row[7] || '')
  };
}

function updatePickupStatus_(request, status) {
  const ss = getSpreadsheet_(request);
  const sheet = getSheet_(ss, sheetName_(request, 'pickups'));
  const id = request.id || request.submissionId;
  if (!id) throw new Error('Missing pickup id');
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][4]) === String(id)) {
      sheet.getRange(i + 1, 6).setValue(status);
      return json_({ success: true, id: id, status: status });
    }
  }
  return json_({ success: false, error: 'Pickup not found: ' + id });
}
