// --- Rechteckwelle Play/Stop für Muster und Morse ---

// --- Segmentweises Play/Stop für Muster-Editor ---
let patternAudioCtx = null;
let patternOsc = null;
let patternPlayTimeouts = [];
// Global arrays for segments
let globalPatternSegments = [];
let globalMorseSegments = [];

function playPatternSegments() {
  stopPatternSegments();
  const segments = getPatternSegments();
  if (!segments || segments.length === 0) return;
  patternAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  let t = patternAudioCtx.currentTime;
  let totalDuration = 0;
  segments.forEach(seg => {
    if (seg.state === 'HIGH') {
      const osc = patternAudioCtx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 335;
      osc.connect(patternAudioCtx.destination);
      osc.start(t);
      osc.stop(t + seg.duration / 1000);
      patternPlayTimeouts.push(setTimeout(() => {
        osc.disconnect();
      }, (t + seg.duration / 1000 - patternAudioCtx.currentTime) * 1000));
    }
    t += seg.duration / 1000;
    totalDuration += seg.duration;
  });
  // Stoppe AudioCtx nach letztem Segment
  patternPlayTimeouts.push(setTimeout(() => {
    stopPatternSegments();
  }, totalDuration));
}

function stopPatternSegments() {
  patternPlayTimeouts.forEach(t => clearTimeout(t));
  patternPlayTimeouts = [];
  if (patternAudioCtx) {
    patternAudioCtx.close();
    patternAudioCtx = null;
  }
}
    // --- Segmentweises Play/Stop für Morse-Editor ---
    let morseAudioCtx = null;
    let morsePlayTimeouts = [];


    function playMorseSegments() {
      // Beende alten AudioContext, falls noch offen
      if (morseAudioCtx) {
        try { morseAudioCtx.close(); } catch(e) {}
        morseAudioCtx = null;
      }
      stopMorseSegments();
      const segments = getMorseSegments();
      console.log('Morse Segments:', segments);
      if (!segments || segments.length === 0) {
        console.warn('Keine Morse-Segmente gefunden!');
        return;
      }
      morseAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      let t = morseAudioCtx.currentTime;
      let totalDuration = 0;
      segments.forEach(seg => {
        console.log('Segment', seg.state, 'Dauer', seg.duration);
        if (seg.state === 'HIGH') {
          const osc = morseAudioCtx.createOscillator();
          osc.type = 'square';
          osc.frequency.value = 335;
          osc.connect(morseAudioCtx.destination);
          osc.start(t);
          osc.stop(t + seg.duration / 1000);
          morsePlayTimeouts.push(setTimeout(() => {
            osc.disconnect();
          }, (t + seg.duration / 1000 - morseAudioCtx.currentTime) * 1000));
        }
        t += seg.duration / 1000;
        totalDuration += seg.duration;
      });
      morsePlayTimeouts.push(setTimeout(() => {
        stopMorseSegments();
      }, totalDuration));
    }

    function stopMorseSegments() {
      morsePlayTimeouts.forEach(t => clearTimeout(t));
      morsePlayTimeouts = [];
      if (morseAudioCtx) {
        morseAudioCtx.close();
        morseAudioCtx = null;
      }
    }

    // Hilfsfunktion: Hole Segmente aus Morse-Editor
    function getMorseSegments() {
      return globalMorseSegments;
    }

// Hilfsfunktion: Hole Segmente aus Muster-Editor
function getPatternSegments() {
  return globalPatternSegments;
}

// Buttons für Muster-Editor


function createPatternButtons() {
  const patternConfig = document.getElementById('patternConfig');
  if (!patternConfig) return;
  // Entferne alte Buttons
  Array.from(patternConfig.querySelectorAll('.pattern-btn')).forEach(btn => btn.remove());
  const playBtn = document.createElement('button');
  playBtn.textContent = '▶️ Play Muster';
  playBtn.className = 'pattern-btn';
  playBtn.onclick = function() { playPatternSegments(); };
  const stopBtn = document.createElement('button');
  stopBtn.textContent = '⏹ Stop Muster';
  stopBtn.className = 'pattern-btn';
  stopBtn.onclick = stopPatternSegments;
  patternConfig.appendChild(playBtn);
  patternConfig.appendChild(stopBtn);
}

function createMorseButtons() {
  const morseConfig = document.getElementById('morseConfig');
  if (!morseConfig) return;
  Array.from(morseConfig.querySelectorAll('.morse-btn')).forEach(btn => btn.remove());
  const playBtn = document.createElement('button');
  playBtn.textContent = '▶️ Play Morse';
  playBtn.className = 'morse-btn';
  playBtn.onclick = function() { playMorseSegments(); };
  const stopBtn = document.createElement('button');
  stopBtn.textContent = '⏹ Stop Morse';
  stopBtn.className = 'morse-btn';
  stopBtn.onclick = stopMorseSegments;
  morseConfig.appendChild(playBtn);
  morseConfig.appendChild(stopBtn);
}

