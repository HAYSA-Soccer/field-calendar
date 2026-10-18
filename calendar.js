/************************************************************
 * CONFIG — STATIC JSON ONLY
 ************************************************************/
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
 * STATIC JSON FETCHERS
 ************************************************************/
async function fetchDayCalendar(dateStr) {
  const url = `/data/day/${dateStr}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Missing day JSON: ${url}`);
  return res.json();
}

async function fetchWeekCalendar(dateStr) {
  const monday = getMonday(dateStr);
  const weekId = monday.toISOString().split("T")[0];
  const url = `/data/week/${weekId}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Missing week JSON: ${url}`);
  return res.json();
}

async function fetchMonthCalendar(dateStr) {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const url = `/data/month/${year}-${month}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Missing month JSON: ${url}`);
  return res.json();
}

async function fetchSeasonWindow() {
  const res = await fetch(`/data/season_window.json`);
  if (!res.ok) throw new Error("Missing season_window.json");
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
 * RENDER — DAY VIEW (STATIC JSON)
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

  // COMPLEX COLUMNS — STATIC JSON
  const complexes = Object.keys(data.complexes).sort();

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

    const blocks = data.complex_timeline[cx] || [];

    blocks.forEach(block => {
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
 * RENDER — WEEK VIEW (STATIC JSON)
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
 * RENDER — MONTH VIEW (STATIC JSON)
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
 * SEARCH VIEW (STATIC JSON)
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

  const season = await fetchSeasonWindow();
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
