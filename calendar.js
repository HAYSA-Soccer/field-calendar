const DAY_START = 8 * 60;
const DAY_END   = 21 * 60;
const PX_PER_MIN = 1; // 60px/hour

function parseTime(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function fmt(mins) {
  let h = Math.floor(mins / 60);
  let m = mins % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  h = (h % 12) || 12;
  h = (h % 12) || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${suffix}`;
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

function isFullField(fieldObj) {
  return fieldObj.name.includes("(Full)");
}

function buildBlocks(day, fieldMap) {
  const blocks = [];

  (day.merged || []).forEach(b => {
    let f = fieldMap[b.field];

    // If merged block incorrectly uses the parent full-field,
    // try to match the correct subfield using the surface name.
    if (!f) {
      const corrected = day.fields.find(x => x.surface === b.surface);
      if (corrected) {
        f = corrected;
      }
    }

    // If still not found, skip the block
    if (!f) return;

    blocks.push({
      complex: f.complex,
      fieldId: f.id,          // FIXED: use correct subfield ID
      fieldName: f.name,      // FIXED: friendly name (no more "Full" unless true)
      start: parseTime(b.start),
      end: parseTime(b.end),
      type: b.type,
      title: b.title || (b.type === "free" ? "Available" : "Booked")
    });
  });

  return blocks;
}


function suppressSubfields(blocks, fieldMap) {
  const out = [];

  const byComplex = {};
  blocks.forEach(b => {
    if (!byComplex[b.complex]) byComplex[b.complex] = [];
    byComplex[b.complex].push(b);
  });

  Object.keys(byComplex).forEach(complex => {
    const list = byComplex[complex];
    const fullBlocks = list.filter(b => isFullField(fieldMap[b.fieldId]));
    const subBlocks  = list.filter(b => !isFullField(fieldMap[b.fieldId]));

    subBlocks.forEach(sb => {
      const suppressed = fullBlocks.some(fb =>
        overlaps(fb.start, fb.end, sb.start, sb.end)
      );
      if (!suppressed) out.push(sb);
    });

    fullBlocks.forEach(fb => out.push(fb));
  });

  return out;
}

// UPDATED: dynamic availability based on changing free-field set
function buildAvailability(day, fieldMap, blocks) {
  const avail = [];

  Object.keys(day.complexes).forEach(complex => {
    const fields = day.complexes[complex];

    // minute-by-minute snapshot of free fields
    const timeline = [];
    for (let t = DAY_START; t < DAY_END; t += 1) {
      const bookedFields = new Set();
      const freeFields   = new Set();

      // events (non-free merged blocks)
      blocks.forEach(b => {
        if (b.complex !== complex) return;
        if (b.type === "free") return;
        if (t >= b.start && t < b.end) {
          bookedFields.add(b.fieldName);
        }
      });

      // availability per field
      fields.forEach(fid => {
        const f = fieldMap[fid];
        const ranges = day.availability[fid] || [];

        const isFree = ranges.some(r => {
          const rs = parseTime(r.start);
          const re = parseTime(r.end);
          return t >= rs && t < re;
        });

        if (isFree && !bookedFields.has(f.name)) {
          freeFields.add(f.name);
        }
      });

      timeline.push({
        minute: t,
        free: Array.from(freeFields).sort()
      });
    }

    // merge contiguous minutes where free-field set is identical
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

    // final block
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

function renderDayCalendar(day) {
  const container = document.getElementById("calendar");
  container.innerHTML = "";

  const fieldMap = buildFieldMap(day);
  let blocks = buildBlocks(day, fieldMap);
  blocks = suppressSubfields(blocks, fieldMap);

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

  const eventsTrack = document.createElement("div");
  eventsTrack.className = "events-track";
  eventsTrack.style.height = ((DAY_END - DAY_START) * PX_PER_MIN) + "px";

  const maxLane = events.reduce((m, e) => Math.max(m, e.lane), 0);
  const laneWidth = maxLane >= 0 ? (100 / (maxLane + 1)) : 100;

  events.forEach(e => {
    const block = document.createElement("div");
    block.className = "block event-block";
    block.classList.add(e.type);

    block.style.top = ((e.start - DAY_START) * PX_PER_MIN) + "px";
    block.style.height = ((e.end - e.start) * PX_PER_MIN) + "px";
    block.style.left = (e.lane * laneWidth) + "%";
    block.style.width = laneWidth + "%";

    block.innerHTML = `
      <div class="block-title">${e.title}</div>
      <div class="block-fields">${e.fieldName}</div>
      <div class="block-time">${fmt(e.start)} – ${fmt(e.end)}</div>
    `;

    eventsTrack.appendChild(block);
  });

  const availTrack = document.createElement("div");
  availTrack.className = "avail-track";
  availTrack.style.height = ((DAY_END - DAY_START) * PX_PER_MIN) + "px";

  availability.forEach(a => {
    const block = document.createElement("div");
    block.className = "block avail-block free";

    block.style.top = ((a.start - DAY_START) * PX_PER_MIN) + "px";
    block.style.height = ((a.end - a.start) * PX_PER_MIN) + "px";

    block.innerHTML = `
      <div class="block-title">Available</div>
      <div class="block-fields">${a.fields.join(", ")}</div>
      <div class="block-time">${fmt(a.start)} – ${fmt(a.end)}</div>
    `;

    availTrack.appendChild(block);
  });

  timeline.appendChild(hours);
  timeline.appendChild(eventsTrack);
  timeline.appendChild(availTrack);

  div.appendChild(timeline);
  return div;
}
