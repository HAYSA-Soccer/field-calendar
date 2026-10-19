// calendar.js v3 — JSON-driven per-field availability

let availabilityData = null;
let currentDate = null;

const DAY_START_MINUTES = 8 * 60;   // 8:00
const DAY_END_MINUTES = 21 * 60;    // 21:00 (9pm)
const SLOT_MINUTES = 30;            // 30-minute slots

function initCalendar() {
  fetch('data/availability.json')
    .then(res => res.json())
    .then(data => {
      availabilityData = data;
      currentDate = new Date(data.season_start + 'T00:00:00');
      showDay(currentDate);
      updateLastUpdated();
    })
    .catch(err => {
      console.error('Error loading availability.json', err);
      const calendar = document.getElementById('calendar');
      calendar.innerHTML = '<p class="error">Unable to load availability data.</p>';
    });
}

function updateLastUpdated() {
  const el = document.getElementById('lastUpdated');
  if (!el || !availabilityData) return;
  el.textContent = `Season window: ${availabilityData.season_start} to ${availabilityData.season_end}`;
}

function changeDay(offset) {
  if (!currentDate) return;
  currentDate = new Date(currentDate.getTime() + offset * 24 * 60 * 60 * 1000);
  showDay(currentDate);
}

function showDay(dateObj) {
  if (!availabilityData) return;

  const dateStr = formatDateKey(dateObj);
  const dayData = availabilityData.days[dateStr];

  const calendar = document.getElementById('calendar');
  calendar.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'day-header';
  header.textContent = `Day View — ${formatDisplayDate(dateObj)}`;
  calendar.appendChild(header);

  const legend = buildLegend();
  calendar.appendChild(legend);

  if (!dayData) {
    const msg = document.createElement('p');
    msg.className = 'no-data';
    msg.textContent = 'No data for this date.';
    calendar.appendChild(msg);
    return;
  }

  const fieldsById = buildFieldIndex(dayData.fields);
  const parentChild = buildParentChildMap(dayData.fields);
  const complexes = Object.keys(dayData.complexes || {});
  const complexFields = dayData.complexes;

  const slots = buildTimeSlots();
  const busyMap = buildBusyMap(dayData.complex_timeline, slots);

  const grid = document.createElement('div');
  grid.className = 'day-grid';

  // Time column
  const timeCol = document.createElement('div');
  timeCol.className = 'time-column';

  slots.forEach(slot => {
    const timeCell = document.createElement('div');
    timeCell.className = 'time-cell';
    timeCell.textContent = slot.label;
    timeCol.appendChild(timeCell);
  });

  grid.appendChild(timeCol);

  // Complex columns
  complexes.forEach(complexId => {
    const complexCol = document.createElement('div');
    complexCol.className = 'complex-column';

    const complexHeader = document.createElement('div');
    complexHeader.className = 'complex-header';
    complexHeader.textContent = complexId;
    complexCol.appendChild(complexHeader);

    const fieldsInComplex = complexFields[complexId] || [];

    slots.forEach((slot, idx) => {
      const cell = document.createElement('div');
      cell.className = 'complex-cell';

      const slotBusy = busyMap[complexId] && busyMap[complexId][idx]
        ? busyMap[complexId][idx]
        : { game_fields: [], practice_fields: [], admin_fields: [] };

      // Expand busy fields with parent/child relationships
      const expandedBusy = expandBusyFields(slotBusy, parentChild);

      const busySet = new Set([
        ...expandedBusy.game_fields,
        ...expandedBusy.practice_fields,
        ...expandedBusy.admin_fields
      ]);

      const freeFields = fieldsInComplex.filter(fid => !busySet.has(fid));

      // Admin block
      if (expandedBusy.admin_fields.length > 0) {
        const block = document.createElement('div');
        block.className = 'block block-admin';
        block.textContent = 'Admin: ' + expandedBusy.admin_fields
          .map(fid => fieldsById[fid]?.name || fid)
          .join(', ');
        cell.appendChild(block);
      }

      // Game block
      if (expandedBusy.game_fields.length > 0) {
        const block = document.createElement('div');
        block.className = 'block block-game';
        block.textContent = 'Game: ' + expandedBusy.game_fields
          .map(fid => fieldsById[fid]?.name || fid)
          .join(', ');
        cell.appendChild(block);
      }

      // Practice block
      if (expandedBusy.practice_fields.length > 0) {
        const block = document.createElement('div');
        block.className = 'block block-practice';
        block.textContent = 'Practice: ' + expandedBusy.practice_fields
          .map(fid => fieldsById[fid]?.name || fid)
          .join(', ');
        cell.appendChild(block);
      }

      // Availability block
      if (freeFields.length > 0) {
        const block = document.createElement('div');
        block.className = 'block block-available';
        block.textContent = 'Available: ' + freeFields
          .map(fid => fieldsById[fid]?.name || fid)
          .join(', ');
        cell.appendChild(block);
      }

      complexCol.appendChild(cell);
    });

    grid.appendChild(complexCol);
  });

  calendar.appendChild(grid);
}

