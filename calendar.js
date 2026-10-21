const DAY_START = 8 * 60;
const DAY_END   = 21 * 60;
const SLOT_SIZE = 30; // minutes

function parseTime(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function formatTimeRange(start, end) {
  function fmt(mins) {
    let h = Math.floor(mins / 60);
    let m = mins % 60;
    const suffix = h >= 12 ? "PM" : "AM";
    h = (h % 12) || 12;
    return `${h}:${m.toString().padStart(2, "0")} ${suffix}`;
  }
  return `${fmt(start)} – ${fmt(end)}`;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

async function loadDay(dateStr) {
  const url = `data/day/${dateStr}.json`;
  const container = document.getElementById("calendar");

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const day = await res.json();
    renderDayCalendar(day);
  } catch (e) {
    container.innerHTML = "";
    container.textContent = `Unable to load data for ${dateStr}: ${e.message}`;
  }
}

function buildFieldMap(day) {
  const map = {};
  (day.fields || []).forEach(f => {
    map[f.id] = f;
  });
  return map;
}

function isFullField(fieldObj) {
  return fieldObj && fieldObj.name && fieldObj.name.includes("(Full)");
}

function buildSlots() {
  const slots = [];
  for (let t = DAY_START; t < DAY_END; t += SLOT_SIZE) {
    slots.push({ start: t, end: t + SLOT_SIZE });
  }
  return slots;
}

// For a given complex + slot, figure out:
// - which fields are booked (events/merged non-free)
// - which fields are available (availability ranges minus booked)
function getComplexStateForSlot(day, fieldMap, complexName, slot) {
  const fieldIds = day.complexes[complexName] || [];
  const slotStart = slot.start;
  const slotEnd   = slot.end;

  const booked = [];
  const free   = [];

  // 1) booked from merged (non-free)
  (day.merged || []).forEach(b => {
    const f = fieldMap[b.field];
    if (!f || f.complex !== complexName) return;
    const bs = parseTime(b.start);
    const be = parseTime(b.end);
    if (!overlaps(bs, be, slotStart, slotEnd)) return;
    if (b.type && b.type !== "free") {
      booked.push({
        fieldId: b.field,
        fieldName: f.name,
        type: b.type,
        title: b.title || "Booked",
        start: bs,
        end: be
      });
    }
  });

  // 2) availability per field
  fieldIds.forEach(fid => {
    const f = fieldMap[fid];
    const ranges = (day.availability && day.availability[fid]) || [];
    const isFree = ranges.some(r => {
      const rs = parseTime(r.start);
      const re = parseTime(r.end);
      return overlaps(rs, re, slotStart, slotEnd);
    });

    const isBooked = booked.some(b => b.fieldId === fid);

    if (isFree && !isBooked) {
      free.push({
        fieldId: fid,
        fieldName: f ? f.name : fid
      });
    }
  });

  return { booked, free };
}

// Merge booked blocks in a slot by title+type+time (side-by-side)
function mergeBookedInSlot(booked) {
  const groups = [];

  booked.forEach(b => {
    const key = `${b.type}|${b.title}|${b.start}|${b.end}`;
    let g = groups.find(x => x.key === key);
    if (!g) {
      g = {
        key,
        type: b.type,
        title: b.title,
        start: b.start,
        end: b.end,
        fields: []
      };
      groups.push(g);
    }
    g.fields.push(b.fieldName);
  });

  return groups;
}

function renderDayCalendar(day) {
  const container = document.getElementById("calendar");
  container.innerHTML = "";

  const fieldMap = buildFieldMap(day);
  const slots = buildSlots();
  const complexes = day.complexes || {};

  Object.keys(complexes).forEach(complexName => {
    const complexEl = renderComplex(day, fieldMap, complexName, slots);
    container.appendChild(complexEl);
  });
}

function renderComplex(day, fieldMap, complexName, slots) {
  const complexDiv = document.createElement("div");
  complexDiv.className = "complex";

  const header = document.createElement("div");
  header.className = "complex-header";
  header.textContent = complexName;
  complexDiv.appendChild(header);

  const timeline = document.createElement("div");
  timeline.className = "timeline";

  slots.forEach(slot => {
    const row = document.createElement("div");
    row.className = "time-row";

    const timeCell = document.createElement("div");
    timeCell.className = "time-cell";
    timeCell.textContent = formatTimeRange(slot.start, slot.end);
    row.appendChild(timeCell);

    const blocksRow = document.createElement("div");
    blocksRow.className = "blocks-row";

    const { booked, free } = getComplexStateForSlot(day, fieldMap, complexName, slot);
    const mergedBooked = mergeBookedInSlot(booked);

    const eventsCell = document.createElement("div");
    eventsCell.className = "events-cell";

    mergedBooked.forEach(b => {
      const div = document.createElement("div");
      div.className = "block event-block";
      div.classList.add(b.type);

      div.innerHTML = `
        <div class="block-title">${b.title}</div>
        <div class="block-time">${formatTimeRange(slot.start, slot.end)}</div>
        <div class="block-fields">${b.fields.join(", ")}</div>
      `;

      eventsCell.appendChild(div);
    });

    const availCell = document.createElement("div");
    availCell.className = "avail-cell";

    if (free.length > 0) {
      const div = document.createElement("div");
      div.className = "block avail-block free";

      div.innerHTML = `
        <div class="block-title">Available</div>
        <div class="block-time">${formatTimeRange(slot.start, slot.end)}</div>
        <div class="block-fields">${free.map(f => f.fieldName).join(", ")}</div>
      `;

      availCell.appendChild(div);
    }

    blocksRow.appendChild(eventsCell);
    blocksRow.appendChild(availCell);

    row.appendChild(blocksRow);
    timeline.appendChild(row);
  });

  complexDiv.appendChild(timeline);
  return complexDiv;
}
