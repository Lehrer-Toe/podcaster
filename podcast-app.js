// --- 1) SUPABASE KONFIG --- 
const SUPABASE_URL = "https://qzmzlrsfuepbkqwzbrir.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6bXpscnNmdWVwYmtxd3picmlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE5NTkxMzAsImV4cCI6MjA1NzUzNTEzMH0.zLZDSfylloUxlxYPEpfO4VMAdf0cNpUzKH2T9qv8ezI";

// Admin-Passwörter
const TEACHER_ADMIN_PASSWORD = "Welt";
const SUPER_ADMIN_PASSWORD = "Luna";

// Präfix und Suffix für öffentliche Dateien
const PUBLIC_PREFIX = "public_";

// Größe der Audio-Chunks in Millisekunden
const AUDIO_CHUNK_SIZE = 1000; // 1 Sekunde pro Chunk für bessere Kompatibilität

// Initialisiere Supabase Client - nur EINMAL für die gesamte App
let supabaseClient;
try {
  // Erstelle den Client mit deaktiviertem Caching und Auth
  const options = {
    db: {
      schema: 'public'
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    },
    global: {
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    }
  };
  
  // Erstelle den Client nur einmal
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options);
  console.log("Supabase Client erfolgreich initialisiert");
} catch (err) {
  console.error("Fehler bei der Supabase-Initialisierung:", err);
  showError("Verbindungsfehler: Bitte später erneut versuchen.");
}

// Funktion zum Aktualisieren der Dateilisten
function refreshFileList() {
  // Cache leeren
  clearLocalCache();
  
  // Dateilisten neu laden ohne neuen Client zu erstellen
  loadFilesByREST();
  
  // Admin-Dateien neu laden, falls im Admin-Bereich
  if (appSettings.adminLoggedIn) {
    loadAdminFilesByREST();
  }
}

// --- 2) Variablen ---
let mediaRecorder;
let audioStream;
let audioChunks = [];
let currentRecordingBlob = null;
let audioContext, analyser, dataArray, animationId;
let recordingTime = 0;
let recordingInterval = null;
let isRecording = false;

// Variable für den Audio-Verstärker (GainNode)
let gainNode;
// Standard-Verstärkungsfaktor (1.25x = 25% lauter)
const GAIN_VALUE = 1.25;

// Eigene Uploads speichern
let myUploads = [];

// Geräte- und Format-Erkennung
const appSettings = {
  adminLoggedIn: false,
  adminType: '', // 'teacher' oder 'super'
  lastFileName: localStorage.getItem('lastFileName') || '',
  isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent) || /Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 0,
  isSafari: /^((?!chrome|android).)*safari/i.test(navigator.userAgent),
  bestAudioFormat: 'audio/mp4', // Standard-Fallback für iOS
  myUploads: JSON.parse(localStorage.getItem('myUploads') || '[]'),
  selectedTeacherCode: localStorage.getItem('selectedTeacherCode') || '',
  selectedTeacherName: localStorage.getItem('selectedTeacherName') || ''
};

// Lade Uploads aus localStorage
myUploads = appSettings.myUploads;

// --- 3) DOM-Elemente ---
const filenameInput    = document.getElementById("filename");
const startBtn         = document.getElementById("startBtn");
const stopBtn          = document.getElementById("stopBtn");
const uploadBtn        = document.getElementById("uploadBtn");
const clearStorageBtn  = document.getElementById("clearStorageBtn");
const audioPlayer      = document.getElementById("audioPlayer");
const uploadStatus     = document.getElementById("uploadStatus");
const fileList         = document.getElementById("fileList");
const adminPanel       = document.getElementById("adminPanel");
const adminFileList    = document.getElementById("adminFileList");
const adminLoginBtn    = document.getElementById("adminLoginBtn");
const closeAdminBtn    = document.getElementById("closeAdminBtn");
const refreshAdminBtn  = document.getElementById("refreshAdminBtn");
const downloadAllBtn   = document.getElementById("downloadAllBtn");
const timerDisplay     = document.getElementById("timerDisplay");
const recordingStatus  = document.getElementById("recordingStatus");
const formatInfo       = document.getElementById("formatInfo");
const currentFormat    = document.getElementById("currentFormat");
const tabButtons       = document.querySelectorAll(".tab-button");
const tabContents      = document.querySelectorAll(".tab-content");
const passwordModal     = document.getElementById("passwordModal");
const adminPasswordInput = document.getElementById("adminPasswordInput");
const confirmLoginBtn   = document.getElementById("confirmLoginBtn");
const cancelLoginBtn    = document.getElementById("cancelLoginBtn");
const backToTeacherSelectionBtn = document.getElementById("backToTeacherSelection");
const teacherInfoDisplay = document.getElementById("teacherInfoDisplay");

// Zeige Lehrerinformationen an
function displayTeacherInfo() {
  const teacherCode = appSettings.selectedTeacherCode;
  const teacherName = appSettings.selectedTeacherName;
  
  if (!teacherCode || !teacherName) {
    // Zurück zur Lehrerauswahl, wenn keine Lehrerdaten vorhanden sind
    window.location.href = 'index.html';
    return;
  }
  
  teacherInfoDisplay.innerHTML = `
    <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23e0e0e0'/%3E%3Ctext x='50' y='60' font-family='Arial' font-size='30' text-anchor='middle' fill='%23666'%3E${teacherCode.charAt(0)}%3C/text%3E%3C/svg%3E" alt="${teacherName}">
    <h3>${teacherName}</h3>
  `;
}

// --- Prüft ob eine Datei öffentlich ist (beginnt mit dem PUBLIC_PREFIX) ---
function isFilePublic(fileName) {
  return fileName.startsWith(PUBLIC_PREFIX);
}

// --- Gibt den angezeigten Dateinamen (ohne Präfix) zurück ---
function getDisplayFileName(fileName) {
  if (isFilePublic(fileName)) {
    return fileName.substring(PUBLIC_PREFIX.length);
  }
  return fileName;
}