// ---------- Helpers ----------

function formatDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDisplayDate(d) {
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric'
  });
}

function buildLegend() {
  const legend = document.createElement('div');
  legend.className = 'legend';

  const items = [
    { cls: 'block-game', label: 'Game' },
    { cls: 'block-practice', label: 'Practice' },
    { cls: 'block-admin', label: 'Admin Block' },
    { cls: 'block-available', label: 'Available' }
  ];

  items.forEach(item => {
    const entry = document.createElement('div');
    entry.className = 'legend-item';

    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch ' + item.cls;

    const text = document.createElement('span');
    text.className = 'legend-label';
    text.textContent = item.label;

    entry.appendChild(swatch);
    entry.appendChild(text);
    legend.appendChild(entry);
  });

  return legend;
}

function buildFieldIndex(fields) {
  const map = {};
  fields.forEach(f => {
    map[f.id] = f;
  });
  return map;
}

function buildParentChildMap(fields) {
  const ids = fields.map(f => f.id);
  const parentToChildren = {};
  const childToParent = {};

  ids.forEach(id => {
    const parent = inferParentId(id, ids);
    if (parent) {
      childToParent[id] = parent;
      if (!parentToChildren[parent]) parentToChildren[parent] = [];
      parentToChildren[parent].push(id);
    }
  });

  return { parentToChildren, childToParent };
}

function inferParentId(id, allIds) {
  // Case 1: ends with A/B → parent is base without last char
  if (id.endsWith('A') || id.endsWith('B')) {
    const base = id.slice(0, -1);
    if (allIds.includes(base)) return base;
  }

  // Case 2: ends with digits → parent is base without trailing digits
  const m = id.match(/^(.*?)(\d+)$/);
  if (m) {
    const base = m[1];
    if (allIds.includes(base)) return base;
  }

  return null;
}

function buildTimeSlots() {
  const slots = [];
  for (let t = DAY_START_MINUTES; t < DAY_END_MINUTES; t += SLOT_MINUTES) {
    const start = t;
    const end = t + SLOT_MINUTES;
    slots.push({
      start,
      end,
      label: formatTimeLabel(start)
    });
  }
  return slots;
}

function formatTimeLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayHour = ((h + 11) % 12) + 1; // 0→12, 13→1, etc.
  const displayMin = String(m).padStart(2, '0');
  return `${displayHour}:${displayMin} ${ampm}`;
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function buildBusyMap(complexTimeline, slots) {
  const map = {};

  if (!complexTimeline) return map;

  Object.keys(complexTimeline).forEach(complexId => {
    const intervals = complexTimeline[complexId] || [];
    map[complexId] = {};

    intervals.forEach(interval => {
      const startMin = timeToMinutes(interval.start);
      const endMin = timeToMinutes(interval.end);

      slots.forEach((slot, idx) => {
        const slotStart = slot.start;
        const slotEnd = slot.end;

        // Overlap?
        if (slotStart < endMin && slotEnd > startMin) {
          if (!map[complexId][idx]) {
            map[complexId][idx] = {
              game_fields: [],
              practice_fields: [],
              admin_fields: []
            };
          }

          const entry = map[complexId][idx];

          (interval.game_fields || []).forEach(fid => {
            if (!entry.game_fields.includes(fid)) entry.game_fields.push(fid);
          });
          (interval.practice_fields || []).forEach(fid => {
            if (!entry.practice_fields.includes(fid)) entry.practice_fields.push(fid);
          });
          (interval.admin_fields || []).forEach(fid => {
            if (!entry.admin_fields.includes(fid)) entry.admin_fields.push(fid);
          });
        }
      });
    });
  });

  return map;
}

function expandBusyFields(slotBusy, parentChild) {
  const { parentToChildren, childToParent } = parentChild;

  const game = new Set(slotBusy.game_fields || []);
  const practice = new Set(slotBusy.practice_fields || []);
  const admin = new Set(slotBusy.admin_fields || []);

  const allBusy = new Set([...game, ...practice, ...admin]);

  // If parent busy → children busy
  allBusy.forEach(fid => {
    const children = parentToChildren[fid];
    if (children && children.length) {
      children.forEach(ch => allBusy.add(ch));
    }
  });

  // If child busy → parent busy
  allBusy.forEach(fid => {
    const parent = childToParent[fid];
    if (parent) {
      allBusy.add(parent);
    }
  });

  // Rebuild per-type arrays respecting expanded busy set
  const expandedGame = [...allBusy].filter(fid => game.has(fid));
  const expandedPractice = [...allBusy].filter(fid => practice.has(fid));
  const expandedAdmin = [...allBusy].filter(fid => admin.has(fid));

  return {
    game_fields: expandedGame,
    practice_fields: expandedPractice,
    admin_fields: expandedAdmin
  };
}

// Week / Month stubs (to be implemented later)
function showWeek(dateObj) {
  alert('Week view not implemented yet. Focus is on perfect Day view.');
}

function showMonth(dateObj) {
  alert('Month view not implemented yet. Focus is on perfect Day view.');
}
