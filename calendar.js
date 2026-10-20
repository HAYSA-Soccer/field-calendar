// Load a day JSON from GitHub Pages (no Apps Script)
async function loadDay(dateStr) {
  // index.html is at /field-calendar/, JSON is under /field-calendar/data/day/
  const url = `data/day/${dateStr}.json`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const day = await res.json();
    renderDayCalendar(day);
  } catch (e) {
    const container = document.getElementById("calendar");
    container.innerHTML = "";
    container.textContent = `Unable to load data for ${dateStr}: ${e.message}`;
  }
}

/***********************
 * MAIN RENDER FUNCTION
 ***********************/
function renderDayCalendar(day) {
  const container = document.getElementById("calendar");
  container.innerHTML = "";

  // Prefer complex_timeline if present, otherwise fall back to merged
  let complexes = null;

  if (day.complex_timeline) {
    complexes = day.complex_timeline;
  } else if (day.merged && day.complexes) {
    // Fallback: group merged blocks by complex using day.complexes map
    complexes = buildComplexTimelineFromMerged(day);
  }

  if (!complexes) {
    container.textContent = "No timeline data for this date.";
    return;
  }

  Object.keys(complexes).forEach(complexName => {
    const timeline = complexes[complexName];
    const column = renderComplexColumn(complexName, timeline, day);
    container.appendChild(column);
  });
}

/****************************
 * BUILD COMPLEX TIMELINE FROM MERGED (fallback)
 ****************************/
function buildComplexTimelineFromMerged(day) {
  const result = {};

  // day.complexes: { "TURF": ["H-HST", ...], "SUMNER/SEAN JOYCE": ["H-SJ1", ...] }
  const complexMap = day.complexes || {};

  // Initialize arrays
  Object.keys(complexMap).forEach(name => {
    result[name] = [];
  });

  // Each item in day.merged is already a block with fields; assign to complexes
  (day.merged || []).forEach(block => {
    const fields = block.fields || block.game_fields || block.practice_fields || block.admin_fields || block.free_fields || [];
    const complexesForBlock = new Set();

    // Determine which complex(es) this block belongs to based on its fields
    Object.entries(complexMap).forEach(([complexName, fieldList]) => {
      if (fields.some(f => fieldList.includes(f))) {
        complexesForBlock.add(complexName);
      }
    });

    complexesForBlock.forEach(complexName => {
      result[complexName].push(block);
    });
  });

  return result;
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
  // If complex_timeline-style block
  if (block.admin_fields && block.admin_fields.length) return "admin";
  if (block.game_fields && block.game_fields.length) return "game";
  if (block.practice_fields && block.practice_fields.length) return "practice";
  if (block.free_fields && block.free_fields.length) return "free";

  // If merged-style block with type
  if (block.type === "admin") return "admin";
  if (block.type === "game") return "game";
  if (block.type === "practice") return "practice";
  if (block.type === "free" || block.type === "availability") return "free";

  return "free";
}

/****************************
 * GET BLOCK TITLE
 ****************************/
function getBlockTitle(block, day) {
  // If merged-style block already has title
  if (block.title) return block.title;

  // Game blocks from complex_timeline
  if (block.game_fields && block.game_fields.length && day.events) {
    for (const fid of block.game_fields) {
      const evs = day.events[fid] || [];
      const match = evs.find(ev => ev.start === block.start && ev.end === block.end);
      if (match && match.title) return match.title;
    }
  }

  // Admin blocks from complex_timeline
  if (block.admin_fields && block.admin_fields.length && day.blocks) {
    for (const fid of block.admin_fields) {
      const blks = day.blocks[fid] || [];
      const match = blks.find(b => b.start === block.start && b.end === block.end);
      if (match && match.reason) return match.reason;
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
  if (block.free_fields && block.free_fields.length) return block.free_fields;

  // merged-style block
  if (block.fields && block.fields.length) return block.fields;

  return [];
}
