const socket = io();

// State
let botData = [];
let audioFiles = [];
let config = {};

// Elements
const botGrid = document.getElementById('bot-grid');
const audioList = document.getElementById('audio-list');
const logConsole = document.getElementById('log-console');
const cpuBar = document.getElementById('cpu-bar');
const memBar = document.getElementById('mem-bar');
const botCount = document.getElementById('bot-count');
const globalStatus = document.getElementById('global-status');

// Tab Switching
document.querySelectorAll('.nav-links li').forEach(li => {
    li.addEventListener('click', () => {
        const tab = li.getAttribute('data-tab');
        document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        li.classList.add('active');
        document.getElementById(`tab-${tab}`).classList.add('active');
    });
});

// Bot Status
// Playback Bar Logic
document.getElementById('forward-btn').addEventListener('click', () => {
    socket.emit('seek', 15);
});

document.getElementById('rewind-btn').addEventListener('click', () => {
    socket.emit('seek', -15);
});

document.getElementById('stop-all-btn').addEventListener('click', () => {
    socket.emit('stop');
});

// Update Track Name
socket.on('botStatus', (data) => {
    const trackName = data.config.currentAudio || 'No Audio Playing';
    document.getElementById('current-track-name').innerText = trackName;
    
    botData = data.bots;
    config = data.config;
    
    updateBotGrid();
    updateConfigUI();
    updateStats(data.usage);
    
    const onlineCount = botData.filter(b => b.isOnline).length;
    botCount.innerText = `(${onlineCount}/${botData.length})`;
    
    if (onlineCount > 0) {
        globalStatus.innerText = 'ONLINE';
        globalStatus.className = 'status-badge online';
    }
});

function updateBotGrid() {
    botGrid.innerHTML = botData.map(bot => `
        <div class="bot-card">
            <div class="bot-header">
                <span class="bot-id">#${bot.id + 1}</span>
                <span class="status-badge ${bot.isOnline ? 'online' : 'offline'}">${bot.isOnline ? 'ACTIVE' : 'OFFLINE'}</span>
            </div>
            <div class="bot-name">${bot.tag}</div>
            <div class="bot-meta">
                <p><i class="fas ${bot.isJoined ? 'fa-link' : 'fa-link-slash'}"></i> ${bot.isJoined ? 'Connected to VC' : 'Idle'}</p>
                <p><i class="fas fa-play"></i> ${bot.status}</p>
            </div>
        </div>
    `).join('');
}

function updateStats(usage) {
    // Simple math for visualization
    const cpuVal = Math.min(100, Math.floor((usage.cpu.user / 1000000) * 10));
    const memVal = Math.min(100, Math.floor((usage.mem.rss / (1024 * 1024 * 512)) * 100)); // 512MB reference
    
    cpuBar.style.width = `${cpuVal}%`;
    memBar.style.width = `${memVal}%`;
}

// Config Controls
function updateConfigUI() {
    document.getElementById('range-vol').value = config.volume;
    document.getElementById('vol-val').innerText = `${config.volume}%`;
    
    document.getElementById('range-bass').value = config.bass;
    document.getElementById('bass-val').innerText = `${config.bass}dB`;
    
    document.getElementById('range-speed').value = config.speed;
    document.getElementById('speed-val').innerText = `${config.speed}x`;
    
    const loopBtn = document.getElementById('toggle-loop');
    if (config.loop) loopBtn.classList.add('on');
    else loopBtn.classList.remove('on');
}

// Event Listeners for Controls
['vol', 'bass', 'speed'].forEach(id => {
    const el = document.getElementById(`range-${id}`);
    el.addEventListener('change', () => {
        const val = id === 'speed' ? parseFloat(el.value) : parseInt(el.value);
        config[id === 'vol' ? 'volume' : id] = val;
        socket.emit('updateConfig', config);
        showToast(`Updated ${id}: ${val}`);
    });
    el.addEventListener('input', () => {
        document.getElementById(`${id}-val`).innerText = `${el.value}${id === 'speed' ? 'x' : id === 'vol' ? '%' : 'dB'}`;
    });
});

