console.log("CALENDAR JS — CLEAN REWRITE LOADED");

/* -------------------------------------------------------
   GLOBAL DATA
------------------------------------------------------- */
let AVAIL = null;
let SEARCH = null;

/* -------------------------------------------------------
   LOAD JSON FILES
------------------------------------------------------- */
async function loadAvailability() {
  const res = await fetch("data/availability.json?v=1");
  AVAIL = await res.json();
  console.log("Availability loaded:", AVAIL);
}

async function loadSearchIndex() {
  const res = await fetch("data/search_index.json?v=1");
  SEARCH = await res.json();
  console.log("Search index loaded:", SEARCH);
}

/* -------------------------------------------------------
   TIME GRID (HOUR MARKERS + LINES)
------------------------------------------------------- */
function renderTimeGrid(container) {
  const grid = document.createElement("div");
  grid.className = "time-grid";

  const hours = [
    "08:00","09:00","10:00","11:00","12:00",
    "13:00","14:00","15:00","16:00","17:00",
    "18:00","19:00","20:00","21:00"
  ];

  for (const h of hours) {
    const mins = toMinutes(h);

    const label = document.createElement("div");
    label.className = "time-grid-hour";
    label.style.top = `${mins}px`;
    label.textContent = formatTime(h);
    grid.appendChild(label);

    const line = document.createElement("div");
    line.className = "time-grid-line";
    line.style.top = `${mins}px`;
    container.appendChild(line);
  }

  container.appendChild(grid);
}

/* -------------------------------------------------------
   UTILITIES
------------------------------------------------------- */
function toMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function blockPosition(start, end) {
  return {
    top: toMinutes(start),
    height: toMinutes(end) - toMinutes(start)
  };
}

function formatTime(t) {
  let [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  h = (h % 12) || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${suffix}`;
}

/* -------------------------------------------------------
   COMPLEX GROUP LIST
------------------------------------------------------- */
function getComplexList(dayData) {
  return dayData?.complex_timeline
    ? Object.keys(dayData.complex_timeline)
    : [];
}

/* -------------------------------------------------------
   BUILD BLOCKS FROM complex_timeline
------------------------------------------------------- */
function buildBlocks(complexName, dayData) {
  const blocks = dayData.complex_timeline?.[complexName] || [];

  return blocks.map(b => {
    const pos = blockPosition(b.start, b.end);
    return {
      start: b.start,
      end: b.end,
      type: b.type,
      label: b.title || "",
      top: pos.top,
      height: pos.height,
      fields: b.fields || []
    };
  });
}

/* -------------------------------------------------------
   WEEK VIEW
------------------------------------------------------- */
function renderWeekView() {
  console.log("RENDER WEEK VIEW");

  const container = document.getElementById("view-container");
  container.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "week-days-container";

  const days = AVAIL.days;

  for (const date of Object.keys(days)) {
    const dayData = days[date];
    const complexes = getComplexList(dayData);

    const dayCol = document.createElement("div");
    dayCol.className = "week-day-column";

    const header = document.createElement("div");
    header.className = "week-day-header";
    header.textContent = date;
    dayCol.appendChild(header);

    const timelineRow = document.createElement("div");
    timelineRow.className = "week-day-timeline";

    // Add hour grid
    renderTimeGrid(timelineRow);

    // Add complex columns
    for (const complexName of complexes) {
      const complexCol = document.createElement("div");
      complexCol.className = "week-complex-column";
      complexCol.dataset.loc = complexName;

      const title = document.createElement("div");
      title.textContent = complexName;
      complexCol.appendChild(title);

      const blocks = buildBlocks(complexName, dayData);

      for (const b of blocks) {
        const el = document.createElement("div");
        el.className = `timeline-block timeline-${b.type}`;
        el.style.top = `${b.top}px`;
        el.style.height = `${b.height}px`;

        el.innerHTML = `
          <div class="block-time">${formatTime(b.start)}–${formatTime(b.end)}</div>
          <div class="block-main">${b.label}</div>
        `;

        complexCol.appendChild(el);
      }

      timelineRow.appendChild(complexCol);
    }

    dayCol.appendChild(timelineRow);
    wrapper.appendChild(dayCol);
  }

  container.appendChild(wrapper);
}

/* -------------------------------------------------------
   DAY VIEW
------------------------------------------------------- */
function renderDayView() {
  console.log("RENDER DAY VIEW");

  const container = document.getElementById("view-container");
  container.innerHTML = "";

  const today = Object.keys(AVAIL.days)[0];
  const dayData = AVAIL.days[today];
  const complexes = getComplexList(dayData);

  const wrapper = document.createElement("div");
  wrapper.id = "dayTimeline";

  const complexRow = document.createElement("div");
  complexRow.className = "day-complexes";

  // Add hour grid
  renderTimeGrid(complexRow);

  for (const complexName of complexes) {
    const col = document.createElement("div");
    col.className = "complex-column";

    const title = document.createElement("h3");
    title.textContent = complexName;
    col.appendChild(title);

    const blocks = buildBlocks(complexName, dayData);

    for (const b of blocks) {
      const el = document.createElement("div");
      el.className = `timeline-block timeline-${b.type}`;
      el.style.top = `${b.top}px`;
      el.style.height = `${b.height}px`;

      el.innerHTML = `
        <div class="block-time">${formatTime(b.start)}–${formatTime(b.end)}</div>
        <div class="block-main">${b.label}</div>
      `;

      col.appendChild(el);
    }

    complexRow.appendChild(col);
  }

  wrapper.appendChild(complexRow);
  container.appendChild(wrapper);
}

/* -------------------------------------------------------
   INIT
------------------------------------------------------- */
async function initCalendar() {
  console.log("INIT");
  await loadAvailability();
  await loadSearchIndex();
  renderWeekView();
}

initCalendar();

/* -------------------------------------------------------
   NAV BUTTONS
------------------------------------------------------- */
document.querySelectorAll(".nav button").forEach(btn => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;

    if (view === "week") {
      renderWeekView();
    }

    if (view === "day") {
      renderDayView();
    }
  });
});
