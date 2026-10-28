/********************************************************************
 * CONSTANTS
 ********************************************************************/
const DAY_START = 8 * 60;
const DAY_END   = 21 * 60;
const PX_PER_MIN = 1;

/********************************************************************
 * GLOBAL REFRESH BANNER
 ********************************************************************/
async function loadGlobalRefreshBanner() {
  const banner = document.getElementById("global-refresh-banner");
  if (!banner) return;

  try {
    const res = await fetch("data/last_updated.json");
    if (!res.ok) throw new Error("Missing last_updated.json");

    const data = await res.json();
    const ts = data.last_successful_update;

    banner.textContent = ts
      ? `Note: Unless otherwise noted, the information below was last updated on: ${ts}.`
      : `Note: Unless otherwise noted, the information below has no prior updated details.`;

    window.lastUpdatedData = data;
  } catch (e) {
    banner.textContent =
      "Note: Unless otherwise noted, the information below has no prior updated details.";
    window.lastUpdatedData = { last_successful_update: null };
  }
}

/********************************************************************
 * DAY LABEL
 ********************************************************************/
function updateDayLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const dayName = d.toLocaleDateString("en-US", { weekday: "long" });
  const pretty = d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  const el = document.getElementById("day-label");
  if (el) el.textContent = `${dayName}, ${pretty}`;
}

/********************************************************************
 * TIME HELPERS
 ********************************************************************/
