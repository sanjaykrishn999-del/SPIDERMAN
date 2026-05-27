require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fileUpload = require('express-fileupload');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const BotManager = require('./bot-manager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([{username:'veera', password:'veera@0806', role:'admin'}]));

const sessionMiddleware = session({
    secret: 'dark-empire-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
});

app.use(sessionMiddleware);
app.use(express.json());
app.use(fileUpload({ createParentPath: true }));

io.use((socket, next) => sessionMiddleware(socket.request, {}, next));

const checkAuth = (req, res, next) => {
    if (req.session && req.session.user) next();
    else res.redirect('/login.html');
};

const checkAdmin = (req, res, next) => {
    if (req.session && req.session.role === 'admin') next();
    else res.status(403).json({ success: false, message: 'Admin only' });
};

// Auth APIs
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const user = users.find(u => u.username === username && u.password === password);
    
    if (user) {
        req.session.user = username;
        req.session.role = user.role || 'user';
        res.json({ success: true, role: req.session.role });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login.html');
});

app.get('/api/me', checkAuth, (req, res) => {
    res.json({ username: req.session.user, role: req.session.role });
});

// User Management APIs (Admin Only)
app.get('/api/users', checkAuth, checkAdmin, (req, res) => {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    // Don't send passwords back
    res.json(users.map(u => ({ username: u.username, role: u.role })));
});

app.post('/api/users', checkAuth, checkAdmin, (req, res) => {
    const { username, password, role } = req.body;
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    if (users.find(u => u.username === username)) return res.status(400).send('Exists');
    
    users.push({ username, password, role: role || 'user' });
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    res.json({ success: true });
});

app.delete('/api/users/:username', checkAuth, checkAdmin, (req, res) => {
    const username = req.params.username;
    if (username === 'admin') return res.status(400).send('Cannot delete master admin');
    
    let users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    users = users.filter(u => u.username !== username);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    res.json({ success: true });
});

// Audio Library APIs (Protected)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

app.get('/api/audio', checkAuth, (req, res) => {
    const files = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.mp3'));
    res.json(files);
});

app.post('/api/upload', checkAuth, (req, res) => {
    if (!req.files || !req.files.audio) return res.status(400).send('No file received');
    const audioFile = req.files.audio;
    audioFile.mv(path.join(uploadsDir, audioFile.name), (err) => {
        if (err) return res.status(500).send(err);
        res.send('Uploaded');
    });
});

app.delete('/api/audio/:file', checkAuth, (req, res) => {
    const fileName = req.params.file;
    if (!fileName.endsWith('.mp3') || fileName.includes('..')) return res.status(400).send('Invalid file');
    const filePath = path.join(uploadsDir, fileName);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.send('Deleted');
    } else {
        res.status(404).send('Not found');
    }
});

// Protected routes
app.get('/', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use('/login.html', express.static(path.join(__dirname, 'public', 'login.html')));
app.use('/login.css', express.static(path.join(__dirname, 'public', 'login.css')));
app.use('/login.js', express.static(path.join(__dirname, 'public', 'login.js')));
app.use(checkAuth, express.static(path.join(__dirname, 'public')));

// Bot logic
const botManager = new BotManager(io);
const originalLog = console.log;
console.log = (...args) => {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
    io.emit('log', { type: 'info', message: `[${new Date().toLocaleTimeString()}] ${msg}` });
    originalLog.apply(console, args);
};

io.on('connection', (socket) => {
    const user = socket.request.session.user;
    if (!user) return socket.disconnect();
    botManager.broadcastStatus();
    socket.on('joinVC', (id) => botManager.joinVC(id));
    socket.on('disconnectAll', () => botManager.disconnectAll());
    socket.on('play', (file) => botManager.playAll(file));
    socket.on('seek', (seconds) => botManager.seek(seconds));
    socket.on('stop', () => botManager.stopAll());
    socket.on('updateConfig', (cfg) => botManager.updateConfig(cfg));
});

server.listen(PORT, async () => {
    console.log(`[Dashboard] Server running at http://localhost:${PORT}`);
    try {
        await botManager.init();
    } catch (err) {
        console.error('[System] Bot initialization failed:', err);
    }
});
