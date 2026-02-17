const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// --- DATABASE (In-Memory) ---
let db = {
    // Default Players
    players: [
        { id: 1001, user: 'ashleychan', pass: 'snt_ash1', credits: 1250, crystals: 50, status: 'Active' },
        { id: 1002, user: 'CryptoKing', pass: 'btc_moon', credits: 50000, crystals: 1200, status: 'Active' },
        { id: 1003, user: 'Ghost_User', pass: 'ghost123', credits: 0, crystals: 0, status: 'Offline' },
        { id: 1005, user: 'Cheater_X', pass: 'hack', credits: 999999, crystals: 9999, status: 'Banned' }
    ],
    announcements: [],
    storeItems: [
        { id: 1, img: 'https://placehold.co/100x100/purple/white?text=Potion', name: 'Health Potion', price: 50, stock: 999, status: 'Available', soldAt: null }
    ],
    auctions: [
        { id: 1, img: 'https://placehold.co/100x100/blue/white?text=Shield', item: 'Void Shield', bid: 1200, bidder: 'ashleychan', status: 'Active', endTime: Date.now() + 3600000, endedAt: null }
    ],
    logs: []
};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // 1. Send Sync Data to new connection
    socket.emit('init_data', db);

    // --- PLAYER EVENTS ---
    
    // Simulating a login
    socket.on('player:login', (username) => {
        const user = db.players.find(p => p.user === username);
        if (user) {
            socket.emit('player:login_success', user);
        }
    });

    // Player claims daily reward
    socket.on('player:claim_reward', (data) => {
        const player = db.players.find(p => p.user === data.username);
        if (player) {
            player.credits += parseInt(data.amount);
            io.emit('sync:player_update', db.players); // Update Admin & Player
            
            // Log it
            const logMsg = `Player ${player.user} claimed Daily Reward (${data.amount})`;
            db.logs.unshift({ time: Date.now(), msg: logMsg });
            io.emit('sync:logs', db.logs);
        }
    });

    // --- ADMIN EVENTS ---

    // Update Player Stats
    socket.on('admin:update_player', (updatedPlayer) => {
        const index = db.players.findIndex(p => p.id === updatedPlayer.id);
        if (index !== -1) {
            db.players[index] = updatedPlayer;
            io.emit('sync:player_update', db.players);
            
            // Log it
            const logMsg = `Admin updated player ${updatedPlayer.user}`;
            db.logs.unshift({ time: Date.now(), msg: logMsg });
            io.emit('sync:logs', db.logs);
        }
    });

    // Post Announcement
    socket.on('admin:post_announcement', (post) => {
        db.announcements.unshift(post);
        io.emit('sync:announcements', db.announcements);
    });

    // Add Store Item
    socket.on('admin:add_item', (item) => {
        db.storeItems.unshift(item);
        io.emit('sync:store', db.storeItems);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});