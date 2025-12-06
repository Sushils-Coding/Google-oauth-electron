const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 600,
    height: 400,
    webPreferences: {
      preload: path.join(__dirname, "renderer.js")
    }
  });

  win.loadFile("index.html");
}

app.whenReady().then(createWindow);

// Receive request to open Google Login URL
ipcMain.handle("open-auth-url", async (event) => {
  const axios = require("axios");
  const response = await axios.get("http://localhost:8080/auth-url");

  shell.openExternal(response.data.url); // open Google login page
});
