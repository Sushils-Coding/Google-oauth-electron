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

  openAuthUrl: () => ipcRenderer.invoke("open-auth-url"),
});