// --- Prüft, ob eine Datei dem aktuellen Lehrer gehört ---
function isFileForCurrentTeacher(fileName) {
  const teacherCode = appSettings.selectedTeacherCode;
  // Prüfen, ob der Dateiname mit dem Lehrercode beginnt
  // Öffentliche Dateien haben das PUBLIC_PREFIX, daher müssen wir nach dem Prefix suchen
  if (isFilePublic(fileName)) {
    const nameWithoutPrefix = fileName.substring(PUBLIC_PREFIX.length);
    return nameWithoutPrefix.startsWith(teacherCode + "_");
  } else {
    return fileName.startsWith(teacherCode + "_");
  }
}

// --- Funktion zum Laden der Dateien über den Supabase-Client ---
function loadFilesByREST() {
  fileList.innerHTML = "<li>Dateien werden geladen...</li>";
  
  // Supabase Client verwenden
  supabaseClient.storage
    .from('podcast-audio')
    .list('', {
      sortBy: { column: 'name', order: 'asc' }
    })
    .then(response => {
      if (response.error) {
        throw response.error;
      }
      
      const files = response.data || [];
      
      if (!files || files.length === 0) {
        fileList.innerHTML = "<li>Keine Aufnahmen vorhanden</li>";
        return;
      }
      
      fileList.innerHTML = "";
      
      // Zur Anzeige ausgewählte Dateien
      const visibleFiles = files.filter(file => {
        const userOwnsFile = myUploads.includes(file.name);
        const isPublic = isFilePublic(file.name);
        const isForCurrentTeacher = isFileForCurrentTeacher(file.name);
        
        // Dateien anzeigen, die dem Benutzer gehören ODER öffentlich sind UND dem aktuellen Lehrer zugeordnet sind
        return userOwnsFile || (isPublic && isForCurrentTeacher);
      });
      
      if (visibleFiles.length === 0) {
        fileList.innerHTML = "<li>Keine sichtbaren Aufnahmen vorhanden</li>";
        return;
      }
      
      // Cache-Busting Parameter
      const cacheBuster = Date.now();
      
      // Liste erstellen
      for (const file of visibleFiles) {
        // Öffentliche URL generieren
        const { data } = supabaseClient.storage
          .from('podcast-audio')
          .getPublicUrl(file.name);
          
        const publicUrl = data.publicUrl;
        
        // Cache-Busting Parameter zum URL hinzufügen
        const noCacheUrl = publicUrl + (publicUrl.includes('?') ? '&' : '?') + '_cb=' + cacheBuster;
        
        const isPublic = isFilePublic(file.name);
        const isOwner = myUploads.includes(file.name);
        const displayName = getDisplayFileName(file.name);
        
        const li = document.createElement('li');
        if (isPublic) {
          li.className = 'public-file';
        }
        
        li.innerHTML = `
          <a href="${noCacheUrl}" target="_blank" download="${file.name}">
            ${displayName}
          </a>
          <span class="file-size">(${formatBytes(file.metadata?.size || 0)})</span>
          ${isPublic ? '<span class="file-visibility-icon">👁️</span>' : ''}
          ${isOwner ? ' (Meine Datei)' : ''}
        `;
        
        fileList.appendChild(li);
      }
    })
    .catch(function(err) {
      console.error("Fehler beim Laden der Dateien:", err);
      fileList.innerHTML = "<li class='error-message'>Fehler beim Laden der Dateien: " + (err.message || "Unbekannter Fehler") + "</li>";
    });
}
// --- Funktion zum Laden der Admin-Dateien ---
function loadAdminFilesByREST() {
  adminFileList.innerHTML = "<li>Dateien werden geladen...</li>";
  
  // Supabase Client verwenden
  supabaseClient.storage
    .from('podcast-audio')
    .list('', {
      sortBy: { column: 'name', order: 'asc' }
    })
    .then(response => {
      if (response.error) {
        throw response.error;
      }
      
      const files = response.data || [];
      
      if (!files || files.length === 0) {
        adminFileList.innerHTML = "<li>Keine Aufnahmen vorhanden</li>";
        return;
      }
      
      // Filtere Dateien für Lehrer-Admin, Super-Admin sieht alle
      let adminFiles = files;
      if (appSettings.adminType === 'teacher') {
        adminFiles = files.filter(file => isFileForCurrentTeacher(file.name));
        if (adminFiles.length === 0) {
          adminFileList.innerHTML = "<li>Keine Aufnahmen für diesen Lehrer vorhanden</li>";
          return;
        }
      }
      
      adminFileList.innerHTML = "";
      
      // Cache-Busting Parameter
      const cacheBuster = Date.now();
      
      // Admin-Liste erstellen
      for (const file of adminFiles) {
        // Öffentliche URL generieren
        const { data } = supabaseClient.storage
          .from('podcast-audio')
          .getPublicUrl(file.name);
          
        const publicUrl = data.publicUrl;
        
        // Cache-Busting Parameter zum URL hinzufügen
        const noCacheUrl = publicUrl + (publicUrl.includes('?') ? '&' : '?') + '_cb=' + cacheBuster;
        
        const isPublic = isFilePublic(file.name);
        const displayName = getDisplayFileName(file.name);
        
        const li = document.createElement('li');
        li.className = isPublic ? 'public-file' : 'private-file';
        li.dataset.filename = file.name;
        
        li.innerHTML = `
          <a href="${noCacheUrl}" target="_blank">${displayName}</a>
          <span class="file-size">(${formatBytes(file.metadata?.size || 0)})</span>
          <span class="file-visibility">
            <span class="file-visibility-icon">${isPublic ? '👁️' : '🔒'}</span>
          </span>
          <button class="toggle-visibility" data-filename="${file.name}">
            ${isPublic ? 'Privat machen' : 'Öffentlich machen'}
          </button>
          <button class="delete" data-filename="${file.name}">Löschen</button>
        `;
        
        adminFileList.appendChild(li);
      }
    })
    .catch(function(err) {
      console.error("Fehler beim Laden der Admin-Dateien:", err);
      adminFileList.innerHTML = "<li class='error-message'>Fehler beim Laden der Dateien: " + (err.message || "Unbekannter Fehler") + "</li>";
    });
}

// --- 4) Initialisierung ---
function init() {
  // Prüfe, ob Lehrerauswahl vorhanden ist
  if (!appSettings.selectedTeacherCode || !appSettings.selectedTeacherName) {
    // Zurück zur Lehrerauswahl
    window.location.href = 'index.html';
    return;
  }
  
  // Zeige Lehrerinformationen an
  displayTeacherInfo();
  
  // Debug-Info für bessere Fehlerbehebung
  console.log("Browser-Info:", navigator.userAgent);
  console.log("Geräteerkennung - iOS:", appSettings.isIOS, "Safari:", appSettings.isSafari);
  console.log("Ausgewählter Lehrer:", appSettings.selectedTeacherName, "Code:", appSettings.selectedTeacherCode);
  
  // Cache löschen beim Start
  clearLocalCache();
  
  // Lokalen Aufnahmespeicher löschen - für Datenschutz bei jedem Neuladen
  clearSavedRecording();
  
  // Default-Dateiname mit Lehrerkürzel vorbelegen
  if (appSettings.selectedTeacherCode) {
    const defaultName = appSettings.selectedTeacherCode + "_";
    filenameInput.placeholder = "Schülername eingeben";
    if (!filenameInput.value) {
      filenameInput.value = defaultName;
    }
  }
  
  // Lade gespeicherte Einstellungen aus dem LocalStorage
  if (appSettings.lastFileName) {
    filenameInput.value = appSettings.lastFileName;
  }
  
  // Immer validateFileName ausführen, um den Button-Status zu aktualisieren
  validateFileName();
  
  // Prüfe Browser-Unterstützung
  if (!checkBrowserSupport()) return;
  
  // Bestimme das beste Audio-Format für diesen Browser
  determineOptimalAudioFormat();
  
  // Setze Event Listeners
  setupEventListeners();
  
  // Prüfe, ob es eine gespeicherte Aufnahme gibt
  checkForSavedRecording();
  
  // Lade vorhandene Dateien mit direkter REST-API
  loadFilesByREST();
}

// --- Function: Cache löschen ---
function clearLocalCache() {
  console.log("Lokalen Cache für Dateien löschen...");
  
  // Entferne Dateilisten-Cache
  sessionStorage.removeItem('fileListCache');
  
  // Entferne gespeicherte API-Antworten
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key && key.startsWith('api_')) {
      sessionStorage.removeItem(key);
    }
  }
  
  console.log("Lokaler Cache gelöscht");
}

// --- 5) Browser-Unterstützung prüfen ---
function checkBrowserSupport() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError("Ihr Browser unterstützt keine Audioaufnahmen. Bitte verwenden Sie einen modernen Browser wie Chrome, Firefox oder Edge.");
    startBtn.disabled = true;
    return false;
  }
  return true;
}

// --- Datei-Sichtbarkeit ändern (durch Umbenennen) ---
async function setFilePublic(fileName, isPublic) {
  try {
    // Check current status
    const currentlyPublic = isFilePublic(fileName);
    
    // Already in desired state
    if (currentlyPublic === isPublic) {
      console.log(`Datei ${fileName} ist bereits ${isPublic ? 'öffentlich' : 'privat'}`);
      return true;
    }
    
    // Determine new filename
    let newFileName;
    if (isPublic && !currentlyPublic) {
      // Make public: Add prefix
      newFileName = PUBLIC_PREFIX + fileName;
    } else if (!isPublic && currentlyPublic) {
      // Make private: Remove prefix
      newFileName = fileName.substring(PUBLIC_PREFIX.length);
    } else {
      // No change needed (should not happen)
      return true;
    }
    
    console.log(`Ändere Datei von ${fileName} zu ${newFileName}`);
    
    // Download current file
    const { data: fileData, error: fileError } = await supabaseClient.storage
      .from('podcast-audio')
      .download(fileName);
    
    if (fileError) {
      console.error("Fehler beim Herunterladen der Datei:", fileError);
      throw fileError;
    }
    
    // Upload with new name
    const { error: uploadError } = await supabaseClient.storage
      .from('podcast-audio')
      .upload(newFileName, fileData, {
        contentType: 'audio/mp4',
        upsert: true
      });
    
    if (uploadError) {
      console.error("Fehler beim Hochladen mit neuem Namen:", uploadError);
      throw uploadError;
    }
    
    // Delete old file
    const { error: deleteError } = await supabaseClient.storage
      .from('podcast-audio')
      .remove([fileName]);
    
    if (deleteError) {
      console.error("Fehler beim Löschen der alten Datei:", deleteError);
      throw deleteError;
    }
    
    // Update myUploads list
    if (myUploads.includes(fileName)) {
      myUploads = myUploads.filter(name => name !== fileName);
      myUploads.push(newFileName);
      localStorage.setItem('myUploads', JSON.stringify(myUploads));
      appSettings.myUploads = myUploads;
    }
    
    console.log(`Datei erfolgreich ${isPublic ? 'öffentlich' : 'privat'} gemacht:`, newFileName);
    return true;
  } catch (error) {
    console.error("Fehler beim Ändern der Sichtbarkeit:", error);
    showError("Fehler beim Ändern der Sichtbarkeit: " + (error.message || "Unbekannter Fehler"));
    return false;
  }
}

// --- Beste Audio-Format-Erkennung ---
function determineOptimalAudioFormat() {
  // Für iOS-Geräte werden wir diese Formate in dieser Reihenfolge testen
  const formatsToTest = [
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav'
  ];
  
  let foundFormat = false;
  
  // Standardwert anzeigen während wir testen
  currentFormat.textContent = "Wird geprüft...";
  
  for (const format of formatsToTest) {
    if (MediaRecorder.isTypeSupported(format)) {
      console.log(`Format ${format} wird unterstützt!`);
      appSettings.bestAudioFormat = format;
      currentFormat.textContent = formatReadableName(format);
      foundFormat = true;
      break;
    } else {
      console.log(`Format ${format} wird nicht unterstützt.`);
    }
  }
  
  if (!foundFormat) {
    // Wenn kein getestetes Format unterstützt wird, verwenden wir den Standard-MediaRecorder ohne expliziten mimeType
    currentFormat.textContent = "Standard (geräteabhängig)";
    console.warn("Kein bekanntes Format wird unterstützt. Verwende Standard-Format des Browsers.");
    appSettings.bestAudioFormat = '';
  }
}

