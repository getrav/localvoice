// LocalVoice — Frontend
// Vanilla JS, no dependencies

(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────────────

  let currentPage = 0;
  let pageSize = 25;
  let expandedRow = null;
  let cachedSpeakers = null;

  // ── Tab Switching ──────────────────────────────────────────────────

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("tab-" + tab.dataset.tab).classList.add("active");

      // Trigger data loads on tab switch
      if (tab.dataset.tab === "stt") populateSttModels();
      if (tab.dataset.tab === "speakers") loadSpeakers();
      if (tab.dataset.tab === "sync") { loadSyncProgress(); loadSyncTable(); initSyncCountdown(); startProcessingPoll(); }
      else { stopProcessingPoll(); }
    });
  });

  // ── Health Panel ───────────────────────────────────────────────────

  async function checkHealth() {
    try {
      const resp = await fetch("/api/health");
      const services = await resp.json();
      services.forEach((svc) => {
        const dot = document.querySelector(`.health-dot[data-service="${svc.name}"]`);
        if (dot) {
          dot.className = "health-dot " + (svc.status === "healthy" ? "healthy" : "error");
        }

        // Disable TTS engine radio buttons for unavailable services
        if (svc.name === "piper" || svc.name === "kokoro") {
          const radio = document.querySelector(`input[name="tts-engine"][value="${svc.name}"]`);
          if (radio) {
            const label = radio.parentElement;
            if (svc.status !== "healthy") {
              radio.disabled = true;
              label.classList.add("engine-unavailable");
              label.title = `${svc.name === "kokoro" ? "Kokoro" : "Piper"} TTS service is not running`;
              if (radio.checked) {
                const other = document.querySelector(`input[name="tts-engine"]:not([value="${svc.name}"])`);
                if (other && !other.disabled) {
                  other.checked = true;
                  other.dispatchEvent(new Event("change"));
                }
              }
            } else {
              radio.disabled = false;
              label.classList.remove("engine-unavailable");
              label.title = "";
            }
          }
        }
      });
    } catch {
      document.querySelectorAll(".health-dot").forEach((d) => (d.className = "health-dot error"));
    }
  }

  checkHealth();
  setInterval(checkHealth, 30000);

  // ── Recordings ─────────────────────────────────────────────────────

  const recordingsBody = document.getElementById("recordings-body");
  const recordingsLoading = document.getElementById("recordings-loading");
  const recordingsEmpty = document.getElementById("recordings-empty");
  const prevBtn = document.getElementById("prev-page");
  const nextBtn = document.getElementById("next-page");
  const pageInfo = document.getElementById("page-info");
  const pageSizeSelect = document.getElementById("page-size");

  async function loadRecordings() {
    recordingsLoading.hidden = false;
    recordingsEmpty.hidden = true;
    recordingsBody.innerHTML = "";
    expandedRow = null;

    try {
      const skip = currentPage * pageSize;
      const resp = await fetch(`/api/recordings?top=${pageSize}&skip=${skip}`);
      const data = await resp.json();
      if (data.error && !data.value) {
        throw new Error(data.error);
      }
      const recordings = Array.isArray(data.value) ? data.value : Array.isArray(data) ? data : [];

      recordingsLoading.hidden = true;

      if (recordings.length === 0) {
        recordingsEmpty.hidden = false;
        nextBtn.disabled = true;
        return;
      }

      recordings.forEach((rec) => {
        const tr = document.createElement("tr");
        const duration = rec.StartTime && rec.EndTime
          ? (new Date(rec.EndTime) - new Date(rec.StartTime)) / 1000
          : rec.Duration;
        const caller = rec.FromDisplayName || rec.FromCallerNumber || rec.Caller || "";
        const called = rec.ToDisplayName || rec.ToCallerNumber || rec.Called || "";
        tr.innerHTML = `
          <td><button class="expand-btn">&#9654;</button></td>
          <td>${esc(rec.Id)}</td>
          <td>${formatDate(rec.StartTime || rec.CallTime)}</td>
          <td>${formatDuration(duration)}</td>
          <td>${esc(caller)}</td>
          <td>${esc(called)}</td>
          <td>${esc(rec.CallType || "")}</td>
        `;

        tr.addEventListener("click", () => toggleDetail(tr, rec));
        recordingsBody.appendChild(tr);
      });

      prevBtn.disabled = currentPage === 0;
      nextBtn.disabled = recordings.length < pageSize;
      pageInfo.textContent = `Page ${currentPage + 1}`;
    } catch (err) {
      recordingsLoading.hidden = true;
      recordingsBody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--red)">Error loading recordings: ${esc(err.message)}</td></tr>`;
    }
  }

  function toggleDetail(tr, rec) {
    const btn = tr.querySelector(".expand-btn");
    const existing = tr.nextElementSibling;

    if (existing && existing.classList.contains("detail-row")) {
      existing.remove();
      btn.classList.remove("open");
      expandedRow = null;
      return;
    }

    // Close any other open detail
    if (expandedRow) {
      const oldBtn = expandedRow.previousElementSibling?.querySelector(".expand-btn");
      if (oldBtn) oldBtn.classList.remove("open");
      expandedRow.remove();
      expandedRow = null;
    }

    btn.classList.add("open");

    const detailTr = document.createElement("tr");
    detailTr.classList.add("detail-row");
    detailTr.innerHTML = `
      <td colspan="7">
        <div class="detail-content">
          <audio controls preload="none" src="/api/recordings/${rec.Id}/audio"></audio>
          <div class="detail-actions">
            <a href="/api/recordings/${rec.Id}/audio" download="recording_${rec.Id}">Download</a>
          </div>
          <div class="call-info-section" id="call-info-${rec.Id}">
            <button class="call-info-toggle" data-rec-id="${rec.Id}">&#9654; Call Info</button>
            <div class="call-info-body" id="call-info-body-${rec.Id}" hidden></div>
          </div>
          <div class="train-panel" id="train-panel-${rec.Id}">
            <span class="train-label">Train:</span>
            <button class="btn-mark" data-action="set-start">Set Start</button>
            <span class="time-display" id="train-start-${rec.Id}">--:--</span>
            <span style="color:var(--text-muted)">—</span>
            <button class="btn-mark" data-action="set-end">Set End</button>
            <span class="time-display" id="train-end-${rec.Id}">--:--</span>
            <select id="train-speaker-${rec.Id}"><option value="">Speaker…</option></select>
            <input type="text" class="new-speaker-input" id="train-new-name-${rec.Id}" placeholder="New name…" style="display:none">
            <button class="btn-enroll" id="train-enroll-${rec.Id}" disabled>Enroll Clip</button>
          </div>
          <div class="edit-toolbar" id="edit-toolbar-${rec.Id}" style="display:none">
            <select id="edit-from-${rec.Id}"></select>
            <span class="arrow">→</span>
            <select id="edit-to-${rec.Id}"><option value="">Speaker…</option></select>
            <input type="text" class="custom-name" id="edit-custom-${rec.Id}" placeholder="Custom name…" style="display:none">
            <button class="btn-sm" id="edit-apply-${rec.Id}">Apply All</button>
            <button class="btn-save" id="edit-save-${rec.Id}" disabled>Save Changes</button>
          </div>
          <div class="transcription-container" id="transcription-${rec.Id}">
            <div class="loading">Loading transcription...</div>
          </div>
          ${rec.Summary ? `<div class="summary"><strong>Summary:</strong> ${esc(rec.Summary)}</div>` : ""}
        </div>
      </td>
    `;

    // Prevent row click from toggling when clicking inside detail
    detailTr.addEventListener("click", (e) => e.stopPropagation());

    tr.after(detailTr);
    expandedRow = detailTr;

    // Call Info toggle
    const callInfoToggle = detailTr.querySelector(`[data-rec-id="${rec.Id}"]`);
    if (callInfoToggle) {
      callInfoToggle.addEventListener("click", () => {
        const body = detailTr.querySelector(`#call-info-body-${rec.Id}`);
        const isOpen = !body.hidden;
        body.hidden = isOpen;
        callInfoToggle.classList.toggle("open", !isOpen);
        if (!isOpen && !body.dataset.loaded) {
          loadCallInfo(rec.Id, body);
        }
      });
    }

    // Fetch detail with segments
    loadRecordingDetail(rec, detailTr);
  }

  async function loadCallInfo(recId, container) {
    container.innerHTML = '<div class="loading" style="padding:8px">Loading call info...</div>';
    container.dataset.loaded = "1";
    try {
      const resp = await fetch(`/api/recordings/${recId}/call-log`);
      const data = await resp.json();
      if (!data.segments || data.segments.length === 0) {
        container.innerHTML = '<div style="padding:8px;color:var(--text-muted);font-size:0.8rem">No call log data available</div>';
        return;
      }
      let html = '<table class="call-info-table"><thead><tr>' +
        '<th>From</th><th>To</th><th>Type</th><th>Action</th><th>Ring</th><th>Talk</th>' +
        '</tr></thead><tbody>';
      for (const seg of data.segments) {
        const srcLabel = seg.source_name || seg.source_number || "-";
        const dstLabel = seg.dest_name || seg.dest_number || "-";
        const typeLabel = [seg.source_type, seg.dest_type].filter(Boolean).join(" → ") || "-";
        const ring = seg.ring_time != null ? formatDuration(seg.ring_time) : "-";
        const talk = seg.talk_time != null ? formatDuration(seg.talk_time) : "-";
        html += `<tr>` +
          `<td>${esc(String(srcLabel))}</td>` +
          `<td>${esc(String(dstLabel))}</td>` +
          `<td>${esc(String(typeLabel))}</td>` +
          `<td>${esc(String(seg.reason || "-"))}</td>` +
          `<td>${ring}</td>` +
          `<td>${talk}</td>` +
          `</tr>`;
      }
      html += '</tbody></table>';
      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = `<div style="padding:8px;color:var(--red);font-size:0.8rem">Error loading call info: ${esc(err.message)}</div>`;
    }
  }

  async function loadRecordingDetail(rec, detailTr) {
    const container = detailTr.querySelector(`#transcription-${rec.Id}`);
    const audio = detailTr.querySelector("audio");

    // Fetch enrolled speakers (cached)
    if (!cachedSpeakers) {
      try {
        const sr = await fetch("/api/speakers");
        if (sr.ok) { const d = await sr.json(); cachedSpeakers = d.speakers || []; }
        else cachedSpeakers = [];
      } catch { cachedSpeakers = []; }
    }

    // Populate train panel speaker dropdown
    const trainSelect = detailTr.querySelector(`#train-speaker-${rec.Id}`);
    const trainNewName = detailTr.querySelector(`#train-new-name-${rec.Id}`);
    const trainEnroll = detailTr.querySelector(`#train-enroll-${rec.Id}`);
    trainSelect.innerHTML = '<option value="">Speaker…</option>';
    cachedSpeakers.forEach(s => {
      trainSelect.insertAdjacentHTML("beforeend", `<option value="${esc(s.name)}">${esc(s.name)}</option>`);
    });
    trainSelect.insertAdjacentHTML("beforeend", '<option value="__new__">New speaker…</option>');
    trainSelect.addEventListener("change", () => {
      trainNewName.style.display = trainSelect.value === "__new__" ? "" : "none";
      updateTrainButton();
    });
    trainNewName.addEventListener("input", updateTrainButton);

    // Train panel time markers
    let trainStart = null, trainEnd = null;
    const startDisplay = detailTr.querySelector(`#train-start-${rec.Id}`);
    const endDisplay = detailTr.querySelector(`#train-end-${rec.Id}`);

    detailTr.querySelector('[data-action="set-start"]').addEventListener("click", () => {
      trainStart = audio.currentTime;
      startDisplay.textContent = fmtTime(trainStart);
      updateTrainButton();
    });
    detailTr.querySelector('[data-action="set-end"]').addEventListener("click", () => {
      trainEnd = audio.currentTime;
      endDisplay.textContent = fmtTime(trainEnd);
      updateTrainButton();
    });

    function getTrainSpeaker() {
      return trainSelect.value === "__new__" ? trainNewName.value.trim() : trainSelect.value;
    }
    function updateTrainButton() {
      trainEnroll.disabled = !(trainStart != null && trainEnd != null && trainEnd > trainStart && getTrainSpeaker());
    }

    trainEnroll.addEventListener("click", async () => {
      const name = getTrainSpeaker();
      if (!name) return;
      trainEnroll.disabled = true;
      trainEnroll.textContent = "Enrolling…";
      try {
        const resp = await fetch(`/api/recordings/${rec.Id}/enroll-clip`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start: trainStart, end: trainEnd, speaker_name: name }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Failed");
        trainEnroll.textContent = "Enrolled!";
        cachedSpeakers = null; // bust cache
        setTimeout(() => { trainEnroll.textContent = "Enroll Clip"; updateTrainButton(); }, 2000);
      } catch (err) {
        trainEnroll.textContent = "Error";
        setTimeout(() => { trainEnroll.textContent = "Enroll Clip"; trainEnroll.disabled = false; }, 2000);
      }
    });

    try {
      const resp = await fetch(`/api/recordings/${rec.Id}/detail`);
      if (!resp.ok) throw new Error(`${resp.status}`);
      const detail = await resp.json();

      if (detail.segments && detail.segments.length > 0) {
        let segments = detail.segments;
        container.innerHTML = renderSegments(segments, detail.from_display_name, detail.to_display_name);

        // Show edit toolbar
        const toolbar = detailTr.querySelector(`#edit-toolbar-${rec.Id}`);
        toolbar.style.display = "";

        // Populate "from" dropdown with unique speakers
        const fromSelect = detailTr.querySelector(`#edit-from-${rec.Id}`);
        const uniqueSpeakers = [...new Set(segments.map(s => s.speaker).filter(Boolean))];
        fromSelect.innerHTML = "";
        uniqueSpeakers.forEach(sp => {
          fromSelect.insertAdjacentHTML("beforeend", `<option value="${esc(sp)}">${esc(sp)}</option>`);
        });

        // Populate "to" dropdown with call participants + enrolled speakers
        const toSelect = detailTr.querySelector(`#edit-to-${rec.Id}`);
        const customInput = detailTr.querySelector(`#edit-custom-${rec.Id}`);
        toSelect.innerHTML = '<option value="">Speaker…</option>';

        // Call participants from 3CX metadata
        const participants = [detail.from_display_name, detail.to_display_name].filter(Boolean);
        const uniqueParticipants = [...new Set(participants)];
        const enrolledNames = new Set((cachedSpeakers || []).map(s => s.name));
        const filteredParticipants = uniqueParticipants.filter(p => !enrolledNames.has(p));
        if (filteredParticipants.length > 0) {
          toSelect.insertAdjacentHTML("beforeend", '<optgroup label="Call Participants">');
          filteredParticipants.forEach(p => {
            toSelect.insertAdjacentHTML("beforeend", `<option value="${esc(p)}">${esc(p)}</option>`);
          });
          toSelect.insertAdjacentHTML("beforeend", '</optgroup>');
        }
        if (cachedSpeakers && cachedSpeakers.length > 0) {
          toSelect.insertAdjacentHTML("beforeend", '<optgroup label="Enrolled Speakers">');
          cachedSpeakers.forEach(s => {
            toSelect.insertAdjacentHTML("beforeend", `<option value="${esc(s.name)}">${esc(s.name)}</option>`);
          });
          toSelect.insertAdjacentHTML("beforeend", '</optgroup>');
        }
        toSelect.insertAdjacentHTML("beforeend", '<option value="__custom__">Custom…</option>');
        toSelect.addEventListener("change", () => {
          customInput.style.display = toSelect.value === "__custom__" ? "" : "none";
        });

        const saveBtn = detailTr.querySelector(`#edit-save-${rec.Id}`);
        let dirty = false;

        function markDirty() { dirty = true; saveBtn.disabled = false; }

        // Bulk apply
        detailTr.querySelector(`#edit-apply-${rec.Id}`).addEventListener("click", () => {
          const from = fromSelect.value;
          const to = toSelect.value === "__custom__" ? customInput.value.trim() : toSelect.value;
          if (!from || !to) return;
          segments.forEach(seg => { if (seg.speaker === from) seg.speaker = to; });
          container.innerHTML = renderSegments(segments, detail.from_display_name, detail.to_display_name);
          wireSegmentClicks();
          markDirty();
          // Refresh from dropdown
          const updated = [...new Set(segments.map(s => s.speaker).filter(Boolean))];
          fromSelect.innerHTML = "";
          updated.forEach(sp => {
            fromSelect.insertAdjacentHTML("beforeend", `<option value="${esc(sp)}">${esc(sp)}</option>`);
          });
        });

        // Save
        saveBtn.addEventListener("click", async () => {
          saveBtn.disabled = true;
          saveBtn.textContent = "Saving…";
          try {
            const r = await fetch(`/api/recordings/${rec.Id}/segments`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ segments }),
            });
            if (!r.ok) throw new Error("Save failed");
            saveBtn.textContent = "Saved!";
            dirty = false;
            setTimeout(() => { saveBtn.textContent = "Save Changes"; saveBtn.disabled = true; }, 2000);
          } catch {
            saveBtn.textContent = "Error";
            setTimeout(() => { saveBtn.textContent = "Save Changes"; saveBtn.disabled = false; }, 2000);
          }
        });

        // Per-segment inline editing via click
        function wireSegmentClicks() {
          container.querySelectorAll(".segment-time").forEach((el) => {
            el.addEventListener("click", () => {
              const time = parseFloat(el.dataset.time);
              if (audio && !isNaN(time)) { audio.currentTime = time; audio.play(); }
            });
          });
          container.querySelectorAll(".segment-speaker.editable").forEach((el) => {
            el.addEventListener("click", (e) => {
              e.stopPropagation();
              const idx = parseInt(el.closest(".segment").dataset.index);
              const sel = document.createElement("select");
              sel.className = "speaker-select";
              sel.innerHTML = '<option value="">—</option>';

              // Call participants optgroup
              const inlineParticipants = [detail.from_display_name, detail.to_display_name].filter(Boolean);
              const inlineUniqueParticipants = [...new Set(inlineParticipants)];
              const inlineEnrolledNames = new Set((cachedSpeakers || []).map(s => s.name));
              const inlineFilteredParticipants = inlineUniqueParticipants.filter(p => !inlineEnrolledNames.has(p));
              if (inlineFilteredParticipants.length > 0) {
                const pGroup = document.createElement("optgroup");
                pGroup.label = "Call Participants";
                inlineFilteredParticipants.forEach(p => {
                  const opt = document.createElement("option");
                  opt.value = p; opt.textContent = p;
                  if (p === segments[idx].speaker) opt.selected = true;
                  pGroup.appendChild(opt);
                });
                sel.appendChild(pGroup);
              }

              // Enrolled speakers optgroup
              if (cachedSpeakers && cachedSpeakers.length > 0) {
                const eGroup = document.createElement("optgroup");
                eGroup.label = "Enrolled Speakers";
                cachedSpeakers.forEach(s => {
                  const opt = document.createElement("option");
                  opt.value = s.name; opt.textContent = s.name;
                  if (s.name === segments[idx].speaker) opt.selected = true;
                  eGroup.appendChild(opt);
                });
                sel.appendChild(eGroup);
              }

              const customOpt = document.createElement("option");
              customOpt.value = "__custom__"; customOpt.textContent = "Custom…";
              sel.appendChild(customOpt);
              el.replaceWith(sel);
              sel.focus();
              sel.addEventListener("change", () => {
                let newVal = sel.value;
                if (newVal === "__custom__") {
                  newVal = prompt("Enter speaker name:") || segments[idx].speaker;
                }
                if (newVal && newVal !== segments[idx].speaker) {
                  segments[idx].speaker = newVal;
                  markDirty();
                }
                container.innerHTML = renderSegments(segments, detail.from_display_name, detail.to_display_name);
                wireSegmentClicks();
              });
              sel.addEventListener("blur", () => {
                container.innerHTML = renderSegments(segments, detail.from_display_name, detail.to_display_name);
                wireSegmentClicks();
              });
            });
          });
        }
        wireSegmentClicks();
      } else if (detail.transcription) {
        container.innerHTML = `<div class="transcription"><strong>Transcription:</strong>\n${esc(detail.transcription)}</div>`;
      } else if (rec.Transcription) {
        container.innerHTML = `<div class="transcription"><strong>Transcription:</strong>\n${esc(rec.Transcription)}</div>`;
      } else {
        container.innerHTML = `<div class="transcription" style="color:var(--text-muted)">No transcription available</div>`;
      }
    } catch {
      // Fallback to 3CX transcription from recordings list
      if (rec.Transcription) {
        container.innerHTML = `<div class="transcription"><strong>Transcription:</strong>\n${esc(rec.Transcription)}</div>`;
      } else {
        container.innerHTML = `<div class="transcription" style="color:var(--text-muted)">No transcription available</div>`;
      }
    }
  }

  function fmtTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  function renderSegments(segments, fromName, toName) {
    const speakerSet = [...new Set(segments.map(s => s.speaker).filter(Boolean))];
    const speakerColors = ["caller", "called", "speaker-c", "speaker-d"];

    const html = segments.map((seg, idx) => {
      const mm = Math.floor(seg.start / 60);
      const ss = Math.floor(seg.start % 60);
      const timeStr = `${mm}:${ss.toString().padStart(2, "0")}`;
      const speakerIdx = speakerSet.indexOf(seg.speaker);
      const speakerClass = speakerColors[speakerIdx] || "caller";
      const speakerShort = seg.speaker ? esc(seg.speaker.split(":")[0]) : "";

      return `<div class="segment" data-index="${idx}">
        <span class="segment-time" data-time="${seg.start}" title="Click to seek">${timeStr}</span>
        <span class="segment-speaker editable ${speakerClass}" title="Click to change speaker">${speakerShort}</span>
        <span class="segment-text">${esc(seg.text)}</span>
      </div>`;
    }).join("");

    return `<div class="transcription-segments">${html}</div>`;
  }

  prevBtn.addEventListener("click", () => {
    if (currentPage > 0) { currentPage--; loadRecordings(); }
  });

  nextBtn.addEventListener("click", () => {
    currentPage++;
    loadRecordings();
  });

  pageSizeSelect.addEventListener("change", () => {
    pageSize = parseInt(pageSizeSelect.value);
    currentPage = 0;
    loadRecordings();
  });

  loadRecordings();


    const recordingsRefreshBtn = document.getElementById("recordings-empty-refresh");
    if (recordingsRefreshBtn) {
      recordingsRefreshBtn.addEventListener("click", loadRecordings);
    }

    const syncRefreshBtn = document.getElementById("sync-empty-refresh");
    if (syncRefreshBtn) {
      syncRefreshBtn.addEventListener("click", loadSyncTable);
    }

  // ── STT ────────────────────────────────────────────────────────────

  const dropZone = document.getElementById("drop-zone");
  const sttFile = document.getElementById("stt-file");
  const sttFileInfo = document.getElementById("stt-file-info");
  const sttFilename = document.getElementById("stt-filename");
  const sttClear = document.getElementById("stt-clear");
  const sttLanguage = document.getElementById("stt-language");
  const sttModel = document.getElementById("stt-model");
  const sttTranslateEl = document.getElementById("stt-translate");
  const sttTransliterateEl = document.getElementById("stt-transliterate");
  const sttTranscribe = document.getElementById("stt-transcribe");
  const sttLoading = document.getElementById("stt-loading");
  const sttResult = document.getElementById("stt-result");
  const sttText = document.getElementById("stt-text");
  const sttCopy = document.getElementById("stt-copy");

  let selectedFile = null;

  dropZone.addEventListener("click", () => sttFile.click());

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });

  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) selectSTTFile(e.dataTransfer.files[0]);
  });

  sttFile.addEventListener("change", () => {
    if (sttFile.files.length > 0) selectSTTFile(sttFile.files[0]);
  });

  function selectSTTFile(file) {
    selectedFile = file;
    sttFilename.textContent = file.name;
    sttFileInfo.hidden = false;
    dropZone.hidden = true;
    sttTranscribe.disabled = false;
    sttResult.hidden = true;
  }

  sttClear.addEventListener("click", () => {
    selectedFile = null;
    sttFile.value = "";
    sttFileInfo.hidden = true;
    dropZone.hidden = false;
    sttTranscribe.disabled = true;
    sttResult.hidden = true;
  });

  sttTranscribe.addEventListener("click", async () => {
    if (!selectedFile) return;

    sttTranscribe.disabled = true;
    sttLoading.hidden = false;
    sttResult.hidden = true;

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("model", sttModel.value);
      formData.append("response_format", "json");
      const lang = sttLanguage.value;
      if (lang) formData.append("language", lang);
      if (sttTranslateEl.checked) formData.append("translate", "true");
      if (sttTransliterateEl.checked) formData.append("transliterate", "true");

      const resp = await fetch("/api/stt", { method: "POST", body: formData });
      const data = await resp.json();

      sttText.value = data.text || JSON.stringify(data, null, 2);
      sttResult.hidden = false;
    } catch (err) {
      sttText.value = "Error: " + err.message;
      sttResult.hidden = false;
    } finally {
      sttTranscribe.disabled = false;
      sttLoading.hidden = true;
    }
  });

  sttCopy.addEventListener("click", () => {
    navigator.clipboard.writeText(sttText.value).then(() => {
      sttCopy.textContent = "Copied!";
      setTimeout(() => (sttCopy.textContent = "Copy to Clipboard"), 2000);
    });
  });

  // ── Dynamic STT Model Dropdown ────────────────────────────────────

  async function populateSttModels() {
    try {
      const resp = await fetch("/api/models");
      const data = await resp.json();
      sttModel.innerHTML = "";
      const active = data.active || [];

      for (const m of active) {
        const opt = document.createElement("option");
        opt.value = m.model || m.name;
        const label = m.model || m.name;
        const isEn = label.includes(".en") || label.includes("english");
        opt.textContent = label + (isEn ? " (English)" : " (Multilingual)");
        sttModel.appendChild(opt);
      }

      if (active.length === 0) {
        sttModel.innerHTML = '<option value="Systran/faster-whisper-large-v3">large-v3 (Multilingual)</option><option value="Systran/faster-whisper-small.en">small.en (English)</option>';
      }
    } catch {
      sttModel.innerHTML = '<option value="Systran/faster-whisper-large-v3">large-v3 (Multilingual)</option><option value="Systran/faster-whisper-small.en">small.en (English)</option>';
    }
  }

  populateSttModels();

  // ── TTS ────────────────────────────────────────────────────────────

  const ttsTextEl = document.getElementById("tts-text");
  const ttsGenerate = document.getElementById("tts-generate");
  const ttsLoading = document.getElementById("tts-loading");
  const ttsResult = document.getElementById("tts-result");
  const ttsAudio = document.getElementById("tts-audio");
  const ttsDownload = document.getElementById("tts-download");
  const ttsVoice = document.getElementById("tts-voice");
  const kokoroVoiceGroup = document.getElementById("kokoro-voice-group");

  // Show/hide kokoro voice dropdown based on engine selection
  document.querySelectorAll('input[name="tts-engine"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      kokoroVoiceGroup.hidden = radio.value !== "kokoro" || !radio.checked;
    });
  });

  const ttsError = document.getElementById("tts-error");

  ttsGenerate.addEventListener("click", async () => {
    const text = ttsTextEl.value.trim();
    if (!text) return;

    const engine = document.querySelector('input[name="tts-engine"]:checked').value;
    const body = { text, engine };
    if (engine === "kokoro" && ttsVoice.value) {
      body.voice = ttsVoice.value;
    }

    ttsGenerate.disabled = true;
    ttsLoading.hidden = false;
    ttsResult.hidden = true;
    ttsError.hidden = true;

    try {
      const resp = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        let msg = `TTS failed (${resp.status})`;
        try {
          const errData = await resp.json();
          if (errData.error) msg = errData.error;
        } catch {
          const errText = await resp.text();
          if (errText) msg = errText;
        }
        throw new Error(msg);
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);

      ttsAudio.src = url;
      ttsDownload.href = url;
      ttsResult.hidden = false;
    } catch (err) {
      showError(ttsError, err.message);
    } finally {
      ttsGenerate.disabled = false;
      ttsLoading.hidden = true;
    }
  });

  // Populate Kokoro voices
  async function populateTtsVoices() {
    try {
      const resp = await fetch("/api/tts/voices");
      const voices = await resp.json();
      if (!Array.isArray(voices) || voices.length === 0) return;
      ttsVoice.innerHTML = "";
      // Group by server-provided group label
      const groups = {};
      for (const v of voices) {
        const id = v.id || v;
        const name = v.name || id;
        const groupLabel = v.group || id.substring(0, 2).toUpperCase();
        if (!groups[groupLabel]) groups[groupLabel] = [];
        groups[groupLabel].push({ id, name });
      }
      for (const [label, items] of Object.entries(groups)) {
        const group = document.createElement("optgroup");
        group.label = label;
        for (const v of items) {
          const opt = document.createElement("option");
          opt.value = v.id;
          opt.textContent = v.name;
          group.appendChild(opt);
        }
        ttsVoice.appendChild(group);
      }
      ttsVoice.value = "af_heart";
    } catch {}
  }

  populateTtsVoices();

  // ── Sync Status ──────────────────────────────────────────────────

  let syncPage = 0;
  let syncPageSize = 25;
  let syncStatusFilter = "";
  let syncFilteredTotal = 0;

  async function loadSyncProgress() {
    try {
      const resp = await fetch("/api/sync/status");
      const data = await resp.json();
      if (!data.statuses) return;

      const total = data.total || 0;
      const statusMap = {};
      data.statuses.forEach(s => { statusMap[s.sync_status] = s.count; });

      ["transcribed", "downloaded", "pending", "error"].forEach(status => {
        const count = statusMap[status] || 0;
        const pct = total > 0 ? (count / total * 100) : 0;

        const segment = document.querySelector(`.sync-progress-segment[data-status="${status}"]`);
        if (segment) segment.style.width = pct + "%";

        const pctEl = document.getElementById(`sync-pct-${status}`);
        if (pctEl) pctEl.textContent = pct.toFixed(1) + "%";

        const cntEl = document.getElementById(`sync-cnt-${status}`);
        if (cntEl) cntEl.textContent = count;
      });

      document.getElementById("sync-total").textContent = total;
    } catch {}
  }
  loadSyncProgress();
  setInterval(loadSyncProgress, 30000);

  // ── Currently Processing Panel (polls every 3s) ──────────────────

  let processingPollInterval = null;

  async function loadProcessingStatus() {
    try {
      const resp = await fetch("/api/sync/processing");
      const data = await resp.json();
      const panel = document.getElementById("sync-processing");
      const list = document.getElementById("processing-list");
      const pctEl = document.getElementById("sync-pct-complete");

      // Update pipeline % complete
      if (pctEl && data.pipeline) {
        const { transcribed, total, pct_complete } = data.pipeline;
        pctEl.textContent = total > 0 ? `${pct_complete}% complete (${transcribed}/${total} transcribed)` : "";
      }

      // Update processing panel
      if (!data.processing || data.processing.length === 0) {
        panel.hidden = true;
        list.innerHTML = "";
        return;
      }

      panel.hidden = false;
      list.innerHTML = data.processing.map(r => {
        const date = r.start_time ? new Date(r.start_time).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
        const caller = r.from_display_name || "";
        const called = r.to_display_name || "";
        const dur = r.duration ? formatDuration(r.duration) : "";
        return `<div class="processing-item">
          <div class="processing-info">
            <span>${esc(caller)}${caller && called ? " → " : ""}${esc(called)}</span>
            <span class="processing-meta">#${r.id} · ${date}${dur ? " · " + dur : ""}</span>
          </div>
          <span class="step-badge" data-step="${esc(r.processing_step)}">${esc(r.processing_step)}</span>
        </div>`;
      }).join("");
    } catch {}
  }

  function startProcessingPoll() {
    if (processingPollInterval) return;
    loadProcessingStatus();
    processingPollInterval = setInterval(loadProcessingStatus, 3000);
  }

  function stopProcessingPoll() {
    if (processingPollInterval) {
      clearInterval(processingPollInterval);
      processingPollInterval = null;
    }
  }

  // Load initial % complete (runs once), polling starts when sync tab is opened
  loadProcessingStatus();

  async function loadSyncTable() {
    const body = document.getElementById("sync-table-body");
    const loading = document.getElementById("sync-loading");
    const empty = document.getElementById("sync-empty");
    const pageInfoEl = document.getElementById("sync-page-info");
    const syncError = document.getElementById("sync-error");

    loading.hidden = false;
    empty.hidden = true;
    body.innerHTML = "";
    syncError.hidden = true;

    try {
      const offset = syncPage * syncPageSize;
      let url = `/api/sync/recordings?limit=${syncPageSize}&offset=${offset}`;
      if (syncStatusFilter) url += `&status=${encodeURIComponent(syncStatusFilter)}`;

      const resp = await fetch(url);
      const data = await resp.json();
      const total = data.total || 0;
      const recordings = data.recordings || [];
      syncFilteredTotal = total;

      loading.hidden = true;

      if (recordings.length === 0) {
        empty.hidden = false;
        document.getElementById("sync-next-page").disabled = true;
        document.getElementById("sync-prev-page").disabled = true;
        pageInfoEl.textContent = "Page 1";
        return;
      }

      body.innerHTML = recordings.map(r => {
        const isError = r.sync_status === "error";
        const isTranscribed = r.sync_status === "transcribed";
        let actions = "";
        switch (r.sync_status) {
          case "pending":
            actions = `<button class="btn-action" data-action="download" data-id="${r.id}">Download</button>`;
            break;
          case "downloaded":
            actions = `<button class="btn-action" data-action="transcribe" data-id="${r.id}">Transcribe</button>`;
            break;
          case "transcribed":
            actions = `<button class="btn-action" data-action="retranscribe" data-id="${r.id}">Retranscribe</button> <button class="btn-action" data-action="retransliterate" data-id="${r.id}">Retransliterate</button>`;
            break;
          case "error":
            actions = `<button class="btn-action" data-action="retranscribe" data-id="${r.id}">Reprocess</button>`;
            break;
          default:
            actions = `<button class="btn-action" disabled>No Action</button>`;
            break;
        }

        return `<tr>
          <td>${esc(r.id)}</td>
          <td>${formatDate(r.start_time)}</td>
          <td>${formatDuration(r.duration)}</td>
          <td>${esc(r.from_display_name || "")}</td>
          <td>${esc(r.to_display_name || "")}</td>
          <td>${esc(r.call_type || "")}</td>
          <td><span class="status-badge${isError && r.error_message ? " error-tooltip" : ""}" data-status="${esc(r.sync_status)}"${isError && r.error_message ? ` data-error="${esc(r.error_message)}"` : ""}>${r.sync_status === "pending" ? "processing" : esc(r.sync_status)}</span>${r.processing_step ? ` <span class="step-badge" data-step="${esc(r.processing_step)}">${esc(r.processing_step)}</span>` : ""}</td>
          <td>${actions}</td>
        </tr>`;
      }).join("");

      body.querySelectorAll(".btn-action").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          handleSyncAction(btn.dataset.action, parseInt(btn.dataset.id, 10), btn);
        });
      });

      const totalPages = Math.ceil(total / syncPageSize);
      pageInfoEl.textContent = `Page ${syncPage + 1} of ${totalPages || 1}`;
      document.getElementById("sync-prev-page").disabled = syncPage === 0;
      document.getElementById("sync-next-page").disabled = (syncPage + 1) >= totalPages;
    } catch (err) {
      loading.hidden = true;
      body.innerHTML = ""; // Clear table body on error
      showError(syncError, `Error: ${esc(err.message)}`);
    }
  }
  loadSyncTable();

  async function handleSyncAction(action, id, btn) {
    const origText = btn.textContent;
    btn.textContent = "...";
    btn.disabled = true;
    try {
      const resp = await fetch(`/api/recordings/${id}/${action}`, { method: "POST" });
      const data = await resp.json();
      if (data.success) {
        btn.textContent = "Done";
        setTimeout(() => { loadSyncTable(); loadSyncProgress(); }, 1000);
      } else {
        btn.textContent = "Error";
        setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
      }
    } catch {
      btn.textContent = "Error";
      setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
    }
  }

  document.getElementById("sync-page-size").addEventListener("change", (e) => {
    syncPageSize = Number(e.target.value);
    syncPage = 0;
    loadSyncTable();
  });

  document.getElementById("sync-status-filter").addEventListener("change", (e) => {
    syncStatusFilter = e.target.value;
    syncPage = 0;
    loadSyncTable();
  });

  document.getElementById("sync-prev-page").addEventListener("click", () => {
    if (syncPage > 0) { syncPage--; loadSyncTable(); }
  });

  document.getElementById("sync-next-page").addEventListener("click", () => {
    syncPage++;
    loadSyncTable();
  });

  document.getElementById("sync-bulk-retranscribe").addEventListener("click", async () => {
    const btn = document.getElementById("sync-bulk-retranscribe");
    const origText = btn.textContent;
    btn.disabled = true;

    const filterStatus = syncStatusFilter || "error";
    if (!confirm(`Are you sure you want to retranscribe ${syncFilteredTotal} recordings with status "${filterStatus}"?`)) {
      btn.textContent = origText;
      btn.disabled = false;
      return;
    }

    btn.textContent = "Processing...";
    try {
      const resp = await fetch("/api/recordings/bulk-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retranscribe", filter: { status: filterStatus } }),
      });
      const data = await resp.json();
      if (data.success) {
        btn.textContent = `Done (${data.count})`;
        loadSyncProgress();
        loadSyncTable();
        setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
      } else {
        btn.textContent = "Error";
        setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
      }
    } catch {
      btn.textContent = "Error";
      setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
    }
  });

  document.querySelectorAll(".sync-legend-item").forEach(item => {
    item.addEventListener("click", () => {
      const status = item.dataset.status;
      const filterSelect = document.getElementById("sync-status-filter");
      filterSelect.value = syncStatusFilter === status ? "" : status;
      filterSelect.dispatchEvent(new Event("change"));
    });
  });

  // ── Sync Countdown Timer ──────────────────────────────────────────

  let syncIntervalMinutes = 5;
  let countdownInterval = null;

  async function initSyncCountdown() {
    try {
      const resp = await fetch("/api/sync/schedule");
      const data = await resp.json();
      if (data.interval_minutes) {
        syncIntervalMinutes = data.interval_minutes;
        const sel = document.getElementById("sync-interval-select");
        if (sel) sel.value = String(data.interval_minutes);
      }
      updateLastSyncTime(data.last_sync_at);
    } catch {}

    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(updateCountdown, 1000);
    updateCountdown();
  }

  function updateLastSyncTime(isoStr) {
    const el = document.getElementById("sync-last-time");
    if (!el) return;
    if (!isoStr) { el.textContent = "Never"; return; }
    const then = new Date(isoStr);
    const diffSec = Math.floor((Date.now() - then.getTime()) / 1000);
    if (diffSec < 60) el.textContent = "Just now";
    else if (diffSec < 3600) el.textContent = `${Math.floor(diffSec / 60)}m ago`;
    else if (diffSec < 86400) el.textContent = then.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    else el.textContent = then.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  // Refresh last sync time periodically
  setInterval(async () => {
    try {
      const resp = await fetch("/api/sync/schedule");
      const data = await resp.json();
      updateLastSyncTime(data.last_sync_at);
    } catch {}
  }, 30000);

  function updateCountdown() {
    const now = Date.now();
    const intervalMs = syncIntervalMinutes * 60 * 1000;
    const nextSync = Math.ceil(now / intervalMs) * intervalMs;
    const remaining = Math.max(0, nextSync - now);

    const totalSec = Math.floor(remaining / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;

    const el = document.getElementById("sync-countdown");
    if (el) el.textContent = `${mm}:${ss.toString().padStart(2, "0")}`;

    // When countdown reaches 0, refresh sync status
    if (totalSec === 0) {
      loadSyncProgress();
      loadSyncTable();
    }
  }

  // Interval dropdown change handler
  document.getElementById("sync-interval-select")?.addEventListener("change", async (e) => {
    const minutes = Number(e.target.value);
    try {
      const resp = await fetch("/api/sync/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval_minutes: minutes }),
      });
      if (resp.ok) {
        syncIntervalMinutes = minutes;
        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = setInterval(updateCountdown, 1000);
        updateCountdown();
      }
    } catch {}
  });

  initSyncCountdown();


  // ── Speakers ─────────────────────────────────────────────────────

  const enrollDropZone = document.getElementById("enroll-drop-zone");
  const enrollFile = document.getElementById("enroll-file");
  const enrollFileInfo = document.getElementById("enroll-file-info");
  const enrollFilename = document.getElementById("enroll-filename");
  const enrollClear = document.getElementById("enroll-clear");
  const enrollSubmit = document.getElementById("enroll-submit");
  const enrollLoading = document.getElementById("enroll-loading");
  const enrollResult = document.getElementById("enroll-result");
  const enrollName = document.getElementById("enroll-name");

  let enrollSelectedFile = null;

  if (enrollDropZone) {
    enrollDropZone.addEventListener("click", () => enrollFile.click());
    enrollDropZone.addEventListener("dragover", (e) => { e.preventDefault(); enrollDropZone.classList.add("dragover"); });
    enrollDropZone.addEventListener("dragleave", () => enrollDropZone.classList.remove("dragover"));
    enrollDropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      enrollDropZone.classList.remove("dragover");
      if (e.dataTransfer.files.length > 0) selectEnrollFile(e.dataTransfer.files[0]);
    });
    enrollFile.addEventListener("change", () => {
      if (enrollFile.files.length > 0) selectEnrollFile(enrollFile.files[0]);
    });
  }

  function selectEnrollFile(file) {
    enrollSelectedFile = file;
    enrollFilename.textContent = file.name;
    enrollFileInfo.hidden = false;
    enrollDropZone.hidden = true;
    updateEnrollButton();
  }

  if (enrollClear) {
    enrollClear.addEventListener("click", () => {
      enrollSelectedFile = null;
      enrollFile.value = "";
      enrollFileInfo.hidden = true;
      enrollDropZone.hidden = false;
      updateEnrollButton();
      enrollResult.hidden = true;
    });
  }

  function updateEnrollButton() {
    if (enrollSubmit) enrollSubmit.disabled = !enrollSelectedFile || !enrollName.value.trim();
  }

  if (enrollName) enrollName.addEventListener("input", updateEnrollButton);

  if (enrollSubmit) {
    enrollSubmit.addEventListener("click", async () => {
      if (!enrollSelectedFile || !enrollName.value.trim()) return;

      enrollSubmit.disabled = true;
      enrollLoading.hidden = false;
      enrollResult.hidden = true;

      try {
        const formData = new FormData();
        formData.append("file", enrollSelectedFile);
        formData.append("name", enrollName.value.trim());
        const desc = document.getElementById("enroll-desc").value.trim();
        if (desc) formData.append("description", desc);

        const resp = await fetch("/api/speakers/enroll", { method: "POST", body: formData });
        const data = await resp.json();

        if (data.error) throw new Error(data.error);

        enrollResult.innerHTML = `<div style="color:var(--green)">Enrolled "${esc(data.name)}" (${data.num_samples} sample${data.num_samples > 1 ? "s" : ""})</div>`;
        enrollResult.hidden = false;

        // Reset form
        enrollSelectedFile = null;
        enrollFile.value = "";
        enrollFileInfo.hidden = true;
        enrollDropZone.hidden = false;
        enrollName.value = "";
        document.getElementById("enroll-desc").value = "";

        loadSpeakers();
      } catch (err) {
        showError(enrollResult, `Error: ${esc(err.message)}`);
      } finally {
        enrollSubmit.disabled = true;
        enrollLoading.hidden = true;
      }
    });
  }

  // ── Mic Recording Helper ──────────────────────────────────────────

  function setupMicRecorder(btnId, timerId, onRecorded) {
    const btn = document.getElementById(btnId);
    const timerEl = document.getElementById(timerId);
    if (!btn) return;

    let mediaRecorder = null;
    let chunks = [];
    let timerInterval = null;
    let startTime = 0;

    btn.addEventListener("click", async () => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        // Stop recording
        mediaRecorder.stop();
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus" : "audio/webm";
        mediaRecorder = new MediaRecorder(stream, { mimeType });
        chunks = [];

        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

        mediaRecorder.onstop = () => {
          stream.getTracks().forEach(t => t.stop());
          clearInterval(timerInterval);
          btn.textContent = "🎤 Record";
          btn.classList.remove("recording");
          timerEl.hidden = true;

          const blob = new Blob(chunks, { type: mimeType });
          const file = new File([blob], "mic-recording.webm", { type: mimeType });
          onRecorded(file);
        };

        mediaRecorder.start();
        startTime = Date.now();
        btn.textContent = "⏹ Stop";
        btn.classList.add("recording");
        timerEl.hidden = false;
        timerInterval = setInterval(() => {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const mm = Math.floor(elapsed / 60);
          const ss = elapsed % 60;
          timerEl.textContent = `${mm}:${ss.toString().padStart(2, "0")}`;
        }, 200);
      } catch (err) {
        alert("Microphone access denied or unavailable: " + err.message);
      }
    });
  }

  // Enrollment mic
  setupMicRecorder("enroll-mic-btn", "enroll-mic-timer", (file) => {
    selectEnrollFile(file);
  });

  // ── Test Identification ──────────────────────────────────────────

  const identifyDropZone = document.getElementById("identify-drop-zone");
  const identifyFile = document.getElementById("identify-file");
  const identifyFileInfo = document.getElementById("identify-file-info");
  const identifyFilename = document.getElementById("identify-filename");
  const identifyClear = document.getElementById("identify-clear");
  const identifySubmit = document.getElementById("identify-submit");
  const identifyLoading = document.getElementById("identify-loading");
  const identifyResult = document.getElementById("identify-result");

  let identifySelectedFile = null;

  if (identifyDropZone) {
    identifyDropZone.addEventListener("click", () => identifyFile.click());
    identifyDropZone.addEventListener("dragover", (e) => { e.preventDefault(); identifyDropZone.classList.add("dragover"); });
    identifyDropZone.addEventListener("dragleave", () => identifyDropZone.classList.remove("dragover"));
    identifyDropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      identifyDropZone.classList.remove("dragover");
      if (e.dataTransfer.files.length > 0) selectIdentifyFile(e.dataTransfer.files[0]);
    });
    identifyFile.addEventListener("change", () => {
      if (identifyFile.files.length > 0) selectIdentifyFile(identifyFile.files[0]);
    });
  }

  function selectIdentifyFile(file) {
    identifySelectedFile = file;
    identifyFilename.textContent = file.name;
    identifyFileInfo.hidden = false;
    identifyDropZone.hidden = true;
    if (identifySubmit) identifySubmit.disabled = false;
  }

  if (identifyClear) {
    identifyClear.addEventListener("click", () => {
      identifySelectedFile = null;
      identifyFile.value = "";
      identifyFileInfo.hidden = true;
      identifyDropZone.hidden = false;
      if (identifySubmit) identifySubmit.disabled = true;
      identifyResult.hidden = true;
    });
  }

  // Identify mic
  setupMicRecorder("identify-mic-btn", "identify-mic-timer", (file) => {
    selectIdentifyFile(file);
  });

  if (identifySubmit) {
    identifySubmit.addEventListener("click", async () => {
      if (!identifySelectedFile) return;

      identifySubmit.disabled = true;
      identifyLoading.hidden = false;
      identifyResult.hidden = true;

      try {
        const formData = new FormData();
        formData.append("file", identifySelectedFile);

        const resp = await fetch("/api/speakers/identify", { method: "POST", body: formData });
        const data = await resp.json();

        if (data.error) throw new Error(data.error);

        const matchName = data.speaker || data.name || "Unknown";
        const confidence = data.confidence != null ? (data.confidence * 100).toFixed(1) : "N/A";
        const scores = data.scores || {};

        let scoresHtml = "";
        const sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        if (sortedScores.length > 0) {
          scoresHtml = '<div class="identify-scores">' + sortedScores.map(([name, score]) => {
            const pct = (score * 100).toFixed(1);
            const barWidth = Math.max(2, Math.min(100, score * 100));
            return `<div class="identify-score-row">
              <span class="identify-score-name">${esc(name)}</span>
              <div class="identify-score-bar-bg"><div class="identify-score-bar" style="width:${barWidth}%"></div></div>
              <span class="identify-score-pct">${pct}%</span>
            </div>`;
          }).join("") + "</div>";
        }

        identifyResult.innerHTML = `
          <div class="identify-match">
            <strong>Match:</strong> ${esc(matchName)}
            <span class="identify-confidence">(${confidence}% confidence)</span>
          </div>
          ${scoresHtml}
        `;
        identifyResult.hidden = false;
      } catch (err) {
        showError(identifyResult, `Error: ${esc(err.message)}`);
      } finally {
        identifySubmit.disabled = false;
        identifyLoading.hidden = true;
      }
    });
  }

  async function loadSpeakers() {
    const list = document.getElementById("speakers-list");
    if (!list) return;

    try {
      const resp = await fetch("/api/speakers");
      const data = await resp.json();
      const speakers = data.speakers || [];

      if (speakers.length === 0) {
        list.innerHTML = `
          <div class="empty">
            No speakers enrolled yet. Upload a voice sample above to get started.
            <button type="button" id="speakers-empty-enroll">Scroll to enroll</button>
          </div>
        `;
        document.getElementById("speakers-empty-enroll").addEventListener("click", () => {
          enrollName.focus();
          enrollName.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        return;
      }

      list.innerHTML = speakers.map(s => {
        const dateStr = s.updated_at ? formatDate(s.updated_at) : (s.created_at ? formatDate(s.created_at) : "");
        return `
        <div class="speaker-card">
          <div class="speaker-info">
            <span class="speaker-name">${esc(s.name)}</span>
            <span class="speaker-meta">${s.num_samples} sample${s.num_samples > 1 ? "s" : ""}${dateStr ? " · " + dateStr : ""}</span>
            ${s.description ? `<span class="speaker-desc">${esc(s.description)}</span>` : ""}
          </div>
          <div class="speaker-actions">
            <button class="btn-action speaker-add-sample" data-name="${esc(s.name)}" title="Add voice sample for ${esc(s.name)}">+ Add Sample</button>
            <button class="btn-action speaker-delete" data-id="${esc(s.speaker_id)}" data-name="${esc(s.name)}" title="Delete voice profile for ${esc(s.name)}">Delete</button>
          </div>
        </div>
      `;
      }).join("");

      list.querySelectorAll(".speaker-add-sample").forEach(btn => {
        btn.addEventListener("click", () => {
          enrollName.value = btn.dataset.name;
          enrollName.scrollIntoView({ behavior: "smooth", block: "center" });
          updateEnrollButton();
          // Focus the file input area after scroll
          setTimeout(() => {
            if (enrollDropZone && !enrollDropZone.hidden) enrollDropZone.click();
          }, 400);
        });
      });

      list.querySelectorAll(".speaker-delete").forEach(btn => {
        btn.addEventListener("click", async () => {
          if (!confirm(`Delete voice profile for "${btn.dataset.name}"?`)) return;
          btn.textContent = "...";
          btn.disabled = true;
          try {
            await fetch(`/api/speakers/${btn.dataset.id}`, { method: "DELETE" });
            loadSpeakers();
          } catch {
            btn.textContent = "Error";
            setTimeout(() => { btn.textContent = "Delete"; btn.disabled = false; }, 2000);
          }
        });
      });
    } catch {
      list.innerHTML = '<div style="color:var(--text-muted)">Diarization service unavailable</div>';
    }
  }

  // ── Models ──────────────────────────────────────────────────────

  async function loadModels() {
    try {
      const resp = await fetch("/api/models");
      const data = await resp.json();

      // Active models
      const activeList = document.getElementById("active-models-list");
      if (data.active && data.active.length > 0) {
        activeList.innerHTML = data.active.map(m =>
          `<div class="active-model"><span class="model-name">${esc(m.model)}</span><span class="model-backend">${esc(m.backend)}</span></div>`
        ).join("");
      } else {
        // Try /api/models/current fallback
        try {
          const currentResp = await fetch("/api/models/current");
          const current = await currentResp.json();
          if (current.model) {
            activeList.innerHTML = `<div class="active-model"><span class="model-name">${esc(current.model)}</span><span class="model-status ${current.status === "healthy" ? "healthy" : ""}">${esc(current.status)}</span></div>`;
          }
        } catch {
          activeList.innerHTML = '<span style="color:var(--text-muted)">Unable to fetch active models</span>';
        }
      }

      // Model grid
      const grid = document.getElementById("models-grid");
      if (data.models) {
        grid.innerHTML = data.models.map(m => {
          const isActive = data.active?.some(a => a.model === m.id);
          return `<div class="model-card ${isActive ? "active" : ""}">
            <div class="model-card-header">
              <span class="model-id">${esc(m.name)}</span>
              ${m.englishOnly ? '<span class="model-badge en">EN</span>' : '<span class="model-badge multi">Multi</span>'}
              ${isActive ? '<span class="model-badge current">Active</span>' : ''}
            </div>
            <div class="model-meta">
              <span>${esc(m.size)}</span> · <span>${esc(m.parameters)} params</span>
            </div>
            <div class="model-desc">${esc(m.description)}</div>
          </div>`;
        }).join("");
      }
    } catch (err) {
      document.getElementById("models-grid").innerHTML = '<span style="color:var(--red)">Error loading models</span>';
    }
  }
  loadModels();

  // ── Helpers ────────────────────────────────────────────────────────

  function esc(val) {
    if (val == null) return "";
    const div = document.createElement("div");
    div.textContent = String(val);
    return div.innerHTML;
  }

  function formatDate(dateStr) {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return dateStr;
    }
  }

  function formatDuration(seconds) {
    if (!seconds && seconds !== 0) return "";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function showError(el, message) {
    el.textContent = message;
    el.hidden = false;
    el.tabIndex = -1;
    el.focus();
  }
})();
