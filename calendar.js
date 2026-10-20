// ===============================
//  CLEAN FINAL CALENDAR ENGINE
//  Horizontal Lanes + Friendly Names
// ===============================

let availabilityData = null;
let currentDate = null;

const DAY_START = 8 * 60;   // 8:00 AM
const DAY_END   = 21 * 60;  // 9:00 PM
const SLOT      = 30;       // 30-minute increments

// -------------------------------
// INIT
// -------------------------------
function initCalendar() {
  fetch("data/availability.json")
    .then(r => r.json())
    .then(data => {
      availabilityData = data;
      currentDate = new Date(data.season_start + "T00:00:00");
      showDay(currentDate);
    })
    .catch(err => console.error("Failed to load availability.json", err));
}

// -------------------------------
// DATE HELPERS
// -------------------------------
function dateKey(d) {
  return d.toISOString().split("T")[0];
}

function displayDate(d) {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric"
  });
}

function changeDay(offset) {
  currentDate = new Date(currentDate.getTime() + offset * 86400000);
  showDay(currentDate);
}

// -------------------------------
// TIME SLOTS
// -------------------------------
function buildSlots() {
  const slots = [];
  for (let t = DAY_START; t < DAY_END; t += SLOT) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    const ampm = h >= 12 ? "PM" : "AM";
    const hh = ((h + 11) % 12) + 1;
    const mm = String(m).padStart(2, "0");
    slots.push({
      start: t,
      end: t + SLOT,
      label: `${hh}:${mm} ${ampm}`
    });
  }
  return slots;
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// -------------------------------
// FIELD MAP + PARENT/CHILD
// -------------------------------
function buildFieldIndex(fields) {
  const map = {};
  fields.forEach(f => map[f.id] = f);
  return map;
}

function inferParent(id, allIds) {
  // SUMNER: A/B → parent is base without last char
  if (id.endsWith("A") || id.endsWith("B")) {
    const base = id.slice(0, -1);
    if (allIds.includes(base)) return base;
  }
  // TURF: numeric suffix → parent is base without digits
  const m = id.match(/^(.*?)(\d+)$/);
  if (m) {
    const base = m[1];
    if (allIds.includes(base)) return base;
  }
  return null;
}

function buildParentChildMap(fields) {
  const ids = fields.map(f => f.id);
  const parentToChildren = {};
  const childToParent = {};

  ids.forEach(id => {
    const parent = inferParent(id, ids);
    if (parent) {
      childToParent[id] = parent;
      if (!parentToChildren[parent]) parentToChildren[parent] = [];
      parentToChildren[parent].push(id);
    }
  });

  return { parentToChildren, childToParent };
}

// -------------------------------
// BUSY MAP
// -------------------------------
function buildBusyMap(complexTimeline, slots) {
  const map = {};

  Object.keys(complexTimeline).forEach(complex => {
    map[complex] = {};

    complexTimeline[complex].forEach(interval => {
      const start = toMinutes(interval.start);
      const end   = toMinutes(interval.end);

      slots.forEach((slot, idx) => {
        if (slot.start < end && slot.end > start) {
          if (!map[complex][idx]) {
            map[complex][idx] = {
              game: [],
              practice: [],
              admin: []
            };
          }
          interval.game_fields?.forEach(f => map[complex][idx].game.push(f));
          interval.practice_fields?.forEach(f => map[complex][idx].practice.push(f));
          interval.admin_fields?.forEach(f => map[complex][idx].admin.push(f));
        }
      });
    });
  });

  return map;
}

// -------------------------------
// EXPAND BUSY (parent/child logic)
// -------------------------------
function expandBusy(slotBusy, parentChild) {
  const { parentToChildren, childToParent } = parentChild;

  const busy = new Set([
    ...slotBusy.game,
    ...slotBusy.practice,
    ...slotBusy.admin
  ]);

  // Parent busy → children busy
  busy.forEach(id => {
    const kids = parentToChildren[id];
    if (kids) kids.forEach(k => busy.add(k));
  });

  // Child busy → parent busy
  busy.forEach(id => {
    const parent = childToParent[id];
    if (parent) busy.add(parent);
  });

  return busy;
}

// -------------------------------
// COLLAPSE FREE FIELDS (THE FIX)
// -------------------------------
function collapseFreeFields(freeFields, parentChild, busySet, fieldsById) {
  const { parentToChildren, childToParent } = parentChild;

  const collapsed = [];

  freeFields.forEach(f => {
    const id = f.id;
    const parent = childToParent[id];
    const children = parentToChildren[id] || [];

    // CASE 1: Parent with NO children → Full field
    if (!parent && children.length === 0) {
      collapsed.push(f);
      return;
    }

    // CASE 2: Parent with children
    if (children.length > 0) {
      const allFree = children.every(k => !busySet.has(k));
      if (allFree) {
        // Parent only (A & B or 1 & 2)
        collapsed.push(f);
      }
      return;
    }

    // CASE 3: Child field
    if (parent) {
      const siblings = parentToChildren[parent];
      const allFree = siblings.every(k => !busySet.has(k));

      if (!allFree) {
        // Only show child if NOT all siblings free
        collapsed.push(f);
      }
    }
  });

  return collapsed;
}