function formatReadableName(mimeType) {
  const formatMap = {
    'audio/mp4': 'MP4 Audio',
    'audio/aac': 'AAC Audio',
    'audio/wav': 'WAV Audio',
    'audio/mpeg': 'MP3 Audio',
    'audio/webm': 'WebM Audio',
    'audio/webm;codecs=pcm': 'WebM PCM Audio'
  };
  
  return formatMap[mimeType] || mimeType;
}

function getFileExtension(mimeType) {
  const extensionMap = {
    'audio/mp4': '.m4a',
    'audio/aac': '.aac',
    'audio/wav': '.wav',
    'audio/mpeg': '.mp3',
    'audio/webm': '.webm',
    'audio/webm;codecs=pcm': '.webm'
  };
  
  return extensionMap[mimeType] || '.m4a'; // Standardmäßig .m4a für iOS
}

// --- 6) Event Listeners ---
function setupEventListeners() {
  // Dateiname-Validierung
  filenameInput.addEventListener("input", validateFileName);
  
  // Aufnahme-Steuerung (ohne Pause/Resume)
  startBtn.addEventListener("click", startRecording);
  stopBtn.addEventListener("click", stopRecording);
  uploadBtn.addEventListener("click", uploadRecording);
  clearStorageBtn.addEventListener("click", clearAllLocalStorage);
  
  // Admin-Bereich
  adminLoginBtn.addEventListener("click", showPasswordModal);
  closeAdminBtn.addEventListener("click", () => {
    adminPanel.style.display = "none";
    appSettings.adminLoggedIn = false;
    appSettings.adminType = '';
  });
  downloadAllBtn.addEventListener("click", downloadAllFiles);
  refreshAdminBtn.addEventListener("click", loadAdminFilesByREST);
  
  // Password Modal
  confirmLoginBtn.addEventListener("click", handleAdminLogin);
  cancelLoginBtn.addEventListener("click", hidePasswordModal);
  adminPasswordInput.addEventListener("keyup", (e) => {
    if (e.key === "Enter") {
      handleAdminLogin();
    }
  });
  
  // Tab-Navigation
  tabButtons.forEach(button => {
    button.addEventListener("click", () => {
      const tabId = button.dataset.tab;
      
      // Aktiven Tab wechseln
      tabButtons.forEach(btn => btn.classList.remove("active"));
      tabContents.forEach(content => content.classList.remove("active"));
      
      button.classList.add("active");
      document.getElementById(`${tabId}-tab`).classList.add("active");
    });
  });

  // Dateiliste Verwalten (für Admin)
  adminFileList.addEventListener("click", handleAdminFileAction);
  
  // Zurück-Button
  backToTeacherSelectionBtn.addEventListener("click", () => {
    // Zurück zur Lehrerauswahl
    localStorage.removeItem('selectedTeacherCode');
    localStorage.removeItem('selectedTeacherName');
    window.location.href = 'index.html';
  });
  
  // Audio-Player-Fehlerbehandlung
  audioPlayer.addEventListener('error', function(e) {
    console.error('Audio-Player-Fehler:', e);
    console.log('Audio-Quelle:', audioPlayer.src);
    showError("Fehler beim Abspielen der Aufnahme. Versuchen Sie es erneut.");
  });
  
  // Für iOS Touch-Events aktivieren
  if (appSettings.isIOS) {
    document.addEventListener('touchstart', function(){}, {passive: true});
  }
}

// --- 7) Dateiname-Validierung ---
function validateFileName() {
  const filename = filenameInput.value.trim();
  const teacherCode = appSettings.selectedTeacherCode;
  
  // Prüfe, ob der Dateiname mit dem Lehrercode beginnt
  if (filename && teacherCode) {
    if (!filename.startsWith(teacherCode + "_")) {
      // Wenn der Dateiname nicht mit dem Code beginnt, füge ihn hinzu
      filenameInput.value = teacherCode + "_" + filename;
      localStorage.setItem('lastFileName', filenameInput.value);
    }
    
    startBtn.disabled = false;
  } else if (filename) {
    startBtn.disabled = false;
    localStorage.setItem('lastFileName', filename);
  } else {
    startBtn.disabled = true;
  }

  // Debug-Information
  console.log("Dateiname validiert:", filenameInput.value, "Start-Button aktiviert:", !startBtn.disabled);
}
// --- 7.1) Admin-Login-Funktion ---
function handleAdminLogin() {
  const enteredPassword = adminPasswordInput.value;
  
  // Prüfe Lehrer-Admin
  if (enteredPassword === TEACHER_ADMIN_PASSWORD) {
    // Lehrer-Admin kann nur eigene Dateien sehen
    appSettings.adminLoggedIn = true;
    appSettings.adminType = 'teacher';
    hidePasswordModal();
    adminPanel.style.display = 'block';
    
    // Admin-Dateien laden (nur für diesen Lehrer)
    loadAdminFilesByREST();
    
    showSuccess(`Admin-Bereich für ${appSettings.selectedTeacherName} freigeschaltet.`);
  }
  // Prüfe Super-Admin
  else if (enteredPassword === SUPER_ADMIN_PASSWORD) {
    // Super-Admin sieht alle Dateien
    appSettings.adminLoggedIn = true;
    appSettings.adminType = 'super';
    hidePasswordModal();
    adminPanel.style.display = 'block';
    
    // Admin-Dateien laden (alle)
    loadAdminFilesByREST();
    
    showSuccess("Super-Admin-Bereich freigeschaltet.");
  }
  else {
    // Falsches Passwort
    showError("Falsches Passwort!");
    adminPasswordInput.value = "";
    adminPasswordInput.focus();
  }
}

// --- 7.2) Zeige Password Modal ---
function showPasswordModal() {
  passwordModal.style.display = "block";
  adminPasswordInput.value = "";
  adminPasswordInput.focus();
}

// --- 7.3) Verstecke Password Modal ---
function hidePasswordModal() {
  passwordModal.style.display = "none";
}

