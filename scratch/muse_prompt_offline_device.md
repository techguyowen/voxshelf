# VocalFlow - On-Device PWA Offline Storage & Download System

Implement full on-device offline storage for mobile PWAs, tablets, and desktop browsers so users can download books and audio directly to their device and read/listen 100% offline without connecting to the server.

### 1. Client Offline Storage Engine: `src/lib/offlineStore.ts`
- Implement an IndexedDB + CacheStorage client module:
  - IndexedDB database `vocalflow_offline_v1`:
    - Store `documents` (stores full DocumentDetail, sentences, bookmarks, highlights, totalBytes, downloadedAt).
  - CacheStorage `vocalflow-offline-audio-v1`:
    - Stores the raw audio Response for `/api/audio/[hash]` so `<audio src="/api/audio/[hash]">` plays directly from the browser cache with 0ms network latency.
  - Export functions:
    - `saveDocumentToDevice(doc: DocumentDetail, onProgress: (done: number, total: number, bytes: number) => void): Promise<void>`:
      - Ensures all sentences have audio (synthesizes any missing ones via `/api/tts`).
      - Downloads and puts each audio URL into CacheStorage `vocalflow-offline-audio-v1`.
      - Saves the full document object in IndexedDB.
    - `removeDocumentFromDevice(docId: string): Promise<void>`:
      - Deletes cached audio files from CacheStorage and removes entry from IndexedDB.
    - `isDocumentOnDevice(docId: string): Promise<{ onDevice: boolean, bytes: number, downloadedAt?: string }>`
    - `getOfflineDocument(docId: string): Promise<DocumentDetail | null>`
    - `listOfflineDocuments(): Promise<Array<{ id: string, title: string, author?: string, wordCount: number, sentenceCount: number, bytes: number, downloadedAt: string }>>`
    - `getDeviceStorageEstimate(): Promise<{ usageBytes: number, quotaBytes: number, documentCount: number }>`
    - `clearAllDeviceStorage(): Promise<void>`

### 2. Service Worker for PWA Offline Asset Support: `public/sw.js` & Registration
- Create `public/sw.js`:
  - Cache-first strategy for `/api/audio/*` from `vocalflow-offline-audio-v1`.
  - Stale-while-revalidate for static assets.
  - Fallback offline page handling when server is unreachable.
- Register service worker in `src/components/AppShell.tsx` (or `src/app/layout.tsx`).

### 3. Audio Player Integration: `src/hooks/usePlayer.ts`
- In `ensureAudio(idx)`:
  - Check browser `caches.match(url)` or IndexedDB first.
  - If cached on device, return the local URL immediately with 0ms network latency and no server connection required!

### 4. UI: Download to Device Modal & Reader Integration
- Create `src/components/DownloadToDeviceModal.tsx`:
  - Shows download progress: `Downloading to device: 42 / 120 clips (5.2 MB)`.
  - Shows estimated storage size on device.
  - Cancel / Pause download.
  - Success message: "📱 Saved on device! Ready for offline listening."
- In `ReaderView.tsx`:
  - Add a **"📱 Download"** / **"📱 Saved"** button in the reader toolbar.
  - If server is unreachable / offline, automatically load document from `getOfflineDocument(docId)`.
  - Show a green **"📱 Offline Ready"** badge when saved on device.
- In `Library.tsx`:
  - Add a **"📱 On Device"** filter tab showing books stored locally on this phone/laptop.
  - On document cards: show **"📱 Download to Device"** or **"📱 On Device (14 MB)"** badge with 1-click download/delete from device.
- In `SettingsModal.tsx`:
  - Add **"📱 Device Storage (PWA Offline)"** section showing total storage used on this device with a **"Clear Device Storage"** button.

### Verification:
- Run `npm run typecheck` and `npm run build` to verify 0 errors.
- Test offline document save/remove on port 38492.