function updateEditorButtons() {
  if (isMorseMode) {
    createMorseButtons();
  } else {
    createPatternButtons();
  }
}

document.addEventListener('DOMContentLoaded', function() {
  updateEditorButtons();
  if (modeSwitch) {
    modeSwitch.addEventListener('change', function() {
      isMorseMode = modeSwitch.checked;
      updateEditorButtons();
    });
  }
});
// Debounce Timer für Morse Autosave
let morseSaveTimeout = null;

function scheduleMorseSave(message) {
  if (morseSaveTimeout) clearTimeout(morseSaveTimeout);
  morseSaveTimeout = setTimeout(() => {
    saveMorseMessage(message);
    morseSaveTimeout = null;
  }, 5000);
}
// Debounce Timer für Pattern Autosave
let patternSaveTimeout = null;

function schedulePatternSave(segments) {
  if (patternSaveTimeout) clearTimeout(patternSaveTimeout);
  patternSaveTimeout = setTimeout(() => {
      savePatternData(segments);
      patternSaveTimeout = null;
    }, 5000);
}
// Globale Variablen
let isMorseMode = false;
let currentPattern = null;
let savedPatterns = [];
let activeTooltip = null;
let isUpdating = false;

document.body.addEventListener('click', function(e) {
});

// DOM Elemente
const modeSwitch = document.getElementById('modeSwitch');
const morseConfig = document.getElementById('morseConfig');
const patternConfig = document.getElementById('patternConfig');
const ditDurationInput = document.getElementById('ditDuration');
const morseTextInput = document.getElementById('morseText');
const morseSignalCanvas = document.getElementById('morseSignalCanvas');
const morseTimeAxis = document.getElementById('morseTimeAxis');
const morseDisplay = document.getElementById('morseDisplay');
const patternDurationDisplay = document.getElementById('calculatedDuration');
const invertButton = document.getElementById('invertButton');
const clearBtn = document.getElementById('clearPhasesBtn');
const speakerVisualization = document.getElementById("speakerVisualization");
const addSegmentBtn = document.getElementById("addSegmentBtn");
const freqInput = document.getElementById("freqInput");
const waveformInput = document.getElementById("waveformInput");
const durationInput = document.getElementById("durationInput");
const transitionInput = document.getElementById("transitionInput");
const trackButtons = document.querySelectorAll(".track-btn");


// Morse Code Mapping
const MORSE_CODE = {
  'A': '.-',    'B': '-...',  'C': '-.-.',  'D': '-..',
  'E': '.',     'F': '..-.',  'G': '--.',   'H': '....',
  'I': '..',    'J': '.---',  'K': '-.-',   'L': '.-..',
  'M': '--',    'N': '-.',    'O': '---',   'P': '.--.',
  'Q': '--.-',  'R': '.-.',   'S': '...',   'T': '-',
  'U': '..-',   'V': '...-',  'W': '.--',   'X': '-..-',
  'Y': '-.--',  'Z': '--..', 
  'Ä': '.-.-',  'Ö': '---.',  'Ü': '..--',  'ẞ': '...--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--',
  '4': '....-', '5': '.....', '6': '-....', '7': '--...',
  '8': '---..', '9': '----.',
  '@': '.--.-.', '.': '.-.-.-', ',': '--..--', '?': '..--..',
  '!': '-.-.--', '/': '-..-.',  '(': '-.--.',  ')': '-.--.-',
  '&': '.-...',  ':': '---...', ';': '-.-.-.', '=': '-...-',
  '+': '.-.-.',  '-': '-....-', '_': '..--.-', '"': '.-..-.',
  '$': '...-..-','\'': '.----.',
  ' ': '/'
};

let speakerTracks = [[], [], [], []];
let activeTrack = 0;

// Web Audio API
let audioCtx = null;
let isPlaying = false;

trackButtons.forEach((btn, i) => {
  btn.addEventListener("click", () => {
    activeTrack = i;
    trackButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderSpeakerTracks();
  });
});

// Neues Segment hinzufügen
addSegmentBtn.addEventListener("click", () => {
  const freq = parseFloat(freqInput.value);
  const waveform = waveformInput.value;
  const duration = parseInt(durationInput.value, 10);
  const transition = transitionInput.value;

  if (isNaN(freq) || isNaN(duration) || duration <= 0) return;

  speakerTracks[activeTrack].push({ freq, waveform, duration, transition });
  renderSpeakerTracks();
  debounceSaveSpeakerData();
});

