// ===============================
//  CALENDAR ENGINE (PIXEL-PER-MINUTE)
//  Times left, complexes/fields across, blocks + availability
// ===============================

let availabilityData = null;
let currentDate = null;

const DAY_START = 8 * 60;   // 8:00 AM
const DAY_END   = 21 * 60;  // 9:00 PM
const PIXELS_PER_MINUTE = 1;

// -------------------------------
// INIT
// -------------------------------
function initCalendar() {
  fetch("data/availability.json") // correct path under /field-calendar/
    .then(r => r.json())
    .then(data => {
      availabilityData = data;
      currentDate = new Date(data.season_start + "T00:00:00");
      showDay(currentDate);
    })
    .catch(err => console.error("Failed to load availability.json", err));
}

// -------------------------------
// DATE HELPERS
// -------------------------------
function dateKey(d) {
  return d.toISOString().split("T")[0];
}

function displayDate(d) {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric"
  });
}

function changeDay(offset) {
  currentDate = new Date(currentDate.getTime() + offset * 86400000);
  showDay(currentDate);
}

// -------------------------------
// TIME / FIELD HELPERS
// -------------------------------
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function buildFieldIndex(fields) {
  const map = {};
  fields.forEach(f => map[f.id] = f);
  return map;
}

// -------------------------------
// RENDER DAY VIEW
// -------------------------------
function showDay(dateObj) {
  const key = dateKey(dateObj);
  const day = availabilityData.days[key];

  const calendar = document.getElementById("calendar");
  calendar.innerHTML = "";

  const header = document.createElement("h2");
  header.textContent = `Day View — ${displayDate(dateObj)}`;
  calendar.appendChild(header);

  if (!day) {
    calendar.innerHTML += "<p>No data for this date.</p>";
    return;
  }

  // Build lookup table for field names
  const fieldsById = buildFieldIndex(day.fields);
  const complexes = day.complexes;

  // Main grid wrapper
  const grid = document.createElement("div");
  grid.id = "calendar-grid";

  // Time column (left side)
  const timeCol = document.createElement("div");
  timeCol.className = "time-column";
  timeCol.style.height = `${(DAY_END - DAY_START) * PIXELS_PER_MINUTE}px`;
  grid.appendChild(timeCol);

  // Field columns (right side)
  const fieldsContainer = document.createElement("div");
  fieldsContainer.className = "fields-container";
  fieldsContainer.style.height = `${(DAY_END - DAY_START) * PIXELS_PER_MINUTE}px`;
  grid.appendChild(fieldsContainer);

  calendar.appendChild(grid);

  // Render time labels down the left
  renderTimeLabels(timeCol);

  // Render complexes + fields across the top
  buildFieldColumns(fieldsContainer, fieldsById, complexes);

  // Render merged blocks (free + events + practices + games)
  renderBlocks(day, fieldsById);
}



// -------------------------------
// TIME LABELS
// -------------------------------
function renderTimeLabels(col) {
  for (let h = 8; h <= 21; h++) {
    const top = (h * 60 - DAY_START) * PIXELS_PER_MINUTE;
    const label = document.createElement("div");
    label.className = "time-label";
    label.style.top = `${top}px`;
    const hh = ((h + 11) % 12) + 1;
    const ampm = h >= 12 ? "PM" : "AM";
    label.textContent = `${hh}:00 ${ampm}`;
    col.appendChild(label);
  }
}

// -------------------------------
// FIELD COLUMNS (BY COMPLEX)
// -------------------------------
function buildFieldColumns(container, fieldsById, complexes) {
  container.innerHTML = "";

  Object.keys(complexes).forEach(complex => {
    const group = document.createElement("div");
    group.className = "complex-group";

    const title = document.createElement("div");
    title.className = "complex-title";
    title.textContent = complex;
    group.appendChild(title);

    complexes[complex].forEach(fid => {
      const field = fieldsById[fid];
      if (!field) return;

      const col = document.createElement("div");
      col.className = "field-column";
      col.dataset.field = fid;

      const label = document.createElement("div");
      label.className = "field-label";
      label.textContent = field.name;
      col.appendChild(label);

      group.appendChild(col);
    });

    container.appendChild(group);
  });
}

// -------------------------------
// BLOCK RENDERING (events + blocks)
// -------------------------------
function renderBlocks(day, fieldsById) {
  const merged = day.merged || [];

  merged.forEach(block => {
    const fid = block.field;
    const col = document.querySelector(`.field-column[data-field="${fid}"]`);
    if (!col) return;

    const startMin = toMinutes(block.start);
    const endMin   = toMinutes(block.end);
    const top      = (startMin - DAY_START) * PIXELS_PER_MINUTE;
    const height   = (endMin - startMin) * PIXELS_PER_MINUTE;

    const div = document.createElement("div");
    div.className = `block block-${block.type || "practice"}`;
    div.style.top = `${top}px`;
    div.style.height = `${height}px`;

    const title = block.title || block.team || block.reason || block.type || "";
    const timeLabel = `${block.start_12 || block.start} – ${block.end_12 || block.end}`;

    div.innerHTML = `
      <div class="block-title">${title}</div>
      <div class="block-time">${timeLabel}</div>
    `;

    col.appendChild(div);
  });
}


// -------------------------------
// AVAILABILITY RENDERING
// -------------------------------
function renderAvailability(day, fieldsById) {
  const availBlocks = (day.availability && day.availability.blocks) || [];

  availBlocks.forEach(a => {
    if (!a.start || !a.end || !a.fields) return;

    const startMin = toMinutes(a.start);
    const endMin   = toMinutes(a.end);
    const top      = (startMin - DAY_START) * PIXELS_PER_MINUTE;
    const height   = (endMin - startMin) * PIXELS_PER_MINUTE;

    a.fields.forEach(fid => {
      const col = document.querySelector(`.field-column[data-field="${fid}"]`);
      if (!col) return;

      const div = document.createElement("div");
      div.className = "block block-available";
      div.style.top = `${top}px`;
      div.style.height = `${height}px`;
      div.textContent = "Available";

      col.appendChild(div);
    });
  });
}

// -------------------------------
// WEEK / MONTH STUBS (for now)
// -------------------------------
function showWeek(dateObj) {
  const calendar = document.getElementById("calendar");
  calendar.innerHTML = "<p>Week view will render 7 day views side by side (not implemented yet).</p>";
}

function showMonth(dateObj) {
  const calendar = document.getElementById("calendar");
  calendar.innerHTML = "<p>Month view will render weeks grid (not implemented yet).</p>";
}
