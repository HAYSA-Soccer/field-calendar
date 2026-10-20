// Fetch a day from backend
async function loadDay(dateStr) {
  const url = `https://script.google.com/macros/s/AKfycbz3dMJtYEYxPmoZmuacrM5dBGZ9Jbh5rW3OFtOQDXYyt2RRW41z41HQ4mui5EVzKJyQ/exec?mode=day_calendar&date=${dateStr}`;
  const res = await fetch(url);
  const day = await res.json();

  renderDayCalendar(day);
}

/***********************
 * MAIN RENDER FUNCTION
 ***********************/
function renderDayCalendar(day) {
  const container = document.getElementById("calendar");
  container.innerHTML = "";

  if (!day || !day.complex_timeline) {
    container.textContent = "No data for this date.";
    return;
  }

  Object.keys(day.complex_timeline).forEach(complexName => {
    const timeline = day.complex_timeline[complexName];
    const column = renderComplexColumn(complexName, timeline, day);
    container.appendChild(column);
  });
}

/****************************
 * RENDER COMPLEX COLUMN
 ****************************/
function renderComplexColumn(complexName, timeline, day) {
  const col = document.createElement("div");
  col.className = "complex-column";

  const header = document.createElement("h2");
  header.textContent = complexName;
  col.appendChild(header);

  timeline.forEach(block => {
    const el = renderTimelineBlock(block, day);
    col.appendChild(el);
  });

  return col;
}

/****************************
 * RENDER TIMELINE BLOCK
 ****************************/
function renderTimelineBlock(block, day) {
  const div = document.createElement("div");
  div.className = "timeline-block";

  const type = getBlockType(block);
  div.classList.add(type);

  const title = getBlockTitle(block, day);
  const fields = getBlockFields(block);

  div.innerHTML = `
    <div class="block-time">${block.start} – ${block.end}</div>
    <div class="block-title">${title}</div>
    <div class="block-fields">${fields.join(", ")}</div>
  `;

  return div;
}

/****************************
 * DETERMINE BLOCK TYPE
 ****************************/
function getBlockType(block) {
  if (block.admin_fields && block.admin_fields.length) return "admin";
  if (block.game_fields && block.game_fields.length) return "game";
  if (block.practice_fields && block.practice_fields.length) return "practice";
  return "free";
}

/****************************
 * GET BLOCK TITLE
 ****************************/
function getBlockTitle(block, day) {
  // Game blocks
  if (block.game_fields && block.game_fields.length) {
    for (const fid of block.game_fields) {
      const evs = day.events && day.events[fid] ? day.events[fid] : [];
      const match = evs.find(ev => ev.start === block.start && ev.end === block.end);
      if (match) return match.title;
    }
  }

  // Admin blocks
  if (block.admin_fields && block.admin_fields.length) {
    for (const fid of block.admin_fields) {
      const blks = day.blocks && day.blocks[fid] ? day.blocks[fid] : [];
      const match = blks.find(b => b.start === block.start && b.end === block.end);
      if (match) return match.reason;
    }
  }

  // Free / practice blocks
  return "Available";
}

/****************************
 * GET FIELDS IN BLOCK
 ****************************/
function getBlockFields(block) {
  if (block.game_fields && block.game_fields.length) return block.game_fields;
  if (block.practice_fields && block.practice_fields.length) return block.practice_fields;
  if (block.admin_fields && block.admin_fields.length) return block.admin_fields;
  return block.free_fields || [];
}
