const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getRefreshToken: async () => {
    const res = await fetch("http://localhost:8080/get-refresh-token");
    return res.json();
  },
  openAuthUrl: () => ipcRenderer.invoke("open-auth-url")
});