function parseTime(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function fmt(mins) {
  let h = Math.floor(mins / 60);
  let m = mins % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  h = (h % 12) || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${suffix}`;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/********************************************************************
 * LOAD SINGLE DAY (DAILY VIEW)
 ********************************************************************/
async function loadDay(dateStr) {
  const url = `data/day/${dateStr}.json`;
  const container = document.getElementById("calendar");
  const weeklyContainer = document.getElementById("weekly-view");

  if (weeklyContainer) weeklyContainer.style.display = "none";
  if (container) {
    container.style.display = "flex";
    container.innerHTML = "";
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const day = await res.json();
    renderDayCalendar(day, {
      containerId: "calendar",
      showDayNote: true,
      selectedComplexes: ["all"],
      condensed: false
    });
  } catch (e) {
    if (container) {
      container.innerHTML =
        `<div class="update-note">No stored data exists for this date.</div>`;
    }
  }
}

/********************************************************************
 * FIELD MAP
 ********************************************************************/
function buildFieldMap(day) {
  const map = {};
  (day.fields || []).forEach(f => map[f.id] = f);
  return map;
}

/********************************************************************
 * BUILD BLOCKS — USING REAL FIELD IDs
 ********************************************************************/
function buildBlocks(day, fieldMap) {
  console.log(fieldMap["H-HST1"]);
  const blocks = [];

  (day.merged || []).forEach(b => {
    const fieldId = b.field;
    const f = fieldMap[fieldId];
    if (!f) return;

    blocks.push({
      complex: f.complex,
      fieldId: fieldId,
      fieldName: f.name,
      start: parseTime(b.start),
      end: parseTime(b.end),
      type: b.type,
      title: b.title || (b.type === "free" ? "Available" : "Booked")
    });
  });

  return blocks;
}

/********************************************************************
 * CONFLICT DETECTION — REAL FIELD IDs
 ********************************************************************/
function detectConflicts(blocks) {
  const byField = {};

  blocks.forEach(b => {
    if (!byField[b.fieldId]) byField[b.fieldId] = [];
    byField[b.fieldId].push(b);
  });

  Object.values(byField).forEach(list => {
    list.sort((a, b) => a.start - b.start);

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i];
        const B = list[j];

        if (B.start >= A.end) break;

        const overlap = A.end > B.start;
        if (!overlap) continue;

        const A_isAdmin = A.type === "admin";
        const B_isAdmin = B.type === "admin";

        if (A_isAdmin && B_isAdmin) continue;

        if (A_isAdmin && !B_isAdmin) {
          B.conflict = true;
          continue;
        }

        if (!A_isAdmin && B_isAdmin) {
          A.conflict = true;
          continue;
        }

        A.conflict = true;
        B.conflict = true;
      }
    }
  });

  return blocks;
}

/********************************************************************
 * BUILD AVAILABILITY — PRESERVES MODE
 ********************************************************************/
function buildAvailability(day, fieldMap, blocks) {
  const avail = [];

  const fieldsByComplex = {};
  (day.fields || []).forEach(f => {
    if (!fieldsByComplex[f.complex]) fieldsByComplex[f.complex] = [];
    fieldsByComplex[f.complex].push(f.id);
  });

  Object.keys(fieldsByComplex).forEach(complex => {
    const fields = fieldsByComplex[complex];

    const adminBlocks = blocks.filter(
      b => b.complex === complex && b.type === "admin"
    );

    const timeline = [];
    for (let t = DAY_START; t < DAY_END; t++) {

      const hasAdmin = adminBlocks.some(
        b => t >= b.start && t < b.end
      );

      if (hasAdmin) {
        timeline.push({ minute: t, free: [] });
        continue;
      }

      const bookedFields = new Set();
      blocks.forEach(b => {
        if (b.complex !== complex) return;
        if (b.type === "free") return;
        if (t >= b.start && t < b.end) {
          bookedFields.add(b.fieldId);
        }
      });

      const freeFields = [];

      fields.forEach(fid => {
        const ranges = (day.availability && day.availability[fid]) || [];

        let matchedRange = null;
        ranges.forEach(r => {
          const rs = parseTime(r.start);
          const re = parseTime(r.end);
          if (t >= rs && t < re) {
            matchedRange = r;
          }
        });

        if (matchedRange && !bookedFields.has(fid)) {
          freeFields.push({
            field: fid,
            mode: matchedRange.mode || "both"
          });
        }
      });

      timeline.push({
        minute: t,
        free: freeFields
      });
    }

    let curStart = null;
    let curFields = null;

    timeline.forEach((slot, idx) => {
      const same = JSON.stringify(slot.free) === JSON.stringify(curFields);

      if (curStart === null) {
        curStart = slot.minute;
        curFields = slot.free;
      } else if (!same) {
        if (curFields && curFields.length > 0) {
          avail.push({
            complex,
            start: curStart,
            end: timeline[idx - 1].minute + 1,
            fields: curFields.map(f => f.field),
            modes: curFields.map(f => f.mode)
          });
        }
        curStart = slot.minute;
        curFields = slot.free;
      }
    });

    if (curStart !== null && curFields && curFields.length > 0) {
      avail.push({
        complex,
        start: curStart,
        end: DAY_END,
        fields: curFields.map(f => f.field),
        modes: curFields.map(f => f.mode)
      });
    }
  });

  return avail;
}

/********************************************************************
 * RENDER DAY CALENDAR (USED BY DAILY + WEEKLY)
 ********************************************************************/
function renderDayCalendar(day, options = {}) {
  const {
    containerId = "calendar",
    showDayNote = true,
    selectedComplexes = ["all"],
    condensed = false
  } = options;

  const dayNote = document.getElementById("day-note");
  const container = document.getElementById(containerId);
  if (!container) return;

  if (showDayNote && dayNote) {
    dayNote.innerHTML = "";

    if (!day.updated) {
      const ts =
        day.last_successful_update ||
        (window.lastUpdatedData && window.lastUpdatedData.last_successful_update);

      dayNote.innerHTML =
        `<div class="update-note">${
          ts
            ? `Note: This day's data was last updated on: ${ts}.`
            : `Note: This day's data has never been updated.`
        }</div>`;
    }
  }

  container.innerHTML = "";

  const fieldMap = buildFieldMap(day);
  const blocks = buildBlocks(day, fieldMap);

  detectConflicts(blocks);

  const availability = buildAvailability(day, fieldMap, blocks);

  const eventsByComplex = {};
  blocks.forEach(b => {
    if (b.type === "free") return;
    if (!eventsByComplex[b.complex]) eventsByComplex[b.complex] = [];
    eventsByComplex[b.complex].push(b);
  });

  const showAll = selectedComplexes.includes("all");
  const normalize = s => s.toLowerCase().trim();
  const selectedNormalized = selectedComplexes.map(normalize);

  const complexKeys = Object.keys(day.complexes || {});

  complexKeys
    .filter(complex => {
      if (showAll) return true;
      return selectedNormalized.includes(normalize(complex));
    })
    .forEach(complex => {
      container.appendChild(
        renderComplexTimeline(
          complex,
          eventsByComplex[complex] || [],
          availability.filter(a => a.complex === complex),
          condensed,
          day,
          true
        )
      );
    });
}

/********************************************************************
 * UNIFIED LANE SYSTEM — EVENTS + AVAILABILITY
 ********************************************************************/
function renderComplexTimeline(complex, events, availability, condensed, day, showHours = true) {
  const div = document.createElement("div");
  div.className = "complex";

  const header = document.createElement("div");
  header.className = "complex-header";
  header.textContent = complex;
  div.appendChild(header);

  const timeline = document.createElement("div");
  timeline.className = "timeline";

  let hours = null;

  if (showHours) {
    hours = document.createElement("div");
    hours.className = "hours";
  
    for (let t = DAY_START; t <= DAY_END; t += 60) {
      const h = document.createElement("div");
      h.className = "hour";
      h.style.top = ((t - DAY_START) * PX_PER_MIN) + "px";
      h.textContent = fmt(t);
      hours.appendChild(h);
    }
  }

  const track = document.createElement("div");
  track.className = "events-track";
  track.style.height = ((DAY_END - DAY_START) * PX_PER_MIN) + "px";

  // Sunset indicator (daily + weekly)
  if (day && day.sunset) {
    const sunsetMin = parseTime(day.sunset);
    const sunsetTop = (sunsetMin - DAY_START) * PX_PER_MIN;

    const sunsetLine = document.createElement("div");
    sunsetLine.className = "sunset-line";
    sunsetLine.style.top = `${sunsetTop}px`;

    const sunsetLabel = document.createElement("div");
    sunsetLabel.className = "sunset-label";
    sunsetLabel.textContent = "";
    sunsetLabel.style.top = `${sunsetTop - 12}px`;

    track.appendChild(sunsetLine);
    track.appendChild(sunsetLabel);
  }

  const blocks = [];

  events.forEach(e => {
    console.log(e);
    blocks.push({
      kind: "event",
      title: e.title,
      fieldId: e.fieldId,
      fieldName: e.fieldName || e.fieldId,
      type: e.type,
      conflict: e.conflict,
      start: e.start,
      end: e.end
    });
  });

  availability.forEach(a => {
    blocks.push({
      kind: "avail",
      title: "Available",
      fields: a.fields,
      modes: a.modes,
      start: a.start,
      end: a.end
    });
  });

  const lanes = [];

  blocks
    .filter(b => b.kind === "event")
    .sort((a, b) => a.start - b.start)
    .forEach(b => {
      let laneIndex = 0;
      while (true) {
        const lane = lanes[laneIndex] || [];
        const conflict = lane.some(x => overlaps(x.start, x.end, b.start, b.end));
        if (!conflict) {
          lane.push(b);
          lanes[laneIndex] = lane;
          b.lane = laneIndex;
          break;
        }
        laneIndex++;
      }
    });

  const eventLaneCount = lanes.length;
  const totalLaneCount = eventLaneCount + 1;

  blocks.forEach(b => {
    const block = document.createElement("div");
    block.className = "block";

    if (b.kind === "event") {
      block.classList.add("event-block");
      block.classList.add(b.type);
      if (b.conflict) block.classList.add("conflict");

      const shortTitle = condensed
        ? b.title.replace(/Travel/gi, "Trvl").replace(/Practice/gi, "Prac")
        : b.title;

      block.innerHTML = `
        <div class="block-main">
          <div class="block-title">${shortTitle}</div>
          <div class="block-fields">${b.fieldName}</div>
          <div class="block-time">${fmt(b.start)} – ${fmt(b.end)}</div>
          <div class="block-tooltip">
            <div><strong>Team:</strong> ${b.title}</div>
            <div><strong>Field:</strong> ${b.fieldName}</div>
            <div><strong>Complex:</strong> ${complex}</div>
            <div><strong>Time:</strong> ${fmt(b.start)} – ${fmt(b.end)}</div>
          </div>
        </div>
      `;

      const laneWidth = 100 / totalLaneCount;
      block.style.left = (b.lane * laneWidth) + "%";
      block.style.width = laneWidth + "%";

    } else {
      block.classList.add("avail-block");

      const label = condensed ? "Avail" : "Available";

      const fieldsText = condensed
        ? `${b.fields.length} field(s)`
        : b.fields.join(", ");

      block.innerHTML = `
        <div class="block-main">
          <div class="block-title">${label}</div>
          <div class="block-fields">${fieldsText}</div>
          <div class="block-time">${fmt(b.start)} – ${fmt(b.end)}</div>
          <div class="block-tooltip">
            <div><strong>Complex:</strong> ${complex}</div>
            <div><strong>Fields:</strong> ${b.fields.join(", ")}</div>
            <div><strong>Time:</strong> ${fmt(b.start)} – ${fmt(b.end)}</div>
          </div>
        </div>
      `;

      const overlappingEventLanes = new Set();

      blocks
        .filter(x => x.kind === "event")
        .forEach(x => {
          if (overlaps(x.start, x.end, b.start, b.end)) {
            overlappingEventLanes.add(x.lane);
          }
        });

      const laneWidth = 100 / totalLaneCount;

      const freeLanes = [...Array(totalLaneCount).keys()].filter(
        i => !overlappingEventLanes.has(i)
      );

      const spanStart = Math.min(...freeLanes);
      const spanEnd = Math.max(...freeLanes);

      block.style.left = (spanStart * laneWidth) + "%";
      block.style.width = ((spanEnd - spanStart + 1) * laneWidth) + "%";
    }

    block.style.top = ((b.start - DAY_START) * PX_PER_MIN) + "px";
    block.style.height = ((b.end - b.start) * PX_PER_MIN) + "px";

    track.appendChild(block);
  });

  if (hours) {
    timeline.appendChild(hours);
  }
  
  timeline.appendChild(track);
  div.appendChild(timeline);
  return div;
  }

/********************************************************************
 * WEEKLY VIEW HELPERS
 ********************************************************************/
function getMonday(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0 = Sun
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split("T")[0];
}

/********************************************************************
 * WEEKLY VIEW — LOAD 7 DAYS SIDE BY SIDE
 ********************************************************************/
async function loadWeek(dateStr) {
  const weeklyContainer = document.getElementById("weekly-view");
  const dailyContainer = document.getElementById("calendar");
  const dayNote = document.getElementById("day-note");

  if (dailyContainer) dailyContainer.style.display = "none";
  if (weeklyContainer) weeklyContainer.style.display = "flex";
  if (dayNote) dayNote.innerHTML = "";

  if (!weeklyContainer) return;
  weeklyContainer.innerHTML = "";

  const mondayStr = getMonday(dateStr);
  const monday = new Date(mondayStr + "T00:00:00");

  const select = document.getElementById("complex-filter");
  let selectedComplexes = ["all"];
  if (select) {
    const selected = Array.from(select.selectedOptions).map(o => o.value);
    if (selected.length > 0) {
      selectedComplexes = selected;
    }
  }

  const todayStr = dateStr; // highlight week anchored to loaded date

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateKey = d.toISOString().split("T")[0];

    const dayDiv = document.createElement("div");
    dayDiv.className = "weekly-day";

    const header = document.createElement("div");
    header.className = "weekly-day-header";

    const pretty = d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric"
    });

    header.textContent = pretty;

    if (dateKey === todayStr) {
      dayDiv.classList.add("today");
      const badge = document.createElement("span");
      badge.textContent = "Today";
      badge.style.marginLeft = "8px";
      badge.style.fontSize = "12px";
      badge.style.color = "#1976d2";
      header.appendChild(badge);
    }

    dayDiv.appendChild(header);

    const complexRow = document.createElement("div");
    complexRow.className = "weekly-complex-row";
    complexRow.style.display = "flex";
    complexRow.style.gap = "12px";

    dayDiv.appendChild(complexRow);
    weeklyContainer.appendChild(dayDiv);

    try {
      const res = await fetch(`data/day/${dateKey}.json`);
      if (!res.ok) {
        complexRow.innerHTML =
          `<div class="update-note">No data for this day.</div>`;
        continue;
      }

      const dayData = await res.json();

      const fieldMap = buildFieldMap(dayData);
      const blocks = buildBlocks(dayData, fieldMap);
      detectConflicts(blocks);
      const availability = buildAvailability(dayData, fieldMap, blocks);

      const eventsByComplex = {};
      blocks.forEach(b => {
        if (b.type === "free") return;
        if (!eventsByComplex[b.complex]) eventsByComplex[b.complex] = [];
        eventsByComplex[b.complex].push(b);
      });

      const showAll = selectedComplexes.includes("all");
      const normalize = s => s.toLowerCase().trim();
      const selectedNormalized = selectedComplexes.map(normalize);

      const complexKeys = Object.keys(dayData.complexes || {});

      complexKeys
        .filter(complex => {
          if (showAll) return true;
          return selectedNormalized.includes(normalize(complex));
        })
        .forEach((complex, complexIndex) => {
          const complexTimeline = renderComplexTimeline(
            complex,
            eventsByComplex[complex] || [],
            availability.filter(a => a.complex === complex),
            true, // condensed in weekly view
            dayData,
            i === 0 && complexIndex === 0
          );
          complexRow.appendChild(complexTimeline);
        });

    } catch (e) {
      complexRow.innerHTML =
        `<div class="update-note">Unable to load data for this day.</div>`;
    }
  }
}

/********************************************************************
 * COMPLEX FILTER — MULTI-SELECT
 ********************************************************************/
async function initComplexFilter() {
  const select = document.getElementById("complex-filter");
  if (!select) return;

  try {
    const res = await fetch("fields.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const complexesObj = data.complexes || {};
    const complexNames = Object.keys(complexesObj);

    select.innerHTML = "";

    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All Complexes";
    select.appendChild(allOption);

    complexNames.forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });
  } catch (e) {
    select.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All Complexes";
    select.appendChild(allOption);
  }
}

/********************************************************************
 * INITIALIZE — WEEKLY DEFAULT + TOGGLE
 ********************************************************************/
document.addEventListener("DOMContentLoaded", async () => {
  await initComplexFilter();
  loadGlobalRefreshBanner();

  const dateInput = document.getElementById("calendar-date");
  const todayStr = new Date().toISOString().split("T")[0];
  if (dateInput) {
    dateInput.value = todayStr;
    updateDayLabel(todayStr);
  }

  const calendarEl = document.getElementById("calendar");
  const weeklyEl = document.getElementById("weekly-view");

  // Default to WEEKLY view
  if (calendarEl) calendarEl.style.display = "none";
  if (weeklyEl) weeklyEl.style.display = "flex";
  await loadWeek(todayStr);

  const loadBtn = document.getElementById("load-date");
  if (loadBtn && dateInput) {
    loadBtn.addEventListener("click", () => {
      const d = dateInput.value;
      if (d) {
        updateDayLabel(d);
        if (weeklyEl && weeklyEl.style.display !== "none") {
          loadWeek(d);
        } else {
          loadDay(d);
        }
      }
    });
  }

  const prevBtn = document.getElementById("prev-day");
  const nextBtn = document.getElementById("next-day");
  const todayBtn = document.getElementById("today");

  function isWeeklyMode() {
    return weeklyEl && weeklyEl.style.display !== "none";
  }

  if (prevBtn && dateInput) {
    prevBtn.addEventListener("click", () => {
      const d = new Date(dateInput.value);
      if (isWeeklyMode()) {
        d.setDate(d.getDate() - 7);
      } else {
        d.setDate(d.getDate() - 1);
      }
      const newDate = d.toISOString().split("T")[0];
      dateInput.value = newDate;
      updateDayLabel(newDate);
      if (isWeeklyMode()) {
        loadWeek(newDate);
      } else {
        loadDay(newDate);
      }
    });
  }

  if (nextBtn && dateInput) {
    nextBtn.addEventListener("click", () => {
      const d = new Date(dateInput.value);
      if (isWeeklyMode()) {
        d.setDate(d.getDate() + 7);
      } else {
        d.setDate(d.getDate() + 1);
      }
      const newDate = d.toISOString().split("T")[0];
      dateInput.value = newDate;
      updateDayLabel(newDate);
      if (isWeeklyMode()) {
        loadWeek(newDate);
      } else {
        loadDay(newDate);
      }
    });
  }

  if (todayBtn && dateInput) {
    todayBtn.addEventListener("click", () => {
      const today = new Date().toISOString().split("T")[0];
      dateInput.value = today;
      updateDayLabel(today);
      if (isWeeklyMode()) {
        loadWeek(today);
      } else {
        loadDay(today);
      }
    });
  }

  const toggleDaily = document.getElementById("toggle-daily");
  const toggleWeekly = document.getElementById("toggle-weekly");

  if (toggleDaily && toggleWeekly && dateInput) {
    toggleDaily.addEventListener("click", () => {
      if (calendarEl) calendarEl.style.display = "flex";
      if (weeklyEl) weeklyEl.style.display = "none";
      const d = dateInput.value || todayStr;
      updateDayLabel(d);
      loadDay(d);
    });

    toggleWeekly.addEventListener("click", () => {
      if (calendarEl) calendarEl.style.display = "none";
      if (weeklyEl) weeklyEl.style.display = "flex";
      const d = dateInput.value || todayStr;
      updateDayLabel(d);
      loadWeek(d);
    });
  }

  const complexSelect = document.getElementById("complex-filter");
  if (complexSelect && dateInput) {
    complexSelect.addEventListener("change", () => {
      const d = dateInput.value || todayStr;
      if (weeklyEl && weeklyEl.style.display !== "none") {
        loadWeek(d);
      }
    });
  }
});
