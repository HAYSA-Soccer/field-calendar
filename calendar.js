/************************************************************
 * CONFIG
 ************************************************************/
const PX_PER_MIN = 1.5;
const DAY_START = "08:00"; // 8am
const DAY_END = "21:00";   // 9pm

let currentDate = null;


/************************************************************
 * UTILITIES
 ************************************************************/
function makeLocalDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(m) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function formatTime12(hhmm) {
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr, 10);
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mStr} ${suffix}`;
}

function formatDateLabel(dateStr) {
  const d = makeLocalDate(dateStr);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric"
  });
}


/************************************************************
 * FETCHERS
 ************************************************************/
async function fetchDayCalendar(dateStr) {
  const url = `/field-calendar/data/day/${dateStr}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Missing day JSON: ${url}`);
  return res.json();
}

async function fetchSeasonWindow() {
  const res = await fetch(`/field-calendar/data/availability.json`);
  if (!res.ok) throw new Error("Missing availability.json");
  return res.json();
}


/************************************************************
 * TIME GRID
 ************************************************************/
function buildTimeSlots() {
  const startMin = timeToMinutes(DAY_START);
  const endMin = timeToMinutes(DAY_END);
  const slots = [];
  for (let m = startMin; m <= endMin; m += 30) {
    slots.push(minutesToTime(m));
  }
  return slots;
}


/************************************************************
 * LEGEND
 ************************************************************/
function renderLegend() {
  const legend = document.getElementById("calendar-legend");
  if (!legend) return;

  legend.innerHTML = `
    <div class="cal-legend">
      <div class="cal-legend-item"><span class="lg lg-game"></span> Game</div>
      <div class="cal-legend-item"><span class="lg lg-practice"></span> Practice</div>
      <div class="cal-legend-item"><span class="lg lg-admin"></span> Admin Block</div>
      <div class="cal-legend-item"><span class="lg lg-free"></span> Available</div>
      <div class="cal-legend-item"><span class="lg lg-closure"></span> Closure</div>
    </div>
  `;
}


/************************************************************
 * AVAILABILITY DERIVATION
 ************************************************************/
/**
 * Given complex_timeline[complexName] and complexes[complexName],
 * derive explicit FREE blocks between DAY_START and DAY_END.
 */
function buildBlocksForComplex(dayData, complexName) {
  const rawBlocks = (dayData.complex_timeline[complexName] || []).map(b => {
    const startMin = timeToMinutes(b.start);
    const endMin = timeToMinutes(b.end);

    let type = "free";
    if (b.admin_fields && b.admin_fields.length) type = "admin";
    else if (b.game_fields && b.game_fields.length) type = "game";
    else if (b.practice_fields && b.practice_fields.length) type = "practice";

    return {
      start: b.start,
      end: b.end,
      startMin,
      endMin,
      type,
      game_fields: b.game_fields || [],
      practice_fields: b.practice_fields || [],
      admin_fields: b.admin_fields || [],
      free_fields: b.free_fields || []
    };
  });

  const dayStartMin = timeToMinutes(DAY_START);
  const dayEndMin = timeToMinutes(DAY_END);

  // Sort scheduled blocks
  rawBlocks.sort((a, b) => a.startMin - b.startMin);

  const blocks = [...rawBlocks];
  const allFieldsInComplex = dayData.complexes[complexName] || [];

  // Build free intervals between scheduled blocks
  let cursor = dayStartMin;

  rawBlocks.forEach(b => {
    if (b.startMin > cursor) {
      blocks.push({
        start: minutesToTime(cursor),
        end: minutesToTime(b.startMin),
        startMin: cursor,
        endMin: b.startMin,
        type: "free",
        game_fields: [],
        practice_fields: [],
        admin_fields: [],
        free_fields: allFieldsInComplex
      });
    }
    cursor = Math.max(cursor, b.endMin);
  });

  // Tail free block
  if (cursor < dayEndMin) {
    blocks.push({
      start: minutesToTime(cursor),
      end: minutesToTime(dayEndMin),
      startMin: cursor,
      endMin: dayEndMin,
      type: "free",
      game_fields: [],
      practice_fields: [],
      admin_fields: [],
      free_fields: allFieldsInComplex
    });
  }

  // Sort again including free blocks
  blocks.sort((a, b) => a.startMin - b.startMin);

  return blocks;
}


/************************************************************
 * RENDER — DAY VIEW
 ************************************************************/
function renderDay(dayData, container) {
  container.innerHTML = "";

  renderLegend();

  const header = document.createElement("div");
  header.className = "cal-header";
  header.textContent = `Day View — ${formatDateLabel(dayData.date)}`;
  container.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "cal-grid";
  container.appendChild(grid);

  // TIME COLUMN
  const timeCol = document.createElement("div");
  timeCol.className = "cal-time-col";
  timeCol.innerHTML = `<div class="cal-col-header">Time</div>`;

  const timeSlots = buildTimeSlots();
  timeSlots.forEach(t => {
    const cell = document.createElement("div");
    cell.className = "cal-time-cell";
    cell.textContent = formatTime12(t);
    timeCol.appendChild(cell);
  });

  grid.appendChild(timeCol);

  // COMPLEX COLUMNS
  const complexNames = Object.keys(dayData.complexes || {}).sort();

  const dayStartMin = timeToMinutes(DAY_START);
  const dayEndMin = timeToMinutes(DAY_END);
  const totalMinutes = dayEndMin - dayStartMin;
  const colHeight = totalMinutes * PX_PER_MIN;

  complexNames.forEach(cx => {
    const col = document.createElement("div");
    col.className = "cal-complex-col";

    const header = document.createElement("div");
    header.className = "cal-col-header";
    header.textContent = cx;
    col.appendChild(header);

    const body = document.createElement("div");
    body.className = "cal-col-body";
    body.style.height = `${colHeight}px`;
    col.appendChild(body);

    const blocks = buildBlocksForComplex(dayData, cx);

    blocks.forEach(block => {
      const el = document.createElement("div");
      el.className = "cal-block cal-block-" + block.type;

      const offset = block.startMin - dayStartMin;
      const duration = block.endMin - block.startMin;

      el.style.top = `${offset * PX_PER_MIN}px`;
      el.style.height = `${duration * PX_PER_MIN}px`;

      const lines = [];
      lines.push(
        `<div class="cal-block-time">${formatTime12(block.start)} – ${formatTime12(block.end)}</div>`
      );

      if (block.type === "admin" && block.admin_fields.length) {
        lines.push(`<div class="cal-block-line">Admin: ${block.admin_fields.join(", ")}</div>`);
      } else if (block.type === "game" && block.game_fields.length) {
        lines.push(`<div class="cal-block-line">Game: ${block.game_fields.join(", ")}</div>`);
      } else if (block.type === "practice" && block.practice_fields.length) {
        lines.push(`<div class="cal-block-line">Practice: ${block.practice_fields.join(", ")}</div>`);
      } else if (block.type === "free") {
        const fieldsLabel = block.free_fields.length
          ? block.free_fields.join(", ")
          : "Available";
        lines.push(`<div class="cal-block-line">Available: ${fieldsLabel}</div>`);
      }

      el.innerHTML = lines.join("");
      body.appendChild(el);
    });

    grid.appendChild(col);
  });
}


/************************************************************
 * NAVIGATION
 ************************************************************/
function changeDay(offset) {
  if (!currentDate) return;
  const d = new Date(currentDate);
  d.setDate(d.getDate() + offset);
  currentDate = d.toISOString().split("T")[0];
  showDay(currentDate);
}


/************************************************************
 * PUBLIC API
 ************************************************************/
async function showDay(dateStr) {
  currentDate = dateStr;
  const container = document.getElementById("calendar");
  const data = await fetchDayCalendar(dateStr);
  renderDay(data, container);
}

// Week / Month placeholders for now (until we wire them to real data)
async function showWeek(dateStr) {
  const container = document.getElementById("calendar");
  container.innerHTML = "<div class='cal-header'>Week View coming soon (day view is authoritative).</div>";
}

async function showMonth(dateStr) {
  const container = document.getElementById("calendar");
  container.innerHTML = "<div class='cal-header'>Month View coming soon (day view is authoritative).</div>";
}

async function initCalendar() {
  const season = await fetchSeasonWindow();
  currentDate = season.season_start;
  await showDay(currentDate);
}
