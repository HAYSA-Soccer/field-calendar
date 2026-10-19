/************************************************************
 * CONFIG
 ************************************************************/
const PX_PER_MIN = 2;
let currentDate = null; // for prev/next day navigation

const FIXED_START = "08:00";
const FIXED_END = "21:00"; // 9pm


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

function getMonday(dateStr) {
  const d = makeLocalDate(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}


/************************************************************
 * STATIC JSON FETCHERS
 ************************************************************/
async function fetchDayCalendar(dateStr) {
  const url = `/field-calendar/data/day/${dateStr}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Missing day JSON: ${url}`);
  return res.json();
}

async function fetchWeekCalendar(dateStr) {
  const res = await fetch(`/field-calendar/data/week/weeks.json`);
  if (!res.ok) throw new Error("Missing weeks.json");

  const weeks = await res.json();
  const monday = getMonday(dateStr).toISOString().split("T")[0];

  if (!weeks[monday]) {
    throw new Error(`Week data missing for ${monday}`);
  }

  return {
    week_start: monday,
    days: Object.values(weeks[monday])
  };
}

async function fetchMonthCalendar(dateStr) {
  const d = makeLocalDate(dateStr);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  const res = await fetch(`/field-calendar/data/month/months.json`);
  if (!res.ok) throw new Error("Missing months.json");

  const months = await res.json();

  if (!months[key]) {
    throw new Error(`Month data missing for ${key}`);
  }

  return {
    month_label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    days: Object.values(months[key])
  };
}

async function fetchSeasonWindow() {
  const res = await fetch(`/field-calendar/data/availability.json`);
  if (!res.ok) throw new Error("Missing availability.json");
  return res.json();
}


/************************************************************
 * TIME GRID
 ************************************************************/
function getTimeBoundsFixed() {
  const minStart = timeToMinutes(FIXED_START);
  const maxEnd = timeToMinutes(FIXED_END);
  return { minStart, maxEnd };
}

function buildTimeSlots(minStart, maxEnd, step = 30) {
  const slots = [];
  for (let m = minStart; m <= maxEnd; m += step) {
    slots.push(minutesToTime(m));
  }
  return slots;
}


/************************************************************
 * LEGEND
 ************************************************************/
function renderLegend(container) {
  const legend = document.createElement("div");
  legend.className = "cal-legend";

  legend.innerHTML = `
    <div class="cal-legend-item"><span class="lg lg-game"></span> Game</div>
    <div class="cal-legend-item"><span class="lg lg-practice"></span> Practice</div>
    <div class="cal-legend-item"><span class="lg lg-admin"></span> Admin Block</div>
    <div class="cal-legend-item"><span class="lg lg-free"></span> Available</div>
    <div class="cal-legend-item"><span class="lg lg-closure"></span> Closure</div>
  `;

  container.appendChild(legend);
}


/************************************************************
 * BLOCK MAPPING FROM complex_timeline
 ************************************************************/
function mapComplexBlocks(data, minStart, maxEnd) {
  const result = {};
  const ct = data.complex_timeline || {};

  Object.entries(ct).forEach(([complexName, blocks]) => {
    result[complexName] = blocks.map(b => {
      const startMin = timeToMinutes(b.start);
      const endMin = timeToMinutes(b.end);

      return {
        start: b.start,
        end: b.end,
        startMin,
        endMin,
        game_fields: b.game_fields || [],
        practice_fields: b.practice_fields || [],
        admin_fields: b.admin_fields || [],
        free_fields: b.free_fields || [],
        // derived type for coloring (priority: admin > game > practice > free)
        type: (() => {
          if (b.admin_fields && b.admin_fields.length) return "admin";
          if (b.game_fields && b.game_fields.length) return "game";
          if (b.practice_fields && b.practice_fields.length) return "practice";
          if (b.free_fields && b.free_fields.length) return "free";
          return "free"; // default to free if nothing else
        })()
      };
    });
  });

  return result;
}


/************************************************************
 * RENDER — DAY VIEW
 ************************************************************/
