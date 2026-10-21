const DAY_START = 8 * 60;
const DAY_END   = 21 * 60;
const PX_PER_MIN = 1;

function updateDayLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const dayName = d.toLocaleDateString("en-US", { weekday: "long" });
  const pretty = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  const el = document.getElementById("day-label");
  if (el) el.textContent = `${dayName}, ${pretty}`;
}

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

    if (!f && b.surface) {
      const corrected = day.fields.find(x => x.surface === b.surface);
      if (corrected) f = corrected;
    }

    if (!f) return;

    blocks.push({
      complex: f.complex,
      fieldId: f.id,
      fieldName: f.name,
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

function buildAvailability(day, fieldMap, blocks) {
  const avail = [];

  Object.keys(day.complexes).forEach(complex => {
    const fields = day.complexes[complex];

    const timeline = [];
    for (let t = DAY_START; t < DAY_END; t += 1) {

      // ⭐ Only let full-field events suppress availability on TURF
      const fullFieldBooked =
        complex === "TURF" &&
        blocks.some(b =>
          b.complex === complex &&
          isFullField(fieldMap[b.fieldId]) &&
          b.type !== "free" &&
          t >= b.start && t < b.end
        );

      const bookedFields = new Set();
      const freeFields   = new Set();

      blocks.forEach(b => {
        if (b.complex !== complex) return;
        if (b.type === "free") return;
        if (t >= b.start && t < b.end) {
          bookedFields.add(b.fieldName);
        }
      });

      fields.forEach(fid => {
        const f = fieldMap[fid];
        const ranges = day.availability[fid] || [];

        const isFree = ranges.some(r => {
          const rs = parseTime(r.start);
          const re = parseTime(r.end);
          return t >= rs && t < re;
        });

        if (!fullFieldBooked && isFree && !bookedFields.has(f.name)) {
          freeFields.add(f.name);
        }
      });

      timeline.push({
        minute: t,
        free: Array.from(freeFields).sort()
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
  // ⭐ Use raw merged blocks so half-fields and all real fields show up
  const blocks = buildBlocks(day, fieldMap);

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
  const laneCount = maxLane >= 0 ? (maxLane + 1) : 1;
  const laneWidth = 100 / laneCount;

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
    block.className = "block avail-block";

    // ⭐ minute‑specific lane count
    let minuteLaneCount = 0;
    events.forEach(e => {
      if (a.start < e.end && e.start < a.end) {
        minuteLaneCount = Math.max(minuteLaneCount, e.lane + 1);
      }
    });

    if (minuteLaneCount === 0) {
      block.style.left = "0%";
      block.style.width = "100%";
    } else {
      const minuteLaneWidth = 100 / minuteLaneCount;
      const leftPct = minuteLaneCount * minuteLaneWidth;
      const widthPct = 100 - leftPct;
      block.style.left = leftPct + "%";
      block.style.width = widthPct + "%";
    }

    block.style.top = ((a.start - DAY_START) * PX_PER_MIN) + "px";
    block.style.height = ((a.end - a.start) * PX_PER_MIN) + "px";

    block.innerHTML = `
      <div class="block-title">Available</div>
      <div class="block-fields">${a.fields.join(", ")}</div>
      <div class="block-time">${fmt(a.start)} – ${fmt(a.end)}</div>
    `;

    availTrack.appendChild(block);
  });

  const tracks = document.createElement("div");
  tracks.className = "tracks";
  tracks.appendChild(availTrack);
  tracks.appendChild(eventsTrack);

  timeline.appendChild(hours);
  timeline.appendChild(tracks);

  div.appendChild(timeline);
  return div;
}