// --- 7.4) Lokalen Speicher vollständig löschen ---
function clearAllLocalStorage() {
  if (confirm("Möchten Sie wirklich den gesamten lokalen Speicher löschen? Dies entfernt alle gespeicherten Aufnahmen und Einstellungen.")) {
    // Speicher für aktuelle Aufnahme löschen
    clearSavedRecording();
    
    // Benutzereinstellungen löschen
    localStorage.removeItem('lastFileName');
    localStorage.removeItem('myUploads');
    
    // Session Storage leeren
    sessionStorage.clear();
    
    // Audio-Player zurücksetzen
    audioPlayer.src = '';
    
    // Variable zurücksetzen
    currentRecordingBlob = null;
    myUploads = [];
    appSettings.myUploads = [];
    
    // UI aktualisieren
    uploadBtn.disabled = true;
    
    // Dateiliste aktualisieren
    loadFilesByREST();
    
    showSuccess("Lokaler Speicher wurde vollständig gelöscht.");
  }
}

// --- 8) Aufnahme starten --- ÜBERARBEITET FÜR BESSERE KOMPATIBILITÄT
function startRecording() {
  // Dateiname aus Input holen und sicherstellen, dass der Lehrer-Code enthalten ist
  let filename = filenameInput.value.trim();
  const teacherCode = appSettings.selectedTeacherCode;
  
  if (!filename) {
    showError("Bitte erst einen Schülernamen eingeben!");
    return;
  }
  
  // Sicherstellen, dass der Dateiname das korrekte Format hat
  if (teacherCode && !filename.startsWith(teacherCode + "_")) {
    filename = teacherCode + "_" + filename;
    filenameInput.value = filename;
  }
  
  if (!checkBrowserSupport()) return;
  
  // Bereinige vorherige Aufnahme
  audioChunks = [];
  if (currentRecordingBlob) {
    URL.revokeObjectURL(audioPlayer.src);
    currentRecordingBlob = null;
  }
  
  // Optimierte Audioeinstellungen
  const constraints = {
    audio: {
      // Zuverlässige Standardeinstellungen
      channelCount: 1,               // Mono für bessere Kompatibilität
      echoCancellation: true,        // Hilfreich für Sprachaufnahmen
      noiseSuppression: true,        // Verbessert Sprachqualität
      autoGainControl: true          // Hilft, die Lautstärke zu stabilisieren
    }
  };
  
  // Audiostream anfordern
  navigator.mediaDevices.getUserMedia(constraints)
    .then(function(stream) {
      audioStream = stream;
      
      try {
        // Vollständig zurücksetzen, falls bereits vorhanden
        if (audioContext) {
          audioContext.close().catch(() => {});
        }
        
        audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        
        // GainNode für die Verstärkung erstellen
        gainNode = audioContext.createGain();
        gainNode.gain.value = GAIN_VALUE; // Verstärkung um Faktor 1.25
        
        // Verbindung herstellen: Quelle -> Verstärker
        source.connect(gainNode);
        
        // Destination für MediaRecorder
        const destination = audioContext.createMediaStreamDestination();
        gainNode.connect(destination);
        
        // WICHTIG: Der verstärkte Stream für den MediaRecorder
        const amplifiedStream = destination.stream;
        
        // MediaRecorder initialisieren mit besten Optionen
        // Wir verwenden kleinere Chunks für bessere Zuverlässigkeit
        let recorderOptions = {
          audioBitsPerSecond: 128000  // 128 kbps - gute Qualität
        };
        
        // Verwende das beste erkannte Format, wenn verfügbar
        if (appSettings.bestAudioFormat) {
          recorderOptions.mimeType = appSettings.bestAudioFormat;
          console.log(`Verwende Format: ${appSettings.bestAudioFormat}`);
        } else {
          console.log("Verwende Standard-Format des Browsers");
        }
        
        try {
          // Verstärkten Stream für die Aufnahme verwenden
          mediaRecorder = new MediaRecorder(amplifiedStream, recorderOptions);
        } catch (formatError) {
          console.error("Format wird nicht unterstützt:", formatError);
          console.log("Versuche ohne mimeType-Angabe...");
          mediaRecorder = new MediaRecorder(amplifiedStream, {
            audioBitsPerSecond: 128000
          });
          
          // Update formatInfo-Anzeige
          currentFormat.textContent = "Standard (geräteabhängig)";
        }
        
        // MediaRecorder-Format anzeigen
        if (mediaRecorder.mimeType) {
          currentFormat.textContent = formatReadableName(mediaRecorder.mimeType);
          console.log("Tatsächlich verwendetes Format:", mediaRecorder.mimeType);
          appSettings.bestAudioFormat = mediaRecorder.mimeType;
        }
        
        // Event Handling
        mediaRecorder.ondataavailable = handleDataAvailable;
        mediaRecorder.onstop = handleRecordingStop;
        mediaRecorder.onerror = function(event) {
          showError("Aufnahmefehler: " + event.error);
          stopRecording();
        };
        
        // Überwachung für kritische Fehler
        mediaRecorder.addEventListener('error', function(e) {
          console.error('MediaRecorder Fehler:', e);
          stopRecording();
        });
        
        // Aufnahme starten
        mediaRecorder.start(AUDIO_CHUNK_SIZE); // Häufigere, kleinere Chunks für bessere Zuverlässigkeit
        isRecording = true;
        
        // UI aktualisieren
        updateRecordingUI(true);
        startTimer();
        
        showMessage("Aufnahme läuft...");
      } catch (error) {
        console.error("Aufnahme-Setup-Fehler:", error);
        cleanupRecording();
        showError("Fehler beim Starten der Aufnahme: " + error.message);
      }
    })
    .catch(function(err) {
      let errorMsg = "Aufnahmefehler";
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMsg = "Mikrofon-Zugriff verweigert. Bitte erteilen Sie die Berechtigung in Ihren Browsereinstellungen.";
      } else if (err.name === 'NotFoundError') {
        errorMsg = "Kein Mikrofon gefunden. Bitte prüfen Sie, ob ein Mikrofon angeschlossen ist.";
      } else {
        errorMsg = err.message || "Aufnahmefehler. Bitte versuchen Sie es erneut.";
      }
      
      showError(errorMsg);
      console.error("Aufnahmefehler:", err);
    });
}

// --- Aufnahme aufräumen ---
function cleanupRecording() {
  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop());
    audioStream = null;
  }
  
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  
  mediaRecorder = null;
  isRecording = false;
}