function renderSpeakerTracks() {
  const tracks = speakerVisualization.querySelectorAll(".track");

  tracks.forEach((trackDiv, i) => {
    trackDiv.innerHTML = "";
    let offset = 0;

    speakerTracks[i].forEach((seg, segIndex) => {
      const segDiv = document.createElement("div");
      segDiv.className = "segment-block";
      segDiv.style.left = offset + "px";
      segDiv.style.width = (seg.duration / 5) + "px";
      segDiv.style.background = `hsl(${i * 90}, 70%, 70%)`;
      segDiv.textContent = `${seg.freq}Hz`;

      // --- Resize-Griffe ---
      const leftHandle = document.createElement("div");
      leftHandle.className = "resize-handle left";
      segDiv.appendChild(leftHandle);

      const rightHandle = document.createElement("div");
      rightHandle.className = "resize-handle right";
      segDiv.appendChild(rightHandle);

      // --- Dragging / Resizing Variablen ---
      let startX, startWidth, startLeft;
      let action = null; // "move", "resize-left", "resize-right"

      let mouseMoved = false;
      function onDown(e, type) {
        e.preventDefault();
        action = type;
        startX = e.touches ? e.touches[0].clientX : e.clientX;
        startWidth = segDiv.offsetWidth;
        startLeft = segDiv.offsetLeft;
        mouseMoved = false;

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        document.addEventListener("touchmove", onMove, { passive: false });
        document.addEventListener("touchend", onUp);
      }

      function onMove(e) {
        mouseMoved = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const delta = clientX - startX;

        if (action === "move") {
          segDiv.style.left = startLeft + delta + "px";
        } else if (action === "resize-right") {
          segDiv.style.width = Math.max(20, startWidth + delta) + "px";
        } else if (action === "resize-left") {
          const newLeft = startLeft + delta;
          const newWidth = Math.max(20, startWidth - delta);
          if (newWidth >= 20) {
            segDiv.style.left = newLeft + "px";
            segDiv.style.width = newWidth + "px";
          }
        }
      }

      function onUp(e) {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.removeEventListener("touchmove", onMove);
        document.removeEventListener("touchend", onUp);

        const newLeft = parseInt(segDiv.style.left, 10);
        const newWidth = parseInt(segDiv.style.width, 10);

        if (action === "move") {
          // neue Reihenfolge berechnen
          const newIndex = Math.round(newLeft / ((seg.duration / 5) + 4));
          const clampedIndex = Math.max(0, Math.min(newIndex, speakerTracks[i].length - 1));

          // Segment verschieben im Array
          speakerTracks[i].splice(segIndex, 1);
          speakerTracks[i].splice(clampedIndex, 0, seg);
        } else {
          // neue Dauer setzen
          seg.duration = Math.round(newWidth * 5);
        }

        renderSpeakerTracks();
        debounceSaveSpeakerData();
        // Modal öffnen, wenn Maus sich nicht bewegt hat (echter Klick)
        if (!mouseMoved) {
          openEditModal(i, segIndex);
        }
        action = null;
      }

      // --- Event Listener ---
      segDiv.addEventListener("mousedown", e => onDown(e, "move"));
      segDiv.addEventListener("touchstart", e => onDown(e, "move"), { passive: false });
      leftHandle.addEventListener("mousedown", e => onDown(e, "resize-left"));
      rightHandle.addEventListener("mousedown", e => onDown(e, "resize-right"));
      leftHandle.addEventListener("touchstart", e => onDown(e, "resize-left"), { passive: false });
      rightHandle.addEventListener("touchstart", e => onDown(e, "resize-right"), { passive: false });

      // --- Edit Modal Event Listener ---
        segDiv.addEventListener("mouseup", function(e) {
          console.log('Segment mouseup', segDiv, 'action:', action);
          if (action === null) {
            openEditModal(i, segIndex);
          }
        });
        segDiv.addEventListener("click", function(e) {
          console.log('Segment click', segDiv, 'action:', action);
          // Nur auslösen, wenn kein Drag/Resize aktiv ist
          if (action === null) {
            openEditModal(i, segIndex);
          }
        });
        segDiv.addEventListener("touchend", function(e) {
          console.log('Segment touchend', segDiv, 'action:', action);
          // Nur auslösen, wenn kein Drag/Resize aktiv ist
          if (action === null) {
            openEditModal(i, segIndex);
          }
        });

        // Fallback: Modal immer öffnen, wenn ein Touchstart ohne Drag/Resize erfolgt
        segDiv.addEventListener("touchstart", function(e) {
          setTimeout(() => {
            console.log('Segment touchstart fallback', segDiv, 'action:', action);
            if (action === null) {
              openEditModal(i, segIndex);
            }
          }, 250);
        }, { passive: false });

      trackDiv.appendChild(segDiv);
      offset += seg.duration / 5 + 4;
    });
  });
}

