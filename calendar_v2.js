/********************************************************************
 * CONSTANTS
 ********************************************************************/
const DAY_START = 8 * 60;
const DAY_END   = 21 * 60;
const PX_PER_MIN = 1;

/********************************************************************
 * GLOBAL REFRESH BANNER
 ********************************************************************/
async function loadGlobalRefreshBanner() {
  const banner = document.getElementById("global-refresh-banner");
  if (!banner) return;

  try {
    const res = await fetch("data/last_updated.json");
    if (!res.ok) throw new Error("Missing last_updated.json");

    const data = await res.json();
    const ts = data.last_successful_update;

    banner.textContent = ts
      ? `Note: Unless otherwise noted, the information below was last updated on: ${ts}.`
      : `Note: Unless otherwise noted, the information below has no prior updated details.`;

    window.lastUpdatedData = data;
  } catch (e) {
    banner.textContent =
      "Note: Unless otherwise noted, the information below has no prior updated details.";
    window.lastUpdatedData = { last_successful_update: null };
  }
}

/********************************************************************
 * DAY LABEL
 ********************************************************************/
function updateDayLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const dayName = d.toLocaleDateString("en-US", { weekday: "long" });
  const pretty = d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  const el = document.getElementById("day-label");
  if (el) el.textContent = `${dayName}, ${pretty}`;
}

/********************************************************************
 * TIME HELPERS
 ********************************************************************/
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

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/********************************************************************
 * LOAD DAY
 ********************************************************************/
async function loadDay(dateStr) {
  const url = `data/day/${dateStr}.json`;
  const container = document.getElementById("calendar");
  container.innerHTML = "";

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const day = await res.json();
    renderDayCalendar(day);
  } catch (e) {
    container.innerHTML =
      `<div class="update-note">No stored data exists for this date.</div>`;
  }
}

/********************************************************************
 * FIELD MAP
 ********************************************************************/
function buildFieldMap(day) {
  const map = {};
  day.fields.forEach(f => map[f.id] = f);
  return map;
}

/********************************************************************
 * BUILD BLOCKS — USING REAL FIELD IDs
 ********************************************************************/
function buildBlocks(day, fieldMap) {
  const blocks = [];

  (day.merged || []).forEach(b => {
    const fieldId = b.field;
    const f = fieldMap[fieldId];
    if (!f) return;

    blocks.push({
      complex: f.complex,
      fieldId: f.id,
      fieldName: f.id,
      start: parseTime(b.start),
      end: parseTime(b.end),
      type: b.type,
      title: b.title || (b.type === "free" ? "Available" : "Booked")
    });
  });

  return blocks;
}

/********************************************************************
 * CONFLICT DETECTION — REAL FIELD IDs
 ********************************************************************/
function detectConflicts(blocks) {
  const byField = {};

  blocks.forEach(b => {
    if (!byField[b.fieldId]) byField[b.fieldId] = [];
    byField[b.fieldId].push(b);
  });

  Object.values(byField).forEach(list => {
    list.sort((a, b) => a.start - b.start);

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i];
        const B = list[j];

        if (B.start >= A.end) break;

        const overlap = A.end > B.start;
        if (!overlap) continue;

        const A_isAdmin = A.type === "admin";
        const B_isAdmin = B.type === "admin";

        if (A_isAdmin && B_isAdmin) continue;

        if (A_isAdmin && !B_isAdmin) {
          B.conflict = true;
          continue;
        }

        if (!A_isAdmin && B_isAdmin) {
          A.conflict = true;
          continue;
        }

        A.conflict = true;
        B.conflict = true;
      }
    }
  });

  return blocks;
}

/********************************************************************
 * BUILD AVAILABILITY — TRUST BACKEND JSON
 ********************************************************************/