// --- 11) Aufnahme stoppen ---
function stopRecording() {
  if (mediaRecorder && (mediaRecorder.state === "recording" || mediaRecorder.state === "paused")) {
    try {
      // Sicherer Stopp
      mediaRecorder.stop();
      isRecording = false;
      
      // Bereinigung
      if (audioStream) {
        audioStream.getTracks().forEach(function(track) {
          track.stop();
        });
      }
      
      stopTimer();
      updateRecordingUI(false);
      
      // AudioContext schließen
      if (audioContext) {
        audioContext.close().catch(err => console.warn("Fehler beim Schließen des AudioContext:", err));
      }
    } catch (error) {
      console.error("Fehler beim Stoppen der Aufnahme:", error);
      showError("Fehler beim Stoppen der Aufnahme. Bitte laden Sie die Seite neu.");
      
      // Notfall-Reset falls das Stoppen nicht funktioniert
      isRecording = false;
      cleanupRecording();
      updateRecordingUI(false);
    }
  }
}

// --- 12) Media Recorder Event Handler --- VERBESSERT
function handleDataAvailable(event) {
  if (event.data && event.data.size > 0) {
    audioChunks.push(event.data);
  }
}

// Verbesserte Funktion zum Verarbeiten der Aufnahme
function handleRecordingStop() {
  try {
    // Wenn keine Chunks vorhanden sind, Fehler anzeigen
    if (audioChunks.length === 0) {
      showError("Keine Audiodaten aufgenommen. Bitte versuchen Sie es erneut.");
      return;
    }
    
    // Log der Chunks für die Fehlerbehebung
    console.log(`${audioChunks.length} Audiochunks aufgenommen. Gesamtlänge wird berechnet...`);
    
    // Erzwinge ein bestimmtes Format für die Ausgabe
    // Dies verbessert die Kompatibilität beim Abspielen
    const mimeType = 'audio/mp4'; // Hohe Kompatibilität auf allen Geräten
    
    // Neuen Blob mit allen Chunks erzeugen
    const finalBlob = new Blob(audioChunks, { type: mimeType });
    
    // Größe und Länge überprüfen
    console.log("Aufnahme abgeschlossen. Größe:", formatBytes(finalBlob.size));
    
    if (finalBlob.size < 100) {
      showError("Die Aufnahme ist zu klein. Bitte versuchen Sie es erneut.");
      return;
    }
    
    // Alte Blob-URL freigeben
    if (audioPlayer.src) {
      URL.revokeObjectURL(audioPlayer.src);
    }
    
    // Speichern und Anzeigen des neuen Blobs
    currentRecordingBlob = finalBlob;
    const audioUrl = URL.createObjectURL(finalBlob);
    audioPlayer.src = audioUrl;
    
    // Explizites Laden des Audios erzwingen
    audioPlayer.load();
    
    // UI aktualisieren
    uploadBtn.disabled = false;
    showMessage("Aufnahme bereit – bitte jetzt anhören und hochladen.");
    
    // Lokale Kopie speichern
    saveRecording(finalBlob, mimeType);
    
  } catch (error) {
    console.error("Fehler beim Verarbeiten der Aufnahme:", error);
    showError("Fehler beim Verarbeiten der Aufnahme: " + error.message);
  }
}