// ---- Audio Playback (Loop) ----
function playSpeakerLoop() {
  if (isPlaying) return;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  isPlaying = true;

  speakerTracks.forEach((segments, trackIndex) => {
    if (segments.length === 0) return;

    let currentTime = audioCtx.currentTime;

    function scheduleTrack() {
      let t = currentTime;

      segments.forEach(seg => {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        osc.type = seg.waveform;
        osc.frequency.value = seg.freq;

        // Übergang simulieren
        if (seg.transition === "linear") {
          gainNode.gain.setValueAtTime(0, t);
          gainNode.gain.linearRampToValueAtTime(1, t + 0.05);
        } else if (seg.transition === "exp") {
          gainNode.gain.setValueAtTime(0.001, t);
          gainNode.gain.exponentialRampToValueAtTime(1, t + 0.1);
        } else {
          gainNode.gain.setValueAtTime(1, t);
        }

        osc.connect(gainNode).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + seg.duration / 1000);

        t += seg.duration / 1000;
      });

      // Loop planen
      currentTime = t;
      setTimeout(scheduleTrack, (t - audioCtx.currentTime) * 1000);
    }

    scheduleTrack();
  });
}

function stopSpeakerLoop() {
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
  isPlaying = false;
}

// ---- Autosave Debounce ----
let saveSpeakerTimeout;
function debounceSaveSpeakerData() {
  clearTimeout(saveSpeakerTimeout);
  saveSpeakerTimeout = setTimeout(saveSpeakerData, 500);
}

function saveSpeakerData() {
  try {
    fetch("/saveSpeakerData", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tracks: speakerTracks })
    });
  } catch (err) {
    console.warn("Save failed:", err);
  }
}

// ---- Beispiel Buttons für Play/Stop ----
const playBtn = document.createElement("button");
playBtn.textContent = "▶️ Play";
playBtn.onclick = playSpeakerLoop;

const stopBtn = document.createElement("button");
stopBtn.textContent = "⏹ Stop";
stopBtn.onclick = stopSpeakerLoop;

document.querySelector(".carousel-item:last-child .card").appendChild(playBtn);
document.querySelector(".carousel-item:last-child .card").appendChild(stopBtn);

let editModal = null;
function createEditModal() {
  editModal = document.createElement("div");
  editModal.className = "edit-modal";
  editModal.innerHTML = `
    <div class="edit-modal-content">
      <h3>Segment bearbeiten</h3>
      <label>Frequenz (Hz):</label>
      <input type="number" id="editFreq" min="20" max="20000">

      <label>Wellenform:</label>
      <select id="editWaveform">
        <option value="sine">Sinus</option>
        <option value="square">Rechteck</option>
        <option value="sawtooth">Sägezahn</option>
        <option value="triangle">Dreieck</option>
      </select>

      <label>Dauer (ms):</label>
      <input type="number" id="editDuration" min="10">

      <label>Übergang:</label>
      <select id="editTransition">
        <option value="none">Keiner</option>
        <option value="linear">Linear</option>
        <option value="exp">Exponentiell</option>
      </select>

      <div class="edit-actions">
        <button id="saveSegmentBtn">💾 Speichern</button>
        <button id="deleteSegmentBtn">🗑 Löschen</button>
        <button id="cancelEditBtn">✖ Abbrechen</button>
      </div>
    </div>
  `;
  document.body.appendChild(editModal);

  // Modal schließen, wenn man daneben klickt
  editModal.addEventListener("click", e => {
    if (e.target === editModal) closeEditModal();
  });
}

function openEditModal(trackIndex, segIndex) {
  console.log("openEditModal called", trackIndex, segIndex);
  if (!editModal) createEditModal();
  console.log("editModal after create", editModal);
  const seg = speakerTracks[trackIndex][segIndex];
  document.getElementById("editFreq").value = seg.freq;
  document.getElementById("editWaveform").value = seg.waveform;
  document.getElementById("editDuration").value = seg.duration;
  document.getElementById("editTransition").value = seg.transition;

  editModal.style.display = "flex";
  console.log("editModal style after open", editModal.style.display);

  // Event-Handler setzen
  document.getElementById("saveSegmentBtn").onclick = () => {
    seg.freq = parseFloat(document.getElementById("editFreq").value);
    seg.waveform = document.getElementById("editWaveform").value;
    seg.duration = parseInt(document.getElementById("editDuration").value, 10);
    seg.transition = document.getElementById("editTransition").value;

    renderSpeakerTracks();
    debounceSaveSpeakerData();
    closeEditModal();
  };

  document.getElementById("deleteSegmentBtn").onclick = () => {
    speakerTracks[trackIndex].splice(segIndex, 1);
    renderSpeakerTracks();
    debounceSaveSpeakerData();
    closeEditModal();
  };

  document.getElementById("cancelEditBtn").onclick = () => closeEditModal();
}
function closeEditModal() {
  if (editModal) editModal.style.display = "none";
}

