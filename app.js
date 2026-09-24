// --- 1. IndexedDB Initialization ---
const DB_NAME = 'SecurityCamDB';
const DB_VERSION = 1;
let db;

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const store = e.target.result.createObjectStore('recordings', { keyPath: 'id', autoIncrement: true });
      store.createIndex('timestamp', 'timestamp', { unique: false });
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

// --- 2. Save Segment & FIFO Storage Maintenance ---
async function saveChunk(blob) {
  const transaction = db.transaction(['recordings'], 'readwrite');
  const store = transaction.objectStore('recordings');
  
  const record = {
    timestamp: Date.now(),
    data: blob,
    size: blob.size
  };
  store.add(record);

  // Check storage quota and purge oldest if exceeding target threshold (~10 GB or 80% quota)
  if (navigator.storage && navigator.storage.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    const maxAllocated = 10 * 1024 * 1024 * 1024; // 10 GB limit target
    
    if (usage > maxAllocated || usage > quota * 0.8) {
      purgeOldestSegments();
    }
  }
}

function purgeOldestSegments() {
  const transaction = db.transaction(['recordings'], 'readwrite');
  const store = transaction.objectStore('recordings');
  const index = store.index('timestamp');
  
  // Get oldest record
  const cursorReq = index.openCursor(null, 'next');
  cursorReq.onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      store.delete(cursor.primaryKey); // Delete oldest entry
    }
  };
}

// --- 3. Camera & Recording Loop ---
let mediaRecorder;

async function startCamera() {
  await initDB();
  
  // Request Persistent Storage
  if (navigator.storage && navigator.storage.persist) {
    await navigator.storage.persist();
  }

  // Request Screen Wake Lock (Keeps display active)
  if ('wakeLock' in navigator) {
    try {
      await navigator.wakeLock.request('screen');
    } catch (err) {
      console.warn('Wake Lock error:', err);
    }
  }

  // Set Media Constraints
  const constraints = {
    video: {
      facingMode: 'environment',
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { max: 15 } // Lower framerate saves disk space
    },
    audio: false
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  document.getElementById('preview').srcObject = stream;

  // Determine standard supported MIME type across Android/iOS
  const mimeType = MediaRecorder.isTypeSupported('video/mp4') 
    ? 'video/mp4' 
    : 'video/webm;codecs=vp8';

  mediaRecorder = new MediaRecorder(stream, {
    mimeType: mimeType,
    videoBitsPerSecond: 1500000 // 1.5 Mbps bitrate
  });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      saveChunk(e.data);
    }
  };

  // Capture video in 60-second chunks
  mediaRecorder.start(60000); 
}

// Register SW
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

document.getElementById('startBtn').addEventListener('click', startCamera);
