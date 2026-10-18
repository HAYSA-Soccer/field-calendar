/************************************************************
 * CONFIG
 ************************************************************/
const API_BASE = "YOUR_APPS_SCRIPT_WEB_APP_URL"; // <-- replace with your deployed URL
const PX_PER_MIN = 2; // vertical scale (2px per minute = 120px per hour)


/************************************************************
 * UTILITIES
 ************************************************************/
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
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric"
  });
}

function getMonday(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function getMonthRange(dateStr) {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  return { first, last };
}


/************************************************************
 * API CALL
 ************************************************************/
async function fetchDayCalendar(dateStr) {
  const url = `${API_BASE}?mode=day_calendar&date=${encodeURIComponent(dateStr)}&sched_mode=practice`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch day_calendar");
  return res.json();
}


/************************************************************
 * TIME GRID
 ************************************************************/
function getTimeBounds(data) {
  let minStart = 24 * 60;
  let maxEnd = 0;

  const ct = data.complex_timeline || {};
  Object.values(ct).forEach(blocks => {
    blocks.forEach(b => {
      const s = timeToMinutes(b.start);
      const e = timeToMinutes(b.end);
      if (s < minStart) minStart = s;
      if (e > maxEnd) maxEnd = e;
    });
  });

  if (minStart === 24 * 60 || maxEnd === 0) {
    (data.merged || []).forEach(b => {
      const s = timeToMinutes(b.start);
      const e = timeToMinutes(b.end);
      if (s < minStart) minStart = s;
      if (e > maxEnd) maxEnd = e;
    });
  }

  if (minStart === 24 * 60 || maxEnd === 0) {
    minStart = timeToMinutes("08:00");
    maxEnd = timeToMinutes("20:00");
  }

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
 * BLOCK ENRICHMENT (attach title/team/coach)
 ************************************************************/
function enrichComplexBlocks(complexTimeline, merged) {
  const mergedMap = {};
  merged.forEach(ev => {
    const key = `${ev.field}|${ev.start}|${ev.end}|${ev.type}`;
    mergedMap[key] = ev;
  });

  Object.keys(complexTimeline).forEach(cx => {
    complexTimeline[cx].forEach(block => {
      if (block.type === "free") return;
      for (const fid of block.fields || []) {
        const keyPractice = `${fid}|${block.start}|${block.end}|practice`;
        const keyGame = `${fid}|${block.start}|${block.end}|game`;
        const ev = mergedMap[keyPractice] || mergedMap[keyGame];
        if (ev) {
          block.title = ev.title || "";
          block.team = ev.team || "";
          block.coach = ev.coach || "";
          block.grade = ev.grade || "";
          break;
        }
      }
    });
  });

  return complexTimeline;
}


/************************************************************
 * RENDER — SINGLE DAY
 ************************************************************/
function renderDay(data, container) {
  container.innerHTML = "";

  const { minStart, maxEnd } = getTimeBounds(data);
  const timeSlots = buildTimeSlots(minStart, maxEnd);

  const header = document.createElement("div");
  header.className = "cal-header";
  header.textContent = `Day View — ${formatDateLabel(data.date)}`;
  container.appendChild(header);

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
  let ct = enrichComplexBlocks(data.complex_timeline, data.merged);
  const complexes = Object.keys(ct).sort();

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

    ct[cx].forEach(block => {
      const el = document.createElement("div");
      el.className = `cal-block cal-block-${block.type}`;

      const startMin = timeToMinutes(block.start);
      const endMin = timeToMinutes(block.end);
      const offset = startMin - minStart;
      const duration = endMin - startMin;

      el.style.top = `${offset * PX_PER_MIN}px`;
      el.style.height = `${duration * PX_PER_MIN}px`;

      const lines = [];
      lines.push(`${formatTime12(block.start)} – ${formatTime12(block.end)}`);

      if (block.type === "free") {
        lines.push("Available");
      } else {
        if (block.title) lines.push(block.title);
        if (block.team) lines.push(block.team);
        if (block.coach) lines.push(`Coach: ${block.coach}`);
        if (block.grade) lines.push(`Grade: ${block.grade}`);
      }

      lines.push((block.fields || []).join(", "));
      el.innerHTML = lines.map(l => `<div>${l}</div>`).join("");

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

  const monday = getMonday(dateStr);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d.toISOString().split("T")[0]);
  }

  const header = document.createElement("div");
  header.className = "cal-header";
  header.textContent = `Week View — Week of ${formatDateLabel(days[0])}`;
  container.appendChild(header);

  const weekGrid = document.createElement("div");
  weekGrid.className = "week-grid";
  container.appendChild(weekGrid);

  for (const d of days) {
    const data = await fetchDayCalendar(d);
    const dayCol = document.createElement("div");
    dayCol.className = "week-day-col";
    dayCol.innerHTML = `<div class="week-day-header">${formatDateLabel(d)}</div>`;

    // Reuse day renderer inside each column
    const inner = document.createElement("div");
    inner.className = "week-day-inner";
    renderDay(data, inner);

    dayCol.appendChild(inner);
    weekGrid.appendChild(dayCol);
  }
}


/************************************************************
 * RENDER — MONTH VIEW
 ************************************************************/
async function renderMonth(dateStr, container) {
  container.innerHTML = "";

  const { first, last } = getMonthRange(dateStr);
  const days = [];
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().split("T")[0]);
  }

  const header = document.createElement("div");
  header.className = "cal-header";
  header.textContent = `Month View — ${first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`;
  container.appendChild(header);

  const monthGrid = document.createElement("div");
  monthGrid.className = "month-grid";
  container.appendChild(monthGrid);

  for (const d of days) {
    const data = await fetchDayCalendar(d);
    const cell = document.createElement("div");
    cell.className = "month-cell";
    cell.innerHTML = `<div class="month-cell-header">${formatDateLabel(d)}</div>`;

    const inner = document.createElement("div");
    inner.className = "month-cell-inner";
    renderDay(data, inner);

    cell.appendChild(inner);
    monthGrid.appendChild(cell);
  }
}