function renderDay(data, container) {
  container.innerHTML = "";

  const { minStart, maxEnd } = getTimeBoundsFixed();
  const timeSlots = buildTimeSlots(minStart, maxEnd);

  // HEADER
  const header = document.createElement("div");
  header.className = "cal-header";
  header.textContent = `Day View — ${formatDateLabel(data.date)}`;
  container.appendChild(header);

  // LEGEND
  renderLegend(container);

  // GRID
  const grid = document.createElement("div");
  grid.className = "cal-grid";
  container.appendChild(grid);

  // TIME COLUMN
  const timeCol = document.createElement("div");
  timeCol.className = "cal-col cal-time-col";
  timeCol.innerHTML = `<div class="cal-col-header">Time</div>`;
  timeSlots.forEach(t => {
    const cell = document.createElement("div");
    cell.className = "cal-time-cell";
    cell.textContent = formatTime12(t);
    timeCol.appendChild(cell);
  });
  grid.appendChild(timeCol);

  // COMPLEX COLUMNS
  const complexes = Object.keys(data.complexes || {}).sort();
  const complexBlocks = mapComplexBlocks(data, minStart, maxEnd);

  complexes.forEach(cx => {
    const col = document.createElement("div");
    col.className = "cal-col cal-complex-col";

    const header = document.createElement("div");
    header.className = "cal-col-header";
    header.textContent = cx;
    col.appendChild(header);

    const body = document.createElement("div");
    body.className = "cal-col-body";
    col.appendChild(body);

    const blocks = complexBlocks[cx] || [];

    blocks.forEach(block => {
      const el = document.createElement("div");
      el.className = "cal-block";

      // type classes for coloring
      if (block.type === "game") el.classList.add("cal-block-game");
      if (block.type === "practice") el.classList.add("cal-block-practice");
      if (block.type === "admin") el.classList.add("cal-block-admin");
      if (block.type === "free") el.classList.add("cal-block-free");

      const offset = block.startMin - minStart;
      const duration = block.endMin - block.startMin;

      el.style.top = `${offset * PX_PER_MIN}px`;
      el.style.height = `${duration * PX_PER_MIN}px`;

      const lines = [];

      // time line
      lines.push(`<div class="cal-block-time">${formatTime12(block.start)} – ${formatTime12(block.end)}</div>`);

      // usage lines
      if (block.admin_fields.length) {
        lines.push(`<div class="cal-usage-admin">Admin: ${block.admin_fields.join(", ")}</div>`);
      }
      if (block.game_fields.length) {
        lines.push(`<div class="cal-usage-game">Game: ${block.game_fields.join(", ")}</div>`);
      }
      if (block.practice_fields.length) {
        lines.push(`<div class="cal-usage-practice">Practice: ${block.practice_fields.join(", ")}</div>`);
      }
      if (block.free_fields.length) {
        lines.push(`<div class="cal-usage-free">Available: ${block.free_fields.join(", ")}</div>`);
      }

      // if absolutely nothing, still show "Available (complex)"
      if (
        !block.admin_fields.length &&
        !block.game_fields.length &&
        !block.practice_fields.length &&
        !block.free_fields.length
      ) {
        lines.push(`<div class="cal-usage-free">Available</div>`);
      }

      el.innerHTML = lines.join("");
      body.appendChild(el);
    });

    grid.appendChild(col);
  });
}


/************************************************************
 * RENDER — WEEK VIEW
 ************************************************************/
async function renderWeek(dateStr, container) {
  container.innerHTML = "";

  const weekData = await fetchWeekCalendar(dateStr);

  const header = document.createElement("div");
  header.className = "cal-header";
  header.textContent = `Week View — Week of ${formatDateLabel(weekData.week_start)}`;
  container.appendChild(header);

  const weekGrid = document.createElement("div");
  weekGrid.className = "week-grid";
  container.appendChild(weekGrid);

  weekData.days.forEach(dayObj => {
    const dayCol = document.createElement("div");
    dayCol.className = "week-day-col";
    dayCol.innerHTML = `<div class="week-day-header">${formatDateLabel(dayObj.date)}</div>`;

    const inner = document.createElement("div");
    inner.className = "week-day-inner";
    renderDay(dayObj, inner);

    dayCol.appendChild(inner);
    weekGrid.appendChild(dayCol);
  });
}


/************************************************************
 * RENDER — MONTH VIEW
 ************************************************************/
async function renderMonth(dateStr, container) {
  container.innerHTML = "";

  const monthData = await fetchMonthCalendar(dateStr);

  const header = document.createElement("div");
  header.className = "cal-header";
  header.textContent = `Month View — ${monthData.month_label}`;
  container.appendChild(header);

  const monthGrid = document.createElement("div");
  monthGrid.className = "month-grid";
  container.appendChild(monthGrid);

  monthData.days.forEach(dayObj => {
    const cell = document.createElement("div");
    cell.className = "month-cell";
    cell.innerHTML = `<div class="month-cell-header">${formatDateLabel(dayObj.date)}</div>`;

    const inner = document.createElement("div");
    inner.className = "month-cell-inner";
    renderDay(dayObj, inner);

    cell.appendChild(inner);
    monthGrid.appendChild(cell);
  });
}


/************************************************************
 * DAY NAVIGATION
 ************************************************************/
function changeDay(offset) {
  if (!currentDate) return;
  const d = new Date(currentDate);
  d.setDate(d.getDate() + offset);
  const next = d.toISOString().split("T")[0];
  currentDate = next;
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

async function showWeek(dateStr) {
  const container = document.getElementById("calendar");
  await renderWeek(dateStr, container);
}

async function showMonth(dateStr) {
  const container = document.getElementById("calendar");
  await renderMonth(dateStr, container);
}

async function initCalendar() {
  const season = await fetchSeasonWindow();
  currentDate = season.season_start;
  await showDay(currentDate);
}