function buildAvailability(day, fieldMap, blocks) {
  const avail = [];

  Object.keys(day.complexes).forEach(complex => {
    const fields = day.complexes[complex];

    const timeline = [];
    for (let t = DAY_START; t < DAY_END; t++) {
      const bookedFields = new Set();

      blocks.forEach(b => {
        if (b.complex !== complex) return;
        if (b.type === "free") return;
        if (t >= b.start && t < b.end) {
          bookedFields.add(b.fieldId);
        }
      });

      const freeFields = [];

      fields.forEach(fid => {
        const ranges = day.availability[fid] || [];
        const isFree = ranges.some(r => {
          const rs = parseTime(r.start);
          const re = parseTime(r.end);
          return t >= rs && t < re;
        });

        if (isFree && !bookedFields.has(fid)) {
          freeFields.push(fid);
        }
      });

      timeline.push({
        minute: t,
        free: freeFields.sort()
      });
    }

    let curStart = null;
    let curFields = null;

    timeline.forEach((slot, idx) => {
      const same = JSON.stringify(slot.free) === JSON.stringify(curFields);

      if (curStart === null) {
        curStart = slot.minute;
        curFields = slot.free;
      } else if (!same) {
        if (curFields && curFields.length > 0) {
          avail.push({
            complex,
            start: curStart,
            end: timeline[idx - 1].minute + 1,
            fields: curFields
          });
        }
        curStart = slot.minute;
        curFields = slot.free;
      }
    });

    if (curStart !== null && curFields && curFields.length > 0) {
      avail.push({
        complex,
        start: curStart,
        end: DAY_END,
        fields: curFields
      });
    }
  });

  return avail;
}

/********************************************************************
 * EVENT LANES — ORIGINAL LOGIC
 ********************************************************************/
function buildEventLanes(blocks) {
  const byComplex = {};
  blocks.forEach(b => {
    if (b.type === "free") return;
    if (!byComplex[b.complex]) byComplex[b.complex] = [];
    byComplex[b.complex].push(b);
  });

  const lanesByComplex = {};

  Object.keys(byComplex).forEach(complex => {
    const list = byComplex[complex].sort((a, b) => a.start - b.start);
    const lanes = [];

    list.forEach(b => {
      let laneIndex = 0;
      while (true) {
        const lane = lanes[laneIndex] || [];
        const conflict = lane.some(e => overlaps(e.start, e.end, b.start, b.end));
        if (!conflict) {
          lane.push(b);
          lanes[laneIndex] = lane;
          break;
        }
        laneIndex++;
      }
    });

    const out = [];
    lanes.forEach((lane, idx) => {
      lane.forEach(b => {
        out.push({
          ...b,
          lane: idx
        });
      });
    });

    lanesByComplex[complex] = out;
  });

  return lanesByComplex;
}

/********************************************************************
 * RENDER DAY CALENDAR
 ********************************************************************/
