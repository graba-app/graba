// Puente entre la interfaz web (ui/) y el proceso principal. La interfaz llama window.grabaEscritorio.enviar(msg)
// (igual que webkit.messageHandlers.graba en Mac); el principal responde ejecutando window.Graba.<función>(json).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("GRABA_HOST", process.platform === "win32" ? "windows" : "linux");
contextBridge.exposeInMainWorld("grabaEscritorio", {
  enviar: (msg) => ipcRenderer.send("graba", JSON.parse(JSON.stringify(msg))),
});