// -------------------------------
// FRIENDLY NAME
// -------------------------------
function friendlyName(field, parentToChildren, busySet, fieldsById) {
  const id = field.id;
  const name = field.name;

  const children = parentToChildren[id] || [];

  // CASE 1: Parent with NO children → Full field
  if (children.length === 0) {
    return `${name} (Full)`;
  }

  // CASE 2: Parent with children
  const freeKids = children.filter(k => !busySet.has(k));

  if (freeKids.length === children.length) {
    // All children free → grouped parent
    const suffix = children[0].endsWith("A") || children[0].endsWith("B")
      ? "(A & B)"
      : "(1 & 2)";
    return `${name} ${suffix}`;
  }

  if (freeKids.length === 1) {
    // Only one child free → show child name
    return fieldsById[freeKids[0]].name;
  }

  // No children free → parent not free
  return null;
}


// -------------------------------
// MERGE BLOCKS
// -------------------------------
function mergeBlocks(rows) {
  const merged = [];
  let current = null;

  // Build a signature based ONLY on collapsed free-field IDs per complex
  const availabilitySignature = (row) => {
    const sig = {};
    Object.keys(row.blocks).forEach(complex => {
      const availBlock = row.blocks[complex].find(b => b.type === "available");
      // Use raw IDs instead of friendly names to avoid false differences
      sig[complex] = availBlock ? availBlock.fields.join("|") : "NONE";
    });
    return JSON.stringify(sig);
  };

  rows.forEach(r => {
    const sig = availabilitySignature(r);

    if (!current) {
      current = { start: r.start, end: r.end, blocks: r.blocks, sig };
    } else if (current.sig === sig) {
      // Availability unchanged → extend block
      current.end = r.end;
    } else {
      // Availability changed → push block and start new one
      merged.push(current);
      current = { start: r.start, end: r.end, blocks: r.blocks, sig };
    }
  });

  if (current) merged.push(current);
  return merged;
}


function timeRangeLabel(start, end) {
  const fmt = t => {
    const h = Math.floor(t / 60);
    const m = t % 60;
    const ampm = h >= 12 ? "PM" : "AM";
    const hh = ((h + 11) % 12) + 1;
    const mm = String(m).padStart(2, "0");
    return `${hh}:${mm} ${ampm}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

// -------------------------------
// RENDER DAY
// -------------------------------
function showDay(dateObj) {
  const key = dateKey(dateObj);
  const day = availabilityData.days[key];

  const calendar = document.getElementById("calendar");
  calendar.innerHTML = "";

  const header = document.createElement("h2");
  header.textContent = `Day View — ${displayDate(dateObj)}`;
  calendar.appendChild(header);

  if (!day) {
    calendar.innerHTML += "<p>No data for this date.</p>";
    return;
  }

  const fieldsById = buildFieldIndex(day.fields);
  const parentChild = buildParentChildMap(day.fields);
  const slots = buildSlots();
  const busyMap = buildBusyMap(day.complex_timeline, slots);

  const complexes = Object.keys(day.complexes);

  const rows = slots.map((slot, idx) => {
    const rowBlocks = {};

    complexes.forEach(complex => {
      const complexFields = day.complexes[complex];
      const slotBusy = busyMap[complex]?.[idx] || { game: [], practice: [], admin: [] };
      const busySet = expandBusy(slotBusy, parentChild);

      const rawFreeFields = complexFields
        .filter(fid => !busySet.has(fid))
        .map(fid => fieldsById[fid]);

      const collapsedFree = collapseFreeFields(rawFreeFields, parentChild, busySet, fieldsById);

      const friendlyAvail = collapsedFree
        .map(f => friendlyName(f, parentChild.parentToChildren, busySet, fieldsById))
        .filter(Boolean)
        .sort();

      const blocks = [];

      if (slotBusy.admin.length > 0) {
        blocks.push({
          type: "admin",
          label: "Admin",
          fields: slotBusy.admin.map(fid => fieldsById[fid].name)
        });
      }
      if (slotBusy.game.length > 0) {
        blocks.push({
          type: "game",
          label: "Game",
          fields: slotBusy.game.map(fid => fieldsById[fid].name)
        });
      }
      if (slotBusy.practice.length > 0) {
        blocks.push({
          type: "practice",
          label: "Practice",
          fields: slotBusy.practice.map(fid => fieldsById[fid].name)
        });
      }
      if (friendlyAvail.length > 0) {
        blocks.push({
          type: "available",
          label: "Available",
          fields: friendlyAvail
        });
      }

      rowBlocks[complex] = blocks;
    });

    return {
      start: slot.start,
      end: slot.end,
      blocks: rowBlocks
    };
  });

  const merged = mergeBlocks(rows);

  merged.forEach(r => {
    const row = document.createElement("div");
    row.className = "lane-row";

    const timeCol = document.createElement("div");
    timeCol.className = "lane-time";
    timeCol.textContent = timeRangeLabel(r.start, r.end);
    row.appendChild(timeCol);

    complexes.forEach(complex => {
      const col = document.createElement("div");
      col.className = "lane-complex";

      const title = document.createElement("div");
      title.className = "complex-title";
      title.textContent = complex;
      col.appendChild(title);

      r.blocks[complex].forEach(b => {
        const block = document.createElement("div");
        block.className = `block block-${b.type}`;
        block.textContent = `${b.label}: ${b.fields.join(", ")}`;
        col.appendChild(block);
      });

      row.appendChild(col);
    });

    calendar.appendChild(row);
  });
}