document.getElementById('toggle-loop').addEventListener('click', () => {
    config.loop = !config.loop;
    socket.emit('updateConfig', config);
    showToast(`Loop ${config.loop ? 'Enabled' : 'Disabled'}`);
});

// VC Join/Leave
document.getElementById('join-btn').addEventListener('click', () => {
    const vcId = document.getElementById('vc-input').value.trim();
    if (vcId) {
        socket.emit('joinVC', vcId);
        showToast(`Ordering bots to join ${vcId}...`);
    }
});

document.getElementById('leave-btn').addEventListener('click', () => {
    socket.emit('disconnectAll');
    showToast('Disconnecting all bots');
});

// Audio Library
async function loadAudio() {
    const res = await fetch('/api/audio');
    audioFiles = await res.json();
    audioList.innerHTML = audioFiles.map(file => `
        <div class="audio-item">
            <div class="audio-info">
                <i class="fas fa-file-audio"></i>
                <span>${file}</span>
            </div>
            <div class="audio-actions">
                <button class="btn-primary btn-small" onclick="playAudio('${file}')">
                    <i class="fas fa-play"></i> PLAY ALL
                </button>
                <button class="btn-danger btn-small" onclick="deleteAudio('${file}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

window.playAudio = (file) => {
    socket.emit('play', file);
    showToast(`Playing: ${file}`);
};

window.deleteAudio = async (file) => {
    if (confirm(`Delete ${file}?`)) {
        await fetch(`/api/audio/${file}`, { method: 'DELETE' });
        loadAudio();
        showToast('File deleted');
    }
};

// Upload
document.getElementById('audio-upload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('audio', file);

    showToast('Uploading audio...');
    await fetch('/api/upload', {
        method: 'POST',
        body: formData
    });
    
    loadAudio();
    showToast('Upload complete!');
});

// Logs
socket.on('log', (data) => {
    const span = document.createElement('div');
    span.className = data.type;
    span.innerText = data.message;
    logConsole.appendChild(span);
    logConsole.scrollTop = logConsole.scrollHeight;
});

document.getElementById('clear-logs').addEventListener('click', () => {
    logConsole.innerHTML = '';
});

// Toast
function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

// Auth & User Management
async function checkRole() {
    const res = await fetch('/api/me');
    const user = await res.json();
    
    if (user.role === 'admin') {
        document.getElementById('tab-link-users').style.display = 'flex';
        loadUsers();
    }
}

async function loadUsers() {
    const res = await fetch('/api/users');
    const users = await res.json();
    const list = document.getElementById('user-list');
    
    list.innerHTML = users.map(u => `
        <div class="audio-item">
            <div class="audio-info">
                <i class="fas fa-user-shield"></i>
                <span>${u.username} (${u.role})</span>
            </div>
            <div class="audio-actions">
                ${u.username !== 'admin' ? `
                    <button class="btn-danger btn-small" onclick="deleteUser('${u.username}')">
                        <i class="fas fa-user-minus"></i>
                    </button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

document.getElementById('add-user-btn').addEventListener('click', async () => {
    const username = document.getElementById('new-username').value;
    const password = document.getElementById('new-password').value;
    
    if (!username || !password) return showToast('Please fill all fields');
    
    const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role: 'user' })
    });
    
    if (res.ok) {
        showToast(`User ${username} added!`);
        document.getElementById('new-username').value = '';
        document.getElementById('new-password').value = '';
        loadUsers();
    } else {
        showToast('Error adding user');
    }
});

window.deleteUser = async (username) => {
    if (confirm(`Remove user ${username}?`)) {
        await fetch(`/api/users/${username}`, { method: 'DELETE' });
        loadUsers();
        showToast('User removed');
    }
};

// Init
loadAudio();
checkRole();
setInterval(loadAudio, 10000);
