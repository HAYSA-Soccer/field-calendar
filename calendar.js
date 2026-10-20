// -------------------------------
// BLOCK RENDERING (merged blocks + merged availability)
// -------------------------------
function renderBlocks(day, fieldsById) {

  // ======================================================
  // 1. FIELD-SPECIFIC BLOCKS (events, practices, admin)
  // ======================================================
  const merged = day.merged || [];

  merged.forEach(block => {

    // Each block has a single field ID
    const fid = block.field;
    const col = document.querySelector(`.field-column[data-field="${fid}"]`);
    if (!col) return;

    // Compute pixel position
    const startMin = toMinutes(block.start);
    const endMin   = toMinutes(block.end);
    const top      = (startMin - DAY_START) * PIXELS_PER_MINUTE;
    const height   = (endMin - startMin) * PIXELS_PER_MINUTE;

    // Build block div
    const div = document.createElement("div");
    div.className = `block block-${block.type || "free"}`;
    div.style.top = `${top}px`;
    div.style.height = `${height}px`;

    // Title priority: title > team > reason
    const title = block.title || block.team || block.reason || "";
    const timeLabel = `${block.start_12 || block.start} – ${block.end_12 || block.end}`;

    div.innerHTML = `
      <div class="block-title">${title}</div>
      <div class="block-time">${timeLabel}</div>
    `;

    col.appendChild(div);
  });

  // ======================================================
  // 2. COMPLEX-WIDE AVAILABILITY BLOCKS (merged availability)
  // ======================================================
  const mergedAvail = day.merged_availability || {};

  Object.keys(mergedAvail).forEach(complexName => {

    const blocks = mergedAvail[complexName];

    blocks.forEach(block => {

      // Compute pixel position
      const startMin = toMinutes(block.start);
      const endMin   = toMinutes(block.end);
      const top      = (startMin - DAY_START) * PIXELS_PER_MINUTE;
      const height   = (endMin - startMin) * PIXELS_PER_MINUTE;

      // All fields in this complex get the same availability block
      const fieldIds = day.complexes[complexName];

      fieldIds.forEach(fid => {

        const col = document.querySelector(`.field-column[data-field="${fid}"]`);
        if (!col) return;

        const div = document.createElement("div");
        div.className = `block block-free availability-block`;
        div.style.top = `${top}px`;
        div.style.height = `${height}px`;

        const timeLabel = `${block.start_12} – ${block.end_12}`;
        const friendly = block.friendly;

        div.innerHTML = `
          <div class="block-title">${friendly}</div>
          <div class="block-time">${timeLabel}</div>
        `;

        col.appendChild(div);
      });
    });
  });
}
