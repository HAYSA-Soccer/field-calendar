const DAY_START = 8 * 60;   // 8:00
const DAY_END   = 21 * 60;  // 21:00
const PX_PER_MIN = 1;       // 60px/hour

function parseTime(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function formatHourLabel(mins) {
  let h = Math.floor(mins / 60);
  const suffix = h >= 12 ? "PM" : "AM";
  h = (h % 12) || 12;
  return `${h} ${suffix}`;
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

function buildComplexBlocks(day, fieldMap) {
  const complexes = day.complexes || {};
  const result = {};

  Object.keys(complexes).forEach(complexName => {
    const fieldIds = complexes[complexName];

    const blocks = (day.merged || []).filter(b => {
      const f = fieldMap[b.field];
      return f && f.complex === complexName;
    }).map(b => ({
      fieldId: b.field,
      complex: complexName,
      start: parseTime(b.start),
      end: parseTime(b.end),
      type: b.type || "free",
      title: b.title || (b.type === "free" ? "Available" : "Booked")
    }));

    result[complexName] = blocks;
  });

  return result;
}

// Full field consumes subfields during its active window (A1)
function suppressSubfields(blocks, fieldMap) {
  const byComplex = {};

  blocks.forEach(b => {
    if (!byComplex[b.complex]) byComplex[b.complex] = [];
    byComplex[b.complex].push(b);
  });

  const out = [];

  Object.keys(byComplex).forEach(complexName => {
    const list = byComplex[complexName];

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

// Merge availability across entire complex (Option A)
function buildAvailabilityBlocks(blocks) {
  const byComplex = {};
  blocks.forEach(b => {
    if (b.type !== "free") return;
    if (!byComplex[b.complex]) byComplex[b.complex] = [];
    byComplex[b.complex].push(b);
  });

  const availBlocks = [];

  Object.keys(byComplex).forEach(complexName => {
    const list = byComplex[complexName].sort((a, b) => a.start - b.start);
    let curStart = null;
    let curEnd = null;

    list.forEach(b => {
      if (curStart === null) {
        curStart = b.start;
        curEnd = b.end;
      } else if (b.start <= curEnd) {
        curEnd = Math.max(curEnd, b.end);
      } else {
        availBlocks.push({
          complex: complexName,
          start: curStart,
          end: curEnd,
          type: "free",
          title: "Available"
        });
        curStart = b.start;
        curEnd = b.end;
      }
    });

    if (curStart !== null) {
      availBlocks.push({
        complex: complexName,
        start: curStart,
        end: curEnd,
        type: "free",
        title: "Available"
      });
    }
  });

  return availBlocks;
}

// Non-availability blocks, lane assignment
function buildEventBlocks(blocks, fieldMap) {
  const byComplex = {};
  blocks.forEach(b => {
    if (b.type === "free") return;
    if (!byComplex[b.complex]) byComplex[b.complex] = [];
    byComplex[b.complex].push(b);
  });

  const eventsByComplex = {};

  Object.keys(byComplex).forEach(complexName => {
    const list = byComplex[complexName].sort((a, b) => a.start - b.start);
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

    const blocksWithLane = [];
    lanes.forEach((lane, idx) => {
      lane.forEach(b => {
        blocksWithLane.push({
          complex: complexName,
          start: b.start,
          end: b.end,
          type: b.type,
          title: b.title,
          lane: idx,
          fieldId: b.fieldId,
          fieldName: fieldMap[b.fieldId] ? fieldMap[b.fieldId].name : b.fieldId
        });
      });
    });

    eventsByComplex[complexName] = blocksWithLane;
  });

  return eventsByComplex;
}

function renderDayCalendar(day) {
  const container = document.getElementById("calendar");
  container.innerHTML = "";

  const fieldMap = buildFieldMap(day);
  let blocks = buildComplexBlocks(day, fieldMap);
  let flatBlocks = [];
  Object.values(blocks).forEach(arr => flatBlocks = flatBlocks.concat(arr));

  flatBlocks = suppressSubfields(flatBlocks, fieldMap);

  const availabilityBlocks = buildAvailabilityBlocks(flatBlocks);
  const eventsByComplex = buildEventBlocks(flatBlocks, fieldMap);

  const complexes = day.complexes || {};

  Object.keys(complexes).forEach(complexName => {
    const complexEl = renderComplexTimeline(
      complexName,
      eventsByComplex[complexName] || [],
      availabilityBlocks.filter(a => a.complex === complexName)
    );
    container.appendChild(complexEl);
  });
}

function renderComplexTimeline(complexName, events, availability) {
  const complexDiv = document.createElement("div");
  complexDiv.className = "complex";

  const header = document.createElement("div");
  header.className = "complex-header";
  header.textContent = complexName;
  complexDiv.appendChild(header);

  const timeline = document.createElement("div");
  timeline.className = "timeline";

  const hoursCol = document.createElement("div");
  hoursCol.className = "hours-col";

  for (let t = DAY_START; t <= DAY_END; t += 60) {
    const hDiv = document.createElement("div");
    hDiv.className = "hour-label";
    hDiv.style.top = ((t - DAY_START) * PX_PER_MIN) + "px";
    hDiv.textContent = formatHourLabel(t);
    hoursCol.appendChild(hDiv);
  }

  const tracks = document.createElement("div");
  tracks.className = "tracks";

  const eventsTrack = document.createElement("div");
  eventsTrack.className = "events-track";
  eventsTrack.style.height = ((DAY_END - DAY_START) * PX_PER_MIN) + "px";

  const availTrack = document.createElement("div");
  availTrack.className = "avail-track";
  availTrack.style.height = ((DAY_END - DAY_START) * PX_PER_MIN) + "px";

  // Render events (left)
  const maxLane = events.reduce((m, e) => Math.max(m, e.lane || 0), 0);
  const laneWidth = maxLane >= 0 ? (100 / (maxLane + 1)) : 100;

  events.forEach(e => {
    const block = document.createElement("div");
    block.className = "block event-block";
    block.classList.add(e.type);

    const top = (e.start - DAY_START) * PX_PER_MIN;
    const height = (e.end - e.start) * PX_PER_MIN;
    const left = (e.lane * laneWidth);

    block.style.top = top + "px";
    block.style.height = height + "px";
    block.style.left = left + "%";
    block.style.width = laneWidth + "%";

    block.innerHTML = `
      <div class="block-title">${e.title}</div>
      <div class="block-fields">${e.fieldName}</div>
    `;

    eventsTrack.appendChild(block);
  });

  // Render availability (right, merged across complex)
  availability.forEach(a => {
    const block = document.createElement("div");
    block.className = "block avail-block free";

    const top = (a.start - DAY_START) * PX_PER_MIN;
    const height = (a.end - a.start) * PX_PER_MIN;

    block.style.top = top + "px";
    block.style.height = height + "px";
    block.style.left = "0%";
    block.style.width = "100%";

    block.innerHTML = `
      <div class="block-title">${a.title}</div>
      <div class="block-fields">${complexName}</div>
    `;

    availTrack.appendChild(block);
  });

  tracks.appendChild(eventsTrack);
  tracks.appendChild(availTrack);

  timeline.appendChild(hoursCol);
  timeline.appendChild(tracks);
  complexDiv.appendChild(timeline);

  return complexDiv;
}
