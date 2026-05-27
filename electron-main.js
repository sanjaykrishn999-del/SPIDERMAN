const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow;
let serverProcess;

function createWindow() {
    console.log('[App] Starting background server...');
    
    // Start the Express server
    serverProcess = fork(path.join(__dirname, 'server.js'), [], {
        env: { ...process.env, PORT: 3000 },
        stdio: 'inherit'
    });

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        title: "DARK EMPIRE | Bot Dashboard",
        autoHideMenuBar: true,
        backgroundColor: '#0a0b10', // Match your dashboard bg
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Handle server ready check
    const checkServer = async () => {
        try {
            console.log('[App] Checking if server is ready...');
            await mainWindow.loadURL('http://localhost:3000');
            console.log('[App] Dashboard loaded successfully!');
        } catch (err) {
            console.log('[App] Server not ready yet, retrying...');
            setTimeout(checkServer, 2000);
        }
    };

    // Start checking
    checkServer();

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (serverProcess) serverProcess.kill();
    });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('quit', () => {
    if (serverProcess) serverProcess.kill();
});