// Initialisierung
function init() {
  modeSwitch.addEventListener('change', () => {
    toggleMode();
    loadInitialData();
  });
  ditDurationInput.addEventListener('input', updateMorseVisualization);
  morseTextInput.addEventListener('input', (e) => {
    updateMorseVisualization();
    scheduleMorseSave(e.target.value);
  });
  invertButton.addEventListener('click', invertPattern);
  phaseInput.addEventListener('keypress', handlePhaseInput);
  phaseInput.addEventListener('input', adjustInputWidth);


  clearBtn.addEventListener('click', function() {
    const tags = Array.from(patternPhases.querySelectorAll('.phase-tag'));
    tags.forEach(tag => tag.remove());
    createPatternFromPhases();
    updatePatternVisualization();
    updateClearBtnVisibility();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const carousel = document.querySelector('.carousel');
  if (!carousel) return;

  const carouselItems = Array.from(carousel.querySelectorAll('.carousel-item'));

  const indicatorsContainer = document.querySelector('.carousel-indicators');
  if (indicatorsContainer) {
    indicatorsContainer.innerHTML = '';
    carouselItems.forEach((_, i) => {
      const span = document.createElement('span');
      span.className = 'indicator' + (i === 0 ? ' active' : '');
      span.dataset.index = i.toString();
      indicatorsContainer.appendChild(span);
    });
  }
  // Nun frisch aus dem DOM ziehen (inkl. generierter)
  const indicators = Array.from(document.querySelectorAll('.indicator'));

  let currentIndex = 0;
  let isProgrammaticScroll = false;

  function setActiveIndex(index) {
    index = Math.max(0, Math.min(index, carouselItems.length - 1));
    currentIndex = index;
    indicators.forEach((ind, i) => ind.classList.toggle('active', i === index));
  }

  function updateCarousel(index) {
    index = Math.max(0, Math.min(index, carouselItems.length - 1));
    isProgrammaticScroll = true;
    carousel.scrollTo({
      left: carouselItems[index].offsetLeft,
      behavior: 'smooth'
    });
    setActiveIndex(index);
    // clear flag nach kurzer Zeit (genug für "smooth" scroll)
    setTimeout(() => { isProgrammaticScroll = false; }, 500);
  }

  // Klick auf Indikatoren
  indicators.forEach(ind => {
    ind.addEventListener('click', (ev) => {
      const idx = Number(ind.dataset.index);
      if (!Number.isFinite(idx)) return;
      updateCarousel(idx);
    });
    // accessibility: Enter key on indicator
    ind.setAttribute('tabindex', '0');
    ind.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const idx = Number(ind.dataset.index);
        updateCarousel(idx);
      }
    });
  });

  // Scroll handler: Nur when user-scroll (kein infinite loop)
  let scrollDebounce;
  carousel.addEventListener('scroll', () => {
    if (isProgrammaticScroll) return;
    // debounce small to avoid thrash while scrolling
    clearTimeout(scrollDebounce);
    scrollDebounce = setTimeout(() => {
      // robuste Berechnung: auf Basis der sichtbaren Breite des Carousels
      const approxIndex = Math.round(carousel.scrollLeft / carousel.clientWidth);
      setActiveIndex(approxIndex);
    }, 80);
  });

  // Optional: wheel horizontal support (Desktop)
  carousel.addEventListener('wheel', (e) => {
    // wenn horizontale Wheel bewegt wird, verhindern wir normales Scrolling
    if (Math.abs(e.deltaX) > 0) {
      e.preventDefault();
      carousel.scrollLeft += e.deltaX;
    }
  }, { passive: false });

  // Arrow keys Navigation (Desktop)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') updateCarousel(currentIndex - 1);
    if (e.key === 'ArrowRight') updateCarousel(currentIndex + 1);
  });

  // Resize: snap erneut zur aktuellen Slide (z. B. bei orientation change)
  window.addEventListener('resize', () => {
    // kleine Verzögerung, damit Layout stabil ist
    setTimeout(() => {
      if (carouselItems[currentIndex]) {
        carousel.scrollTo({ left: carouselItems[currentIndex].offsetLeft });
      }
    }, 120);
  });

  // Falls du beim Start die richtige Position sicherstellen willst:
  if (carouselItems[currentIndex]) {
    carousel.scrollTo({ left: carouselItems[currentIndex].offsetLeft });
  }
});

function updateClearBtnVisibility() {
  if (!clearBtn) return;
  const tags = patternPhases.querySelectorAll('.phase-tag');
  clearBtn.style.display = tags.length > 0 ? '' : 'none';
}

// Update button visibility on relevant actions
// After initial load
updateClearBtnVisibility();

// Patch add/remove to update button visibility
const origAddPhaseTag = addPhaseTag;
addPhaseTag = function(state, duration, index) {
  origAddPhaseTag(state, duration, index);
  updateClearBtnVisibility();
};
const origRemovePhaseTag = removePhaseTag;
removePhaseTag = function(tag) {
  origRemovePhaseTag(tag);
  updateClearBtnVisibility();
};

  // Initiales Laden
  loadInitialData();
  updateAllVisualizations();
  
  // Modus wechseln
function toggleMode() {
  isMorseMode = modeSwitch.checked;
  morseConfig.style.display = isMorseMode ? 'block' : 'none';
  patternConfig.style.display = isMorseMode ? 'none' : 'block';
  
  updateAllVisualizations();
}