function renderDayCalendar(day) {
  const dayNote = document.getElementById("day-note");
  const container = document.getElementById("calendar");

  dayNote.innerHTML = "";
  container.innerHTML = "";

  if (!day.updated) {
    const ts =
      day.last_successful_update ||
      (window.lastUpdatedData && window.lastUpdatedData.last_successful_update);

    dayNote.innerHTML =
      `<div class="update-note">${
        ts
          ? `Note: This day's data was last updated on: ${ts}.`
          : `Note: This day's data has never been updated.`
      }</div>`;
  }

  const fieldMap = buildFieldMap(day);
  const blocks = buildBlocks(day, fieldMap);

  detectConflicts(blocks);

  const availability = buildAvailability(day, fieldMap, blocks);
  const events = buildEventLanes(blocks);

  Object.keys(day.complexes).forEach(complex => {
    container.appendChild(
      renderComplexTimeline(
        complex,
        events[complex] || [],
        availability.filter(a => a.complex === complex)
      )
    );
  });
}

/********************************************************************
 * RENDER COMPLEX TIMELINE — ORIGINAL LAYOUT + TOOLTIP + TRUNCATION
 ********************************************************************/
function renderComplexTimeline(complex, events, availability) {
  const div = document.createElement("div");
  div.className = "complex";

  const header = document.createElement("div");
  header.className = "complex-header";
  header.textContent = complex;
  div.appendChild(header);

  const timeline = document.createElement("div");
  timeline.className = "timeline";

  const hours = document.createElement("div");
  hours.className = "hours";

  for (let t = DAY_START; t <= DAY_END; t += 60) {
    const h = document.createElement("div");
    h.className = "hour";
    h.style.top = ((t - DAY_START) * PX_PER_MIN) + "px";
    h.textContent = fmt(t);
    hours.appendChild(h);
  }

  const track = document.createElement("div");
  track.className = "events-track";
  track.style.height = ((DAY_END - DAY_START) * PX_PER_MIN) + "px";

  // Combine events + availability into one block list
  const blocks = [];

  events.forEach(e => {
    blocks.push({
      kind: "event",
      title: e.title,
      fieldId: e.fieldId,
      type: e.type,
      conflict: e.conflict,
      start: e.start,
      end: e.end
    });
  });

  availability.forEach(a => {
    blocks.push({
      kind: "avail",
      title: "Available",
      fields: a.fields,
      start: a.start,
      end: a.end
    });
  });

  // Lane assignment: events first
  const lanes = [];

  blocks
    .filter(b => b.kind === "event")
    .sort((a, b) => a.start - b.start)
    .forEach(b => {
      let laneIndex = 0;
      while (true) {
        const lane = lanes[laneIndex] || [];
        const conflict = lane.some(x => overlaps(x.start, x.end, b.start, b.end));
        if (!conflict) {
          lane.push(b);
          lanes[laneIndex] = lane;
          b.lane = laneIndex;
          break;
        }
        laneIndex++;
      }
    });

  const eventLaneCount = lanes.length;

  // Availability always goes in the last lane (L‑After)
  blocks
    .filter(b => b.kind === "avail")
    .forEach(b => {
      const laneIndex = eventLaneCount;
      if (!lanes[laneIndex]) lanes[laneIndex] = [];
      lanes[laneIndex].push(b);
      b.lane = laneIndex;
    });

  const laneCount = lanes.length || 1;
  const laneWidth = 100 / laneCount;

  // Render all blocks in the same track
  blocks.forEach(b => {
    const block = document.createElement("div");
    block.className = "block";

    if (b.kind === "event") {
      block.classList.add("event-block");
      block.classList.add(b.type);
      if (b.conflict) block.classList.add("conflict");

      block.innerHTML = `
        <div class="block-main">
          <div class="block-title">${b.title}</div>
          <div class="block-fields">${b.fieldId}</div>
          <div class="block-time">${fmt(b.start)} – ${fmt(b.end)}</div>
        </div>
        <div class="block-tooltip">
          <div><strong>Field:</strong> ${b.fieldId}</div>
          <div><strong>Time:</strong> ${fmt(b.start)} – ${fmt(b.end)}</div>
          <div><strong>Type:</strong> ${b.type}</div>
        </div>
      `;
    } else {
      block.classList.add("avail-block");

      block.innerHTML = `
        <div class="block-main">
          <div class="block-title">Available</div>
          <div class="block-fields">${b.fields.join(", ")}</div>
          <div class="block-time">${fmt(b.start)} – ${fmt(b.end)}</div>
        </div>
        <div class="block-tooltip">
          <div><strong>Fields:</strong> ${b.fields.join(", ")}</div>
          <div><strong>Time:</strong> ${fmt(b.start)} – ${fmt(b.end)}</div>
          <div><strong>Complex:</strong> ${complex}</div>
        </div>
      `;
    }

    block.style.top = ((b.start - DAY_START) * PX_PER_MIN) + "px";
    block.style.height = ((b.end - b.start) * PX_PER_MIN) + "px";
    block.style.left = (b.lane * laneWidth) + "%";
    block.style.width = laneWidth + "%";

    track.appendChild(block);
  });

  timeline.appendChild(hours);
  timeline.appendChild(track);
  div.appendChild(timeline);
  return div;
}



/********************************************************************
 * INITIALIZE
 ********************************************************************/
document.addEventListener("DOMContentLoaded", () => {
  loadGlobalRefreshBanner();
});
