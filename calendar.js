// Load a day JSON from GitHub Pages
async function loadDay(dateStr) {
  const url = `data/day/${dateStr}.json`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

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

  const complexes = day.complexes;
  const merged = day.merged;

  const timeline = buildComplexTimeline(day, complexes, merged);

  Object.keys(timeline).forEach(complexName => {
    const column = renderComplexColumn(complexName, timeline[complexName], day);
    container.appendChild(column);
  });
}

/********************************************
 * BUILD COMPLEX TIMELINE FROM MERGED BLOCKS
 ********************************************/
function buildComplexTimeline(day, complexes, merged) {
  const result = {};

  // Initialize empty arrays per complex
  Object.keys(complexes).forEach(c => result[c] = []);

  // Step 1: assign each merged block to its complex
  merged.forEach(block => {
    const field = block.field;

    Object.entries(complexes).forEach(([complexName, fieldList]) => {
      if (fieldList.includes(field)) {
        result[complexName].push({
          start: block.start,
          end: block.end,
          type: block.type,
          field: field,
          title: block.title || "",
        });
      }
    });
  });

  // Step 2: merge blocks by identical start/end/type
  Object.keys(result).forEach(complexName => {
    const blocks = result[complexName];

    const mergedBlocks = [];

    const map = {}; // key = start|end|type → list of fields + titles

    blocks.forEach(b => {
      const key = `${b.start}|${b.end}|${b.type}`;
      if (!map[key]) map[key] = { start: b.start, end: b.end, type: b.type, fields: [], titles: [] };
      map[key].fields.push(b.field);
      if (b.title) map[key].titles.push(b.title);
    });

    Object.values(map).forEach(mb => mergedBlocks.push(mb));

    result[complexName] = mergedBlocks;
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

  div.classList.add(block.type);

  const title = getBlockTitle(block, day);

  div.innerHTML = `
    <div class="block-time">${block.start} – ${block.end}</div>
    <div class="block-title">${title}</div>
    <div class="block-fields">${block.fields.join(", ")}</div>
  `;

  return div;
}

/****************************
 * GET BLOCK TITLE
 ****************************/
function getBlockTitle(block, day) {
  // If merged block already has title
  if (block.titles && block.titles.length) {
    return block.titles.join(" / ");
  }

  // Try events lookup
  for (const fid of block.fields) {
    const evs = day.events[fid] || [];
    const match = evs.find(ev => ev.start === block.start && ev.end === block.end);
    if (match) return match.title;
  }

  // Try admin lookup
  for (const fid of block.fields) {
    const blks = day.blocks[fid] || [];
    const match = blks.find(b => b.start === block.start && b.end === block.end);
    if (match) return match.reason;
  }

  return "Available";
}