function queryPatternPhases() {
  const phaseTags = patternPhases.querySelectorAll('.phase-tag');
  const initialState = phaseTags.length > 0 ? phaseTags[0].dataset.state : 'HIGH';
  return Array.from(phaseTags).map((tag, i) => ({
    state: (i % 2 === 0) ? initialState : (initialState === 'HIGH' ? 'LOW' : 'HIGH'),
    duration: parseInt(tag.dataset.duration)
  }));
}

// Alle Visualisierungen aktualisieren
function updateAllVisualizations() {
  if (isMorseMode) {
    updateMorseVisualization();
  } else {
    updatePatternVisualization();
  }
}

// Eingabefeldbreite anpassen
function adjustInputWidth() { //X
    this.style.width = (this.value.length + 1) * 8 + 'px';
}

// Phase-Eingabe verarbeiten
function handlePhaseInput(e) { //X
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const value = this.value.trim();
    if (value && !isNaN(value) && parseInt(value) > 0) {
      addPhaseFromInput(parseInt(value)); //X
      this.value = '';
      adjustInputWidth.call(this); //X
    }
  }
}

// Pattern aus Phasen erstellen
function createPatternFromPhases() { //X
    if (isUpdating) return;
    const phaseElements = patternPhases.querySelectorAll('.phase-tag');
  if (!phaseElements || phaseElements.length === 0) {
      patternDurationDisplay.textContent = '0 s';
      return;
    }
    const changes = [];
  let totalTime = 0;

  for (let i = 0; i < phaseElements.length; i++) {
      const element = phaseElements[i];
    const duration = parseInt(element.dataset.duration) || 0;
    totalTime += duration;

    if (i < phaseElements.length - 1) {
      changes.push(totalTime);
    }
}

  // Display aktualisieren
  patternDurationDisplay.textContent = `${ totalTime/1000 } s`;
}

// Phasen-Tag hinzufügen
function addPhaseTag(state, duration, index) { //X
    console.log('Add Phase Tag:', state, duration, index);
    const tag = document.createElement('div');
  tag.className = `phase-tag ${state}`;
  tag.dataset.state = state;
  tag.dataset.duration = duration;
  tag.dataset.index = index;
  
  const input = document.createElement('input');
  input.type = 'number';
  input.value = duration;
  input.min = '1';
  input.style.width = (duration.toString().length * 8 + 20) + 'px';
  
  input.addEventListener('change', function() {
    if (isUpdating) return;
    tag.dataset.duration = this.value;
    createPatternFromPhases(); //X
    updatePatternVisualization(); //X
});
  
  input.addEventListener('input', function() {
    this.style.width = (this.value.length * 8 + 20) + 'px';
  });
  
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.innerHTML = '&#x1F7A8;';
  deleteBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (isUpdating) return;
    removePhaseTag(tag);
  });
  
  tag.appendChild(input);
  tag.appendChild(deleteBtn);
  
  // Vor dem Eingabefeld einfügen
  patternPhases.insertBefore(tag, phaseInput);
}

// Phase aus Eingabe hinzufügen
function addPhaseFromInput(duration) { //X
    console.log('Add Phase From Input:', duration);
    if (isUpdating) return;
  isUpdating = true;
  
  try {
    const tags = patternPhases.querySelectorAll('.phase-tag');
    const lastState = tags.length > 0 ? 
      (tags[tags.length-1].dataset.state === 'HIGH' ? 'LOW' : 'HIGH') : 
      'HIGH';
    
      const newIndex = tags.length;
    addPhaseTag(lastState, duration, newIndex);
    isUpdating = false;
    createPatternFromPhases(); //X
    updatePatternVisualization(); //X
  } finally {
    isUpdating = false;
}
}

// Phasen-Tag entfernen
function removePhaseTag(tag) { //X
    if (isUpdating) return;
  isUpdating = true;
  
  try {
    const tags = Array.from(patternPhases.querySelectorAll('.phase-tag'));
    const index = tags.indexOf(tag);
    
    if (index === -1) {
      isUpdating = false;
      return;
    }
    
    // Tag entfernen
    tag.remove();
    
    // Wenn nicht das letzte Tag, benachbarte gleiche Phasen zusammenführen
    if (index < tags.length - 1) {
      mergeNeighbourPhasesAfterRemoval(index);
    }
    isUpdating = false;
    createPatternFromPhases();
    updatePatternVisualization();
} finally {
    isUpdating = false;
  }
}

function mergeNeighbourPhasesAfterRemoval(removedIndex) {
  const tags = Array.from(patternPhases.querySelectorAll('.phase-tag'));
  
  // Prüfen ob Zusammenführung nötig ist
  if (tags.length < 2) return;
  
  const prevIndex = removedIndex - 1;
  const nextIndex = removedIndex; // Der nächste Tag rückt nach
  
  if (prevIndex >= 0 && nextIndex < tags.length) {
    const prevTag = tags[prevIndex];
    const nextTag = tags[nextIndex];
    
    if (prevTag.dataset.state === nextTag.dataset.state) {
      // Phasen zusammenführen
      const prevDuration = parseInt(prevTag.dataset.duration);
      const nextDuration = parseInt(nextTag.dataset.duration);
      const newDuration = prevDuration + nextDuration;
      
      prevTag.dataset.duration = newDuration;
      prevTag.querySelector('input').value = newDuration;
      prevTag.querySelector('input').style.width = (newDuration.toString().length * 8 + 20) + 'px';
      
      // Nächsten Tag entfernen
      nextTag.remove();
    }
  }
}

