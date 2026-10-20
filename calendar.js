/*************************
 * TIME HELPERS
 *************************/
function parseTime(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function formatTime12(mins) {
  let h = Math.floor(mins / 60);
  let m = mins % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  h = (h % 12) || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${suffix}`;
}

function overlapsRange(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

/*************************
 * LOAD JSON
 *************************/
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

/*************************
 * FIXED 30-MINUTE SLOTS
 *************************/
function buildSlots() {
  const slots = [];
  let start = 8 * 60;   // 8:00 AM
  let end   = 21 * 60;  // 9:00 PM

  for (let t = start; t < end; t += 30) {
    slots.push({ start: t, end: t + 30 });
  }
  return slots;
}

/*************************
 * FIELD STATE PER SLOT
 *************************/
function getFieldState(day, fieldId, slot) {
  const slotStart = slot.start;
  const slotEnd   = slot.end;

  // 1. Check merged blocks
  const merged = (day.merged || []).filter(b => {
    if (b.field !== fieldId) return false;
    const bs = parseTime(b.start);
    const be = parseTime(b.end);
    return overlapsRange(bs, be, slotStart, slotEnd);
  });

  if (merged.length > 0) {
    const b = merged[0];
    return {
      field: fieldId,
      type: b.type || "free",
      title: b.title || (b.type === "free" ? "Available" : "Booked"),
      start: slotStart,
      end: slotEnd
    };
  }

  // 2. Check availability
  const avail = (day.availability[fieldId] || []).some(a => {
    const as = parseTime(a.start);
    const ae = parseTime(a.end);
    return overlapsRange(as, ae, slotStart, slotEnd);
  });

  if (avail) {
    return {
      field: fieldId,
      type: "free",
      title: "Available",
      start: slotStart,
      end: slotEnd
    };
  }

  return null;
}

/*************************
 * MERGE BLOCKS PER SLOT
 *************************/
function mergeBlocksForSlot(fieldStates) {
  const merged = [];

  fieldStates.forEach(fs => {
    if (!fs) return;

    let key;

    if (fs.type === "free") {
      // Availability merges by timeframe only
      key = `free|${fs.start}|${fs.end}`;
    } else {
      // Events merge by type + title + timeframe
      key = `${fs.type}|${fs.title}|${fs.start}|${fs.end}`;
    }

    let group = merged.find(m => m.key === key);

    if (!group) {
      group = {
        key,
        type: fs.type,
        title: fs.title,
        start: fs.start,
        end: fs.end,
        fields: []
      };
      merged.push(group);
    }

    group.fields.push(fs.field);
  });

  return merged;
}

/*************************
 * RENDER DAY
 *************************/
function renderDayCalendar(day) {
  const container = document.getElementById("calendar");
  container.innerHTML = "";

  const slots = buildSlots();
  const complexes = day.complexes || {};

  Object.keys(complexes).forEach(complexName => {
    const fields = complexes[complexName];
    const complexEl = renderComplex(day, complexName, fields, slots);
    container.appendChild(complexEl);
  });
}

/*************************
 * RENDER COMPLEX
 *************************/
function renderComplex(day, complexName, fields, slots) {
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
    timeCell.textContent = `${formatTime12(slot.start)} – ${formatTime12(slot.end)}`;
    row.appendChild(timeCell);

    const blocksRow = document.createElement("div");
    blocksRow.className = "blocks-row";

    /*************************
     * FULL TURF OVERRIDE
     *************************/
    const isTurf = complexName === "TURF";
    let fullTurfState = null;

    if (isTurf) {
      fullTurfState = getFieldState(day, "H-HST", slot);
    }

    if (fullTurfState) {
      const div = document.createElement("div");
      div.className = "block full-span";
      div.classList.add(fullTurfState.type);

      div.innerHTML = `
        <div class="block-title">${fullTurfState.title}</div>
        <div class="block-fields">H-HST (Full Turf)</div>
      `;

      blocksRow.appendChild(div);
      row.appendChild(blocksRow);
      timeline.appendChild(row);
      return;
    }

    /*************************
     * NORMAL MERGING LOGIC
     *************************/
    const fieldStates = fields.map(fieldId => getFieldState(day, fieldId, slot));
    const mergedBlocks = mergeBlocksForSlot(fieldStates);

    mergedBlocks.forEach(block => {
      const div = document.createElement("div");
      div.className = "block";
      div.classList.add(block.type);

      // Span lanes based on number of fields merged
      div.style.flex = block.fields.length;

      div.innerHTML = `
        <div class="block-title">${block.title}</div>
        <div class="block-fields">${block.fields.join(", ")}</div>
      `;

      blocksRow.appendChild(div);
    });

    row.appendChild(blocksRow);
    timeline.appendChild(row);
  });

  complexDiv.appendChild(timeline);
  return complexDiv;
}
