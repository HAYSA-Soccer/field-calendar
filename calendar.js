// --- Helpers ---
function parseTime(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function formatTime(t) {
  const h = Math.floor(t / 60);
  const m = t % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${hh}:${mm}`;
}

function overlapsRange(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

// --- Load JSON ---
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

// --- Build 30-minute slots ---
function buildSlots(day) {
  let min = Infinity;
  let max = -Infinity;

  (day.merged || []).forEach(b => {
    const s = parseTime(b.start);
    const e = parseTime(b.end);
    if (s < min) min = s;
    if (e > max) max = e;
  });

  // If no merged, fall back to availability
  if (!isFinite(min) || !isFinite(max)) {
    Object.values(day.availability || {}).forEach(arr => {
      arr.forEach(a => {
        const s = parseTime(a.start);
        const e = parseTime(a.end);
        if (s < min) min = s;
        if (e > max) max = e;
      });
    });
  }

  if (!isFinite(min) || !isFinite(max)) {
    min = parseTime("08:00");
    max = parseTime("21:00");
  }

  const slots = [];
  for (let t = min; t < max; t += 30) {
    slots.push({ start: t, end: t + 30 });
  }
  return slots;
}

// --- Availability check ---
function isFieldFreeInSlot(day, fieldId, slot) {
  const ranges = day.availability[fieldId] || [];
  const slotStart = slot.start;
  const slotEnd = slot.end;

  return ranges.some(r => {
    const rs = parseTime(r.start);
    const re = parseTime(r.end);
    return overlapsRange(rs, re, slotStart, slotEnd);
  });
}

// --- Find merged blocks for field in slot ---
function getMergedBlocksForFieldInSlot(day, fieldId, slot) {
  const slotStart = slot.start;
  const slotEnd = slot.end;

  return (day.merged || []).filter(b => {
    if (b.field !== fieldId) return false;
    const bs = parseTime(b.start);
    const be = parseTime(b.end);
    return overlapsRange(bs, be, slotStart, slotEnd);
  });
}

// --- Render whole day ---
function renderDayCalendar(day) {
  const container = document.getElementById("calendar");
  container.innerHTML = "";

  const slots = buildSlots(day);
  const complexes = day.complexes || {};

  Object.keys(complexes).forEach(complexName => {
    const fields = complexes[complexName];
    const complexEl = renderComplex(day, complexName, fields, slots);
    container.appendChild(complexEl);
  });
}

// --- Render one complex ---
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
    timeCell.textContent = `${formatTime(slot.start)} – ${formatTime(slot.end)}`;
    row.appendChild(timeCell);

    const blocksRow = document.createElement("div");
    blocksRow.className = "blocks-row";

    // Special TURF full-turf logic
    const isTurf = complexName === "TURF";
    let fullTurfBlock = null;
    if (isTurf) {
      const fullBlocks = getMergedBlocksForFieldInSlot(day, "H-HST", slot);
      if (fullBlocks.length > 0) {
        fullTurfBlock = fullBlocks[0];
      }
    }

    if (fullTurfBlock) {
      // One big block spanning all lanes, no availability
      const blockDiv = document.createElement("div");
      blockDiv.className = "block full-span";
      blockDiv.classList.add(fullTurfBlock.type || "game");

      const title = fullTurfBlock.title || "Full Turf Booked";
      blockDiv.innerHTML = `
        <div class="block-title">${title}</div>
        <div class="block-fields">H-HST (Full Turf)</div>
      `;
      blocksRow.appendChild(blockDiv);
    } else {
      // Normal per-field lanes
      fields.forEach(fieldId => {
        const cell = document.createElement("div");
        cell.className = "block";

        const mergedBlocks = getMergedBlocksForFieldInSlot(day, fieldId, slot);

        if (mergedBlocks.length > 0) {
          // If multiple, mark conflict
          const b = mergedBlocks[0];
          cell.classList.add(b.type || "game");
          if (mergedBlocks.length > 1) {
            cell.classList.add("conflict");
          }

          const title = b.title || "Booked";
          cell.innerHTML = `
            <div class="block-title">${title}</div>
            <div class="block-fields">${fieldId}</div>
          `;
        } else if (isFieldFreeInSlot(day, fieldId, slot)) {
          cell.classList.add("free");
          cell.innerHTML = `
            <div class="block-title">Available</div>
            <div class="block-fields">${fieldId}</div>
          `;
        } else {
          // No block for this field in this slot
          cell.style.visibility = "hidden";
        }

        blocksRow.appendChild(cell);
      });
    }

    row.appendChild(blocksRow);
    timeline.appendChild(row);
  });

  complexDiv.appendChild(timeline);
  return complexDiv;
}
