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
