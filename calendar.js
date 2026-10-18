console.log("UPDATED CALENDAR JS LOADED");

/* -------------------------------------------------------
   GLOBAL DATA
------------------------------------------------------- */
let AVAIL = null;
let SEARCH = null;

/* -------------------------------------------------------
   LOAD JSON
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
   UTILITIES
------------------------------------------------------- */
function toMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function blockPosition(start, end) {
  const top = toMinutes(start);
  const height = toMinutes(end) - toMinutes(start);
  return { top, height };
}

function formatTime(t) {
  let [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  h = (h % 12) || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${suffix}`;
}

/* -------------------------------------------------------
   COMPLEX LIST (NEW)
------------------------------------------------------- */
function getComplexList(dayData) {
  if (!dayData || !dayData.complex_timeline) return [];
  return Object.keys(dayData.complex_timeline);
}

/* -------------------------------------------------------
   BUILD BLOCKS FROM complex_timeline (NEW)
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
   WEEK VIEW (UPDATED)
------------------------------------------------------- */
function renderWeekView() {
  console.log("RENDER WEEK VIEW START");

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
   DAY VIEW (UPDATED)
------------------------------------------------------- */
function renderDayView() {
  console.log("RENDER DAY VIEW START");

  const container = document.getElementById("view-container");
  container.innerHTML = "";

  const today = Object.keys(AVAIL.days)[0];
  const dayData = AVAIL.days[today];
  const complexes = getComplexList(dayData);

  const wrapper = document.createElement("div");
  wrapper.id = "dayTimeline";

  const complexRow = document.createElement("div");
  complexRow.className = "day-complexes";

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
  console.log("INIT START");
  await loadAvailability();
  await loadSearchIndex();
  console.log("CALLING WEEK VIEW");
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
      console.log("NAV → WEEK");
      renderWeekView();
    }

    if (view === "day") {
      console.log("NAV → DAY");
      renderDayView();
    }
  });
});