// --- 13) Aufnahme hochladen ---
function uploadRecording() {
  if (!currentRecordingBlob) {
    showError("Keine Aufnahme vorhanden!");
    return;
  }
  
  // Prüfen, ob die Blob-Größe vernünftig ist
  if (currentRecordingBlob.size < 1000) {
    showError("Die Aufnahme ist zu klein zum Hochladen. Bitte nehmen Sie eine neue Aufnahme auf.");
    return;
  }
  
  showMessage("Wird hochgeladen...");
  uploadBtn.disabled = true;
  
  // Dateinamen vorbereiten und sicherstellen, dass er mit dem Lehrerkürzel beginnt
  let baseName = filenameInput.value.trim();
  const teacherCode = appSettings.selectedTeacherCode;
  
  // Sicherstellen, dass der Dateiname mit dem Lehrerkürzel beginnt
  if (teacherCode && !baseName.startsWith(teacherCode + "_")) {
    baseName = teacherCode + "_" + baseName;
  }
  
  const mimeType = 'audio/mp4'; // Verwende einheitliches Format für bessere Kompatibilität
  let extension = '.m4a'; // Einheitliche Endung für bessere Kompatibilität
  
  // Aktuelles Datum für den Dateinamen
  const today = new Date();
  const dateString = today.getFullYear() + 
                    ('0' + (today.getMonth() + 1)).slice(-2) + 
                    ('0' + today.getDate()).slice(-2);
  
  // Uhrzeit für Eindeutigkeit bei Namensgleichheit
  const timeString = ('0' + today.getHours()).slice(-2) + 
                    ('0' + today.getMinutes()).slice(-2) +
                    ('0' + today.getSeconds()).slice(-2);
  
  // Eindeutigen Dateinamen erstellen
  let fileName = `${baseName}_${dateString}_${timeString}${extension}`;
  
  console.log("Upload starten: Datei", fileName, "Größe:", formatBytes(currentRecordingBlob.size), "Format:", mimeType);
  
  // Supabase Storage Upload mit ContentType
  supabaseClient.storage
    .from('podcast-audio')
    .upload(fileName, currentRecordingBlob, { 
      contentType: mimeType,
      upsert: true, // Überschreiben falls Datei existiert
      cacheControl: '0' // Vermeidet Caching
    })
    .then(function(response) {
      if (response.error) {
        throw response.error;
      }
      
      // Speichere in myUploads, dass diese Datei vom Benutzer hochgeladen wurde
      if (!myUploads.includes(fileName)) {
        myUploads.push(fileName);
        localStorage.setItem('myUploads', JSON.stringify(myUploads));
        appSettings.myUploads = myUploads;
      }
      
      // Erfolgsmeldung
      showSuccess("✅ Erfolgreich hochgeladen: " + fileName);
      currentRecordingBlob = null;
      
      // Lokale Aufnahme löschen
      clearSavedRecording();
      
      // Audio-Player zurücksetzen
      audioPlayer.src = '';
      
      // Dateiliste aktualisieren
      refreshFileList();
    })
    .catch(function(error) {
      console.error("Upload-Fehler:", error);
      showError("❌ Fehler beim Upload: " + (error.message || "Verbindungsproblem"));
      uploadBtn.disabled = false;
    });
}
// --- 14) Admin-Dateiaktionen mit echtem Löschen und Sichtbarkeitsänderung ---
function handleAdminFileAction(e) {
  const target = e.target;
  
  // Datei löschen
  if (target.classList.contains("delete")) {
    const fileName = target.getAttribute("data-filename");
    
    if (!confirm(`Sind Sie sicher, dass Sie die Datei "${getDisplayFileName(fileName)}" löschen möchten?`)) {
      return;
    }
    
    // Anzeigen, dass die Löschung läuft
    target.textContent = "Wird gelöscht...";
    target.disabled = true;
    
    // ECHTES LÖSCHEN mit Supabase Client
    console.log("Beginne echte Löschung für Datei:", fileName);
    
    supabaseClient.storage
      .from('podcast-audio')
      .remove([fileName])
      .then(function(response) {
        console.log("Löschvorgang Antwort:", response);
        
        if (response.error) {
          throw response.error;
        }
        
        // Entferne aus myUploads
        if (myUploads.includes(fileName)) {
          myUploads = myUploads.filter(name => name !== fileName);
          localStorage.setItem('myUploads', JSON.stringify(myUploads));
          appSettings.myUploads = myUploads;
        }
        
        // Entferne das Element direkt aus der DOM
        const liElement = adminFileList.querySelector(`li[data-filename="${fileName}"]`);
        if (liElement) {
          liElement.remove();
        }
        
        showSuccess(`Datei '${getDisplayFileName(fileName)}' wurde erfolgreich gelöscht.`);
        
        // Die Dateilisten nach kurzer Verzögerung aktualisieren
        setTimeout(function() {
          loadFilesByREST();
          loadAdminFilesByREST();
        }, 1000);
      })
      .catch(function(err) {
        console.error("Fehler beim Löschen:", err);
        showError(`Fehler beim Löschen: ${err.message || "Unbekannter Fehler"}`);
        target.textContent = "Löschen";
        target.disabled = false;
      });
  }
  
  // Sichtbarkeit ändern
  if (target.classList.contains("toggle-visibility")) {
    const fileName = target.getAttribute("data-filename");
    const makePublic = target.textContent.includes("Öffentlich machen");
    
    // Button-Status aktualisieren
    target.textContent = "Wird aktualisiert...";
    target.disabled = true;
    
    // Globale Sichtbarkeit durch Umbenennen aktualisieren
    setFilePublic(fileName, makePublic)
      .then(success => {
        if (success) {
          showSuccess(`Die Sichtbarkeit von '${getDisplayFileName(fileName)}' wurde aktualisiert.`);
          
          // Dateilisten aktualisieren
          setTimeout(() => {
            loadFilesByREST();
            loadAdminFilesByREST();
          }, 500);
        } else {
          // Fehlerfall
          target.textContent = makePublic ? 'Öffentlich machen' : 'Privat machen';
          target.disabled = false;
        }
      })
      .catch(error => {
        console.error("Unerwarteter Fehler bei Sichtbarkeitsänderung:", error);
        showError(`Fehler beim Ändern der Sichtbarkeit: ${error.message || "Unbekannter Fehler"}`);
        target.textContent = makePublic ? 'Öffentlich machen' : 'Privat machen';
        target.disabled = false;
      });
  }
}