// Pattern Visualisierung aktualisieren
function updatePatternVisualization() { //X
  console.log('Update Pattern Visualization');
  console.log('isUpdating:', isUpdating);
  if (isUpdating) return;
  isUpdating = true;
  console.log('Current Pattern:', JSON.stringify(currentPattern));

  try {
    patternSignalCanvas.innerHTML = '';
    patternTimeAxis.innerHTML = '';
    // Build segments from DOM phase tags
    const phaseTags = patternPhases.querySelectorAll('.phase-tag');
    let segments = [];
    let state = phaseTags.length > 0 ? phaseTags[0].dataset.state : 'HIGH';
    phaseTags.forEach(tag => {
      segments.push({ state, duration: parseInt(tag.dataset.duration) });
      state = state === 'HIGH' ? 'LOW' : 'HIGH';
    });
    globalPatternSegments = segments;
    const duration = segments.reduce((sum, seg) => sum + seg.duration, 0);
    if (duration <= 0) {
      isUpdating = false;
      return;
    }
    const containerWidth = Math.max(patternSignalCanvas.clientWidth, 300);
    const scale = containerWidth / duration;
    let currentTime = 0;
    segments.forEach(segment => {
      const width = segment.duration * scale;
      const div = document.createElement('div');
      div.className = 'segment ' + segment.state;
      div.style.left = (currentTime * scale) + 'px';
      div.style.width = width + 'px';
      div.style.position = 'absolute';
      div.style.height = '100%';
      div.style.backgroundColor = segment.state === 'HIGH' ? '#4caf50' : '#bdbdbd';
      patternSignalCanvas.appendChild(div);
      currentTime += segment.duration;
    });

    // Zeitachse nur an Phasengrenzen
    let borderTimes = [0];
    let acc = 0;
    for (let i = 0; i < segments.length; i++) {
      acc += segments[i].duration;
      borderTimes.push(acc);
    }
    borderTimes.forEach((t, i) => {
      const tick = document.createElement('div');
      tick.className = 'time-tick';
      // Clamp to 0% and 100% for first/last
      let percent = t === 0 ? 0 : (t === duration ? 100 : (t / duration * 100));
      tick.style.left = percent + '%';
      tick.textContent = i === borderTimes.length - 1 ? t + 'ms' : t;
      patternTimeAxis.appendChild(tick);
    });

  // POST Request senden
  sendPatternData(segments);
  // Autosave Pattern nach 5s Inaktivität
  schedulePatternSave(segments);
  } finally {
    isUpdating = false;
  }
}

// Pattern invertieren
function invertPattern() { //X
  console.log('Invert Pattern clicked');
  if (isUpdating) return;
  isUpdating = true;

  try {
    const phaseTags = patternPhases.querySelectorAll('.phase-tag');
    if (phaseTags.length === 0) {
      isUpdating = false;
      return;
    }

    let firstState = phaseTags[0].dataset.state === 'HIGH' ? 'LOW' : 'HIGH';
    let state = firstState;
    
    phaseTags.forEach(tag => {
      tag.classList.remove('HIGH', 'LOW');
      tag.classList.add(state);
      tag.dataset.state = state;
      state = state === 'HIGH' ? 'LOW' : 'HIGH';
    });
    isUpdating = false;
    updatePatternVisualization();
  } finally {
    isUpdating = false;
  }
}

// Morse Visualisierung aktualisieren
function updateMorseVisualization() {
  const ditDuration = parseInt(ditDurationInput.value) || 200;
  const text = morseTextInput.value.replace(/ß/g, 'ẞ').toUpperCase();
      
  // Morse Code generieren
  let morseCode = '';
  for (const char of text) {
    if (MORSE_CODE[char]) {
      morseCode += MORSE_CODE[char] + ' ';
    }
  }
  morseDisplay.textContent = morseCode.trim();

  // PWM-Linie zeichnen
  drawMorsePwmLine(ditDuration, text);
}

