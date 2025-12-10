const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  startTokenWatcher: (callback) => {
    setInterval(async () => {
      const res = await fetch("http://localhost:8080/get-latest-tokens");
      const data = await res.json();

      if (data.accessToken) {
        callback(data);
      }
    }, 1000);
  },

  // Save token + user info to IndexedDB
  saveToIndexedDB: async (record) => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("OAuthDB", 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("tokens", { keyPath: "id" });
      };

      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("tokens", "readwrite");
        const store = tx.objectStore("tokens");

        store.put(record);

        tx.oncomplete = () => resolve(true);
      };

      request.onerror = () => reject(request.error);
    });
  },

  openAuthUrl: () => ipcRenderer.invoke("open-auth-url"),
});