/************************************************************
 * SEARCH VIEW (Saturdays after 2 PM, Weekdays after 7 PM, etc.)
 ************************************************************/
async function renderSearch(filter, container) {
  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "cal-header";
  header.textContent = `Search Results`;
  container.appendChild(header);

  const results = document.createElement("div");
  results.className = "search-results";
  container.appendChild(results);

  const season = await fetch(`${API_BASE}?mode=season_window`).then(r => r.json());
  const start = new Date(season.season_start);
  const end = new Date(season.season_end);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    const data = await fetchDayCalendar(dateStr);

    const blocks = data.merged || [];

    const matches = blocks.filter(b => {
      const startMin = timeToMinutes(b.start);

      if (filter.dayOfWeek !== undefined && d.getDay() !== filter.dayOfWeek)
        return false;

      if (filter.minStart !== undefined && startMin < filter.minStart)
        return false;

      return true;
    });

    if (matches.length > 0) {
      const dayDiv = document.createElement("div");
      dayDiv.className = "search-day";
      dayDiv.innerHTML = `<div class="search-day-header">${formatDateLabel(dateStr)}</div>`;

      matches.forEach(m => {
        const el = document.createElement("div");
        el.className = "search-block";
        el.innerHTML = `
          <div>${formatTime12(m.start)} – ${formatTime12(m.end)}</div>
          <div>${m.title || ""}</div>
          <div>${m.team || ""}</div>
          <div>${m.coach || ""}</div>
          <div>${m.grade || ""}</div>
          <div>${m.field}</div>
        `;
        dayDiv.appendChild(el);
      });

      results.appendChild(dayDiv);
    }
  }
}


/************************************************************
 * PUBLIC API — CALL THESE FROM YOUR UI
 ************************************************************/
async function showDay(dateStr) {
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

async function searchSaturdaysAfter2() {
  const container = document.getElementById("calendar");
  await renderSearch(
    {
      dayOfWeek: 6, // Saturday
      minStart: timeToMinutes("14:00")
    },
    container
  );
}

async function searchWeekdaysAfter7() {
  const container = document.getElementById("calendar");
  await renderSearch(
    {
      dayOfWeek: undefined, // any weekday
      minStart: timeToMinutes("19:00")
    },
    container
  );
}
