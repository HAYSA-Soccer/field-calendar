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
      fieldId: fieldId,
      fieldName: fieldId,
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
 * BUILD AVAILABILITY — NOW PRESERVES MODE
 ********************************************************************/
function buildAvailability(day, fieldMap, blocks) {
  const avail = [];

  const fieldsByComplex = {};
  day.fields.forEach(f => {
    if (!fieldsByComplex[f.complex]) fieldsByComplex[f.complex] = [];
    fieldsByComplex[f.complex].push(f.id);
  });

  Object.keys(fieldsByComplex).forEach(complex => {
    const fields = fieldsByComplex[complex];

    const adminBlocks = blocks.filter(
      b => b.complex === complex && b.type === "admin"
    );

    const timeline = [];
    for (let t = DAY_START; t < DAY_END; t++) {

      const hasAdmin = adminBlocks.some(
        b => t >= b.start && t < b.end
      );

      if (hasAdmin) {
        timeline.push({ minute: t, free: [] });
        continue;
      }

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

        let matchedRange = null;
        ranges.forEach(r => {
          const rs = parseTime(r.start);
          const re = parseTime(r.end);
          if (t >= rs && t < re) {
            matchedRange = r;
          }
        });

        if (matchedRange && !bookedFields.has(fid)) {
          freeFields.push({
            field: fid,
            mode: matchedRange.mode || "both"
          });
        }
      });

      timeline.push({
        minute: t,
        free: freeFields
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
            fields: curFields.map(f => f.field),
            modes: curFields.map(f => f.mode)
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
        fields: curFields.map(f => f.field),
        modes: curFields.map(f => f.mode)
      });
    }
  });

  return avail;
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

  const eventsByComplex = {};
  blocks.forEach(b => {
    if (b.type === "free") return;
    if (!eventsByComplex[b.complex]) eventsByComplex[b.complex] = [];
    eventsByComplex[b.complex].push(b);
  });

  Object.keys(day.complexes).forEach(complex => {
    container.appendChild(
      renderComplexTimeline(
        complex,
        eventsByComplex[complex] || [],
        availability.filter(a => a.complex === complex)
      )
    );
  });
}

/********************************************************************
 * UNIFIED LANE SYSTEM — EVENTS + AVAILABILITY
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
      modes: a.modes,
      start: a.start,
      end: a.end
    });
  });

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
  const totalLaneCount = eventLaneCount + 1;

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
      `;

      const laneWidth = 100 / totalLaneCount;
      block.style.left = (b.lane * laneWidth) + "%";
      block.style.width = laneWidth + "%";

    } else {
      block.classList.add("avail-block");

      // ⭐ Mode styling
      if (b.modes && b.modes.length > 0) {
        if (b.modes.every(m => m === "game_only")) {
          block.classList.add("game-only");
        }
        if (b.modes.every(m => m === "practice_only")) {
          block.classList.add("practice-only");
        }
      }

      const label =
        b.modes && b.modes.every(m => m === "game_only")
          ? "Available (Game Only)"
          : b.modes && b.modes.every(m => m === "practice_only")
          ? "Available (Practice Only)"
          : "Available";

      block.innerHTML = `
        <div class="block-main">
          <div class="block-title">${label}</div>
          <div class="block-fields">${b.fields.join(", ")}</div>
          <div class="block-time">${fmt(b.start)} – ${fmt(b.end)}</div>
        </div>
      `;

      const overlappingEventLanes = new Set();

      blocks
        .filter(x => x.kind === "event")
        .forEach(x => {
          if (overlaps(x.start, x.end, b.start, b.end)) {
            overlappingEventLanes.add(x.lane);
          }
        });

      const laneWidth = 100 / totalLaneCount;

      const spanStart = Math.min(...[...Array(totalLaneCount).keys()].filter(i => !overlappingEventLanes.has(i)));
      const spanEnd = Math.max(...[...Array(totalLaneCount).keys()].filter(i => !overlappingEventLanes.has(i)));

      block.style.left = (spanStart * laneWidth) + "%";
      block.style.width = ((spanEnd - spanStart + 1) * laneWidth) + "%";
    }

    block.style.top = ((b.start - DAY_START) * PX_PER_MIN) + "px";
    block.style.height = ((b.end - b.start) * PX_PER_MIN) + "px";

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
