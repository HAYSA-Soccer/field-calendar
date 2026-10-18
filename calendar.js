console.log("CALENDAR JS — FINAL VERSION");

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
}

async function loadSearchIndex() {
  const res = await fetch("data/search_index.json?v=1");
  SEARCH = await res.json();
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
   REAL COMPLEX NAMES
------------------------------------------------------- */
function getRealComplexName(fieldId) {
  if (fieldId.startsWith("H-HST")) return "Holbrook HS Turf";

  if (
    fieldId.startsWith("H-Su1") ||
    fieldId.startsWith("H-Su2") ||
    fieldId.startsWith("H-SJ3") ||
    fieldId.startsWith("H-SJ4")
  ) {
    return "Sumner / Sean Joyce Fields";
  }

  return "Other";
}

/* -------------------------------------------------------
   COMPLEX LIST FOR A DAY
------------------------------------------------------- */
function getComplexListForDay(dayData) {
  const complexes = new Set();
  const merged = dayData.merged || [];

  for (const b of merged) {
    complexes.add(getRealComplexName(b.field));
  }

  return Array.from(complexes);
}

/* -------------------------------------------------------
   FIELDS PER COMPLEX
------------------------------------------------------- */
function getFieldsForComplex(complexName) {
  return AVAIL.fields.filter(f => getRealComplexName(f.id) === complexName);
}

/* -------------------------------------------------------
   MERGED BLOCKS PER FIELD
------------------------------------------------------- */
function getMergedBlocksForField(dayData, fieldId) {
  return (dayData.merged || []).filter(b => b.field === fieldId);
}

/* -------------------------------------------------------
   TIME GRID
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
   RENDER BLOCK
------------------------------------------------------- */
function renderBlockElement(b) {
  const pos = blockPosition(b.start, b.end);
  const el = document.createElement("div");

  const typeClass = b.type ? `timeline-${b.type}` : "timeline-free";
  el.className = `timeline-block ${typeClass}`;
  el.style.top = `${pos.top}px`;
  el.style.height = `${pos.height}px`;

  const startLabel = b.start_12 || formatTime(b.start);
  const endLabel = b.end_12 || formatTime(b.end);

  el.innerHTML = `
    <div class="block-time">${startLabel}–${endLabel}</div>
    <div class="block-title">${b.title || ""}</div>
    <div class="block-team">${b.team || ""}</div>
    <div class="block-coach">${b.coach || ""}</div>
    <div class="block-grade">${b.grade || ""}</div>
    <div class="block-field">${b.field || ""}</div>
  `;

  return el;
}

/* -------------------------------------------------------
   WEEK VIEW
------------------------------------------------------- */
function renderWeekView() {
  const container = document.getElementById("view-container");
  container.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "week-days-container";

  const days = AVAIL.days;

  for (const date of Object.keys(days)) {
    const dayData = days[date];
    const complexes = getComplexListForDay(dayData);

    const dayCol = document.createElement("div");
    dayCol.className = "week-day-column";

    const header = document.createElement("div");
    header.className = "week-day-header";
    header.textContent = date;
    dayCol.appendChild(header);

    const timelineRow = document.createElement("div");
    timelineRow.className = "week-day-timeline";

    renderTimeGrid(timelineRow);

    for (const complexName of complexes) {
      const complexCol = document.createElement("div");
      complexCol.className = "complex-column";

      const complexHeader = document.createElement("div");
      complexHeader.className = "complex-header";
      complexHeader.textContent = complexName;
      complexCol.appendChild(complexHeader);

      const fields = getFieldsForComplex(complexName);

      const fieldsRow = document.createElement("div");
      fieldsRow.className = "fields-row";

      for (const field of fields) {
        const fieldCol = document.createElement("div");
        fieldCol.className = "field-column";

        const fieldHeader = document.createElement("div");
        fieldHeader.className = "field-header";
        fieldHeader.textContent = field.surface || field.id;
        fieldCol.appendChild(fieldHeader);

        const blocks = getMergedBlocksForField(dayData, field.id);

        for (const b of blocks) {
          fieldCol.appendChild(renderBlockElement(b));
        }

        fieldsRow.appendChild(fieldCol);
      }

      complexCol.appendChild(fieldsRow);
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
  const container = document.getElementById("view-container");
  container.innerHTML = "";

  const today = Object.keys(AVAIL.days)[0];
  const dayData = AVAIL.days[today];
  const complexes = getComplexListForDay(dayData);

  const wrapper = document.createElement("div");
  wrapper.id = "dayTimeline";

  const complexRow = document.createElement("div");
  complexRow.className = "day-complexes";

  renderTimeGrid(complexRow);

  for (const complexName of complexes) {
    const complexCol = document.createElement("div");
    complexCol.className = "complex-column";

    const complexHeader = document.createElement("h3");
    complexHeader.textContent = complexName;
    complexCol.appendChild(complexHeader);

    const fields = getFieldsForComplex(complexName);

    const fieldsRow = document.createElement("div");
    fieldsRow.className = "fields-row";

    for (const field of fields) {
      const fieldCol = document.createElement("div");
      fieldCol.className = "field-column";

      const fieldHeader = document.createElement("div");
      fieldHeader.className = "field-header";
      fieldHeader.textContent = field.surface || field.id;
      fieldCol.appendChild(fieldHeader);

      const blocks = getMergedBlocksForField(dayData, field.id);

      for (const b of blocks) {
        fieldCol.appendChild(renderBlockElement(b));
      }

      fieldsRow.appendChild(fieldCol);
    }

    complexCol.appendChild(fieldsRow);
    complexRow.appendChild(complexCol);
  }

  wrapper.appendChild(complexRow);
  container.appendChild(wrapper);
}

/* -------------------------------------------------------
   INIT
------------------------------------------------------- */
async function initCalendar() {
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

    if (view === "week") renderWeekView();
    if (view === "day") renderDayView();
  });
});