// Morse PWM-Linie zeichnen
function drawMorsePwmLine(ditDuration, text) {
  morseSignalCanvas.innerHTML = '';
  morseTimeAxis.innerHTML = '';
  
  // if text not ends with space, add one to ensure proper LOW at end
  if (text && !text.endsWith(' ')) text += ' ';

  const segments = generateMorseSegments(text, ditDuration);
  globalMorseSegments = segments;
  // calculate total duration
  const totalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0);

  // write calculated total duration into class .calculated-duration
  const calculatedDurationDiv = document.querySelector('.calculated-duration');
  calculatedDurationDiv.textContent = `${totalDuration/1000} s`;
  if (totalDuration <= 0) return;
  
  // Always fit the PWM line to the available width, never overflow
  const scale = morseSignalCanvas.clientWidth / totalDuration;
  // If totalDuration is 0, scale will be NaN, but we already return above if <= 0

  let currentTime = 0;
  segments.forEach(segment => {
    const width = segment.duration * scale;
    const div = document.createElement('div');
    div.className = 'segment ' + segment.state;
    div.style.left = (currentTime * scale) + 'px';
    div.style.width = width + 'px';
    morseSignalCanvas.appendChild(div);
    currentTime += segment.duration;
  });

  // Zeitachse nur an Phasengrenzen
  let borderTimes = [0];
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    acc += segments[i].duration;
    borderTimes.push(acc);
  }
  borderTimes.forEach((t, i) => {
    const tick = document.createElement('div');
    tick.className = 'time-tick';
    // Clamp to 0% and 100% for first/last
    let percent = t === 0 ? 0 : (t === totalDuration ? 100 : (t / totalDuration * 100));
    tick.style.left = percent + '%';
    tick.textContent = i === borderTimes.length - 1 ? t + 'ms' : t;
    morseTimeAxis.appendChild(tick);
  });

  sendPatternData(segments);
}

// Segmente für Morse PWM generieren
function generateMorseSegments(text, ditDuration) {
  const segments = [];
  let currentTime = 0;
      
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === ' ') {
      segments.push({state: 'LOW', duration: 7 * ditDuration});
      currentTime += 7 * ditDuration;
      continue;
    }
        
    if (!MORSE_CODE[char]) continue;
    
    const morse = MORSE_CODE[char];
    for (let j = 0; j < morse.length; j++) {
      if (morse[j] === '.') {
        segments.push({state: 'HIGH', duration: ditDuration});
        currentTime += ditDuration;
    } else if (morse[j] === '-') {
        segments.push({state: 'HIGH', duration: 3 * ditDuration});
        currentTime += 3 * ditDuration;
      }
          
      if (j < morse.length - 1) {
        segments.push({state: 'LOW', duration: ditDuration});
        currentTime += ditDuration;
      }
    }
        
    if (i < text.length - 1 && text[i+1] !== ' ') {
      segments.push({state: 'LOW', duration: 3 * ditDuration});
      currentTime += 3 * ditDuration;
    }
  }
      
  return segments;
}

// Daten von Endpunkten laden
async function loadInitialData() {
  // Morse Message laden
  try {
    const morseRes = await fetch('/morseMessage');
    if (morseRes.ok) {
      const morseText = await morseRes.text();
      morseTextInput.value = morseText;
    }
  } catch (e) {
    console.warn('Konnte /morseMessage nicht laden:', e);
  }
  // Pattern laden
  try {
    const patternRes = await fetch('/pattern');
    if (patternRes.ok) {
      const patternData = await patternRes.json();
      if (patternData && Array.isArray(patternData.patternChanges) && patternData.patternChanges.length > 0) {
        // Bestehende Tags entfernen
        const tags = Array.from(patternPhases.querySelectorAll('.phase-tag'));
        tags.forEach(tag => tag.remove());
        // Pattern als Tags anlegen
        let state = patternData.first || 'HIGH';
        patternData.patternChanges.forEach((duration, idx) => {
          addPhaseTag(state, duration, idx);
          state = state === 'HIGH' ? 'LOW' : 'HIGH';
        });
        createPatternFromPhases();
        updatePatternVisualization();
      }
    }
  } catch (e) {
    console.warn('Konnte /pattern nicht laden:', e);
  }
}

// Pattern speichern
async function savePatternData(segments) {
if (!segments) return;
const payload = {
  first: segments[0].state,
  patternChanges: [...segments.map(s => s.duration)]
};
try {
  await fetch('/pattern', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
    });
    console.log('Pattern gespeichert:', payload);
  } catch (e) {
    console.warn('Konnte Pattern nicht speichern:', e);
  }
}

// Morse Message speichern
async function saveMorseMessage(message) {
try {
  await fetch('/morseMessage', {
    method: 'POST',
    headers: {'Content-Type': 'text/plain'},
    body: message
  });
  console.log('MorseMessage gespeichert:', message);
  } catch (e) {
    console.warn('Konnte MorseMessage nicht speichern:', e);
  }
}

// Pattern Daten senden
async function sendPatternData(segments) {
  if (!segments) return;
      
  const payload = {
    first: segments[0].state,
    patternChanges: [...segments.map(s => s.duration)]
  };
      
  // In echter Implementierung:
  // fetch('/pattern', {
  //   method: 'POST',
  //   headers: {'Content-Type': 'application/json'},
  //   body: JSON.stringify(payload)
  // });
      
  console.log('POST /honkPattern:', payload);
}

window.onload = init;
