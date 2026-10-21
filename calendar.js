const DAY_START = 8 * 60;
const DAY_END   = 21 * 60;
const SLOT_SIZE = 30;

function parseTime(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function fmt(mins) {
  let h = Math.floor(mins / 60);
  let m = mins % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  h = (h % 12) || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${suffix}`;
}

function fmtRange(start, end) {
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
  day.fields.forEach(f => map[f.id] = f);
  return map;
}

function buildSlots() {
  const slots = [];
  for (let t = DAY_START; t < DAY_END; t += SLOT_SIZE) {
    slots.push({ start: t, end: t + SLOT_SIZE });
  }
  return slots;
}

function getSlotState(day, fieldMap, complexName, slot) {
  const fieldIds = day.complexes[complexName];
  const slotStart = slot.start;
  const slotEnd   = slot.end;

  const booked = [];
  const free   = [];

  // EVENTS (from merged)
  (day.merged || []).forEach(b => {
    const f = fieldMap[b.field];
    if (!f || f.complex !== complexName) return;

    const bs = parseTime(b.start);
    const be = parseTime(b.end);
    if (!overlaps(bs, be, slotStart, slotEnd)) return;

    if (b.type !== "free") {
      booked.push({
        fieldId: b.field,
        fieldName: f.name,
        title: b.title,
        type: b.type,
        start: bs,
        end: be
      });
    }
  });

  // AVAILABILITY
  fieldIds.forEach(fid => {
    const f = fieldMap[fid];
    const ranges = day.availability[fid] || [];

    const isFree = ranges.some(r => {
      const rs = parseTime(r.start);
      const re = parseTime(r.end);
      return overlaps(rs, re, slotStart, slotEnd);
    });

    const isBooked = booked.some(b => b.fieldId === fid);

    if (isFree && !isBooked) {
      free.push({
        fieldId: fid,
        fieldName: f.name
      });
    }
  });

  return { booked, free };
}

function renderDayCalendar(day) {
  const container = document.getElementById("calendar");
  container.innerHTML = "";

  const fieldMap = buildFieldMap(day);
  const slots = buildSlots();

  Object.keys(day.complexes).forEach(complexName => {
    container.appendChild(renderComplex(day, fieldMap, complexName, slots));
  });
}

function renderComplex(day, fieldMap, complexName, slots) {
  const div = document.createElement("div");
  div.className = "complex";

  const header = document.createElement("div");
  header.className = "complex-header";
  header.textContent = complexName;
  div.appendChild(header);

  const timeline = document.createElement("div");
  timeline.className = "timeline";

  slots.forEach(slot => {
    const row = document.createElement("div");
    row.className = "time-row";

    const timeCell = document.createElement("div");
    timeCell.className = "time-cell";
    timeCell.textContent = fmtRange(slot.start, slot.end);
    row.appendChild(timeCell);

    const blocksRow = document.createElement("div");
    blocksRow.className = "blocks-row";

    const { booked, free } = getSlotState(day, fieldMap, complexName, slot);

    // EVENTS LEFT
    const eventsCell = document.createElement("div");
    eventsCell.className = "events-cell";

    booked.forEach(b => {
      const div = document.createElement("div");
      div.className = "block event-block";
      div.classList.add(b.type);

      div.innerHTML = `
        <div class="block-title">${b.title}</div>
        <div class="block-fields">${b.fieldName}</div>
      `;

      eventsCell.appendChild(div);
    });

    // AVAILABILITY RIGHT
    const availCell = document.createElement("div");
    availCell.className = "avail-cell";

    if (free.length > 0) {
      const div = document.createElement("div");
      div.className = "block avail-block free";

      div.innerHTML = `
        <div class="block-title">Available</div>
        <div class="block-fields">${free.map(f => f.fieldName).join(", ")}</div>
      `;

      availCell.appendChild(div);
    }

    blocksRow.appendChild(eventsCell);
    blocksRow.appendChild(availCell);

    row.appendChild(blocksRow);
    timeline.appendChild(row);
  });

  div.appendChild(timeline);
  return div;
}