// --- 15) Alles herunterladen (ZIP) ---
function downloadAllFiles() {
  showMessage("ZIP-Datei wird vorbereitet...");
  
  // Mehr Debugging und robuste Fehlerbehandlung
  console.log("Starte Download aller Dateien...");
  
  // Filter für Admin-Typ
  let fileFilter = null;
  if (appSettings.adminType === 'teacher') {
    // Lehrer-Admin filtert nur seine eigenen Dateien
    fileFilter = (file) => isFileForCurrentTeacher(file.name);
  }
  
  supabaseClient.storage
    .from('podcast-audio')
    .list('', { 
      limit: 100, 
      sortBy: { column: 'name', order: 'asc' }
    })
    .then(function(response) {
      if (response.error) {
        throw response.error;
      }
      
      let data = response.data || [];
      
      // Filtere Dateien falls nötig
      if (fileFilter) {
        data = data.filter(fileFilter);
      }
      
      console.log(`${data.length} Dateien gefunden zum Herunterladen.`);
      
      if (!data || data.length === 0) {
        showWarning("Keine Dateien zum Herunterladen vorhanden.");
        return;
      }
      
      // ZIP-Datei erstellen
      const zip = new JSZip();
      let completedDownloads = 0;
      let failedDownloads = 0;
      
      // Fortschritt anzeigen
      showMessage(`Lade 0/${data.length} Dateien...`);
      
      // Alle Dateien herunterladen und zum ZIP hinzufügen mit verbesserter Fehlerbehandlung
      const downloadPromises = data.map(function(file) {
        return new Promise(function(resolve) {
          const fileName = file.name;
          console.log(`Beginne Download für Datei: ${fileName}`);
          
          const { data: urlData } = supabaseClient
            .storage
            .from('podcast-audio')
            .getPublicUrl(fileName);
          
          if (!urlData || !urlData.publicUrl) {
            console.error(`Konnte keine URL für ${fileName} erhalten`);
            failedDownloads++;
            resolve();
            return;
          }
          
          const fileUrl = urlData.publicUrl;
          console.log(`URL für ${fileName}: ${fileUrl}`);
          
          // Versuche 3x mit zunehmender Verzögerung
          let attempts = 0;
          const maxAttempts = 3;
          
          function attemptDownload() {
            // Cache-Buster hinzufügen
            const cacheBustedUrl = fileUrl + (fileUrl.includes('?') ? '&' : '?') + 'cb=' + Date.now();
            
            console.log(`Versuch ${attempts+1}/${maxAttempts} für ${fileName}`);
            
            fetch(cacheBustedUrl)
              .then(function(response) {
                if (!response.ok) {
                  throw new Error(`HTTP Fehler: ${response.status}`);
                }
                return response.blob();
              })
              .then(function(blob) {
                // Verwende den angezeigten Namen ohne Präfix im ZIP
                const displayName = getDisplayFileName(fileName);
                zip.file(displayName, blob);
                completedDownloads++;
                console.log(`Datei ${fileName} erfolgreich heruntergeladen (${completedDownloads}/${data.length})`);
                showMessage(`Lade ${completedDownloads}/${data.length} Dateien...`);
                resolve();
              })
              .catch(function(fetchError) {
                console.error(`Fetch Fehler für ${fileName} (Versuch ${attempts+1}):`, fetchError);
                
                attempts++;
                if (attempts < maxAttempts) {
                  const delay = attempts * 1000; // Zunehmende Verzögerung (1s, 2s, 3s)
                  console.log(`Neuer Versuch für ${fileName} in ${delay}ms...`);
                  setTimeout(attemptDownload, delay);
                } else {
                  console.error(`Alle Versuche für ${fileName} fehlgeschlagen.`);
                  failedDownloads++;
                  resolve(); // Trotzdem auflösen, damit andere Dateien verarbeitet werden können
                }
              });
          }
          
          attemptDownload();
        });
      });
      
      // Warten bis alle Downloads abgeschlossen sind
      Promise.all(downloadPromises)
        .then(function() {
          // ZIP erstellen und herunterladen
          console.log(`Alle Downloads abgeschlossen. Erstelle ZIP-Datei mit ${completedDownloads} Dateien.`);
          showMessage("ZIP-Datei wird erstellt...");
          return zip.generateAsync({ type: "blob" });
        })
        .then(function(content) {
          // Aktuelles Datum für Dateinamen
          const date = new Date();
          const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          
          // Lehrer-Code in Dateinamen einfügen für Lehrer-Admin
          let zipFileName = `podcast-aufnahmen-${dateStr}.zip`;
          if (appSettings.adminType === 'teacher' && appSettings.selectedTeacherCode) {
            zipFileName = `podcast-aufnahmen-${appSettings.selectedTeacherCode}-${dateStr}.zip`;
          }
          
          console.log(`ZIP-Datei erstellt. Größe: ${formatBytes(content.size)}. Name: ${zipFileName}`);
          
          try {
            saveAs(content, zipFileName);
            console.log("ZIP-Datei-Download gestartet.");
            
            if (failedDownloads > 0) {
              showWarning(`ZIP-Datei erstellt mit ${completedDownloads} Dateien. ${failedDownloads} Dateien konnten nicht geladen werden.`);
            } else {
              showSuccess("ZIP-Datei wurde erstellt und heruntergeladen.");
            }
          } catch (saveError) {
            console.error("Fehler beim Speichern der ZIP-Datei:", saveError);
            showError("Fehler beim Speichern der ZIP-Datei: " + saveError.message);
          }
        })
        .catch(function(zipError) {
          console.error("Fehler beim Erstellen der ZIP-Datei:", zipError);
          showError("Fehler beim ZIP-Erstellen: " + zipError.message);
        });
    })
    .catch(function(err) {
      console.error("Fehler beim Auflisten der Dateien:", err);
      showError("Fehler beim ZIP-Erstellen: " + err.message);
    });
}

// --- 17) Timer Funktionen ---
function startTimer() {
  recordingTime = 0;
  updateTimerDisplay(0);
  recordingInterval = setInterval(function() {
    recordingTime++;
    updateTimerDisplay(recordingTime);
  }, 1000);
}

function stopTimer() {
  if (recordingInterval) {
    clearInterval(recordingInterval);
    recordingInterval = null;
  }
}

function updateTimerDisplay(seconds) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  timerDisplay.textContent = `${mm}:${ss}`;
}

// --- 18) UI-Hilfsfunktionen ---
function updateRecordingUI(isActive) {
  // Aufnahme aktiv
  if (isActive) {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    recordingStatus.innerHTML = 'Aufnahme läuft...';
  } 
  // Aufnahme inaktiv
  else {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    recordingStatus.innerHTML = '';
  }
  
  // Immer dateiname prüfen
  validateFileName();
}

function showMessage(message, isRecording) {
  uploadStatus.textContent = message;
}

function showError(message) {
  uploadStatus.innerHTML = `<span class="error-message">❌ ${message}</span>`;
  console.error(message);
}

function showWarning(message) {
  uploadStatus.innerHTML = `<span style="color: #FF9800;">⚠️ ${message}</span>`;
  console.warn(message);
}

function showSuccess(message) {
  uploadStatus.innerHTML = `<span class="success-message">${message}</span>`;
}

// --- 19) Lokale Speicherung ---
function saveRecording(blob, mimeType) {
  try {
    // In localStorage speichern
    localStorage.setItem('lastRecordingMimeType', mimeType);
    
    // Blob als Base64 speichern
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = function() {
      const base64data = reader.result;
      localStorage.setItem('lastRecordingData', base64data);
    };
  } catch (err) {
    console.warn("Konnte Aufnahme nicht lokal speichern:", err);
  }
}

function saveRecordingChunks() {
  // In dieser Version nicht mehr verwendet, da wir die Blob-Zwischenspeicherung verbessert haben
}

function clearSavedRecording() {
  localStorage.removeItem('lastRecordingData');
  localStorage.removeItem('lastRecordingMimeType');
  localStorage.removeItem('recordingInProgress');
}

function checkForSavedRecording() {
  const savedRecording = localStorage.getItem('lastRecordingData');
  const savedMimeType = localStorage.getItem('lastRecordingMimeType');
  
  if (savedRecording && savedMimeType) {
    // Vorherige Aufnahme wiederherstellen
    try {
      // Base64 in Blob umwandeln
      const byteString = atob(savedRecording.split(',')[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      
      currentRecordingBlob = new Blob([ab], { type: savedMimeType });
      const audioUrl = URL.createObjectURL(currentRecordingBlob);
      audioPlayer.src = audioUrl;
      
      // UI aktualisieren
      uploadBtn.disabled = false;
      showMessage("Gespeicherte Aufnahme geladen. Sie können sie hochladen oder eine neue erstellen.");
    } catch (err) {
      console.warn("Fehler beim Laden der gespeicherten Aufnahme:", err);
      clearSavedRecording();
    }
  }
}

// --- 20) Hilfsfunktionen ---
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Seite initialisieren, wenn das DOM geladen ist
document.addEventListener('DOMContentLoaded', init);
