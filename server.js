const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// --- CENTRAL DATABASE ---
// All your features are stored here so they sync across devices.
let db = {
    players: [
        { id: 1001, user: 'ashleychan', pass: 'snt_ash1', credits: 1250, crystals: 50, status: 'Active' },
        { id: 1002, user: 'CryptoKing', pass: 'btc_moon', credits: 50000, crystals: 1200, status: 'Active' },
        { id: 1003, user: 'Ghost_User', pass: 'ghost123', credits: 0, crystals: 0, status: 'Offline' }
    ],
    storeItems: [
        { id: 1, img: 'https://placehold.co/100x100/purple/white?text=Potion', name: 'Health Potion', price: 50, stock: 999, status: 'Available', soldAt: null }
    ],
    auctions: [
        { id: 1, img: 'https://placehold.co/100x100/blue/white?text=Shield', item: 'Void Shield', bid: 1200, bidder: 'ashleychan', status: 'Active', endTime: Date.now() + 3600000, endedAt: null }
    ],
    announcements: [],
    giftBatches: [],
    logs: []
};

function broadcast(event, data) {
    io.emit(event, data);
}

function addLog(msg) {
    db.logs.unshift({ time: Date.now(), msg: msg });
    if (db.logs.length > 50) db.logs.pop(); // Keep log size manageable
    broadcast('sync:logs', db.logs);
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Send FULL database on connection
    socket.emit('init_data', db);

    // --- PLAYER ACTIONS ---
    
    // Login
    socket.on('player:login', (username) => {
        const user = db.players.find(p => p.user === username);
        if(user) socket.emit('player:login_success', user);
    });

    // Buy Item
    socket.on('player:buy_item', ({ userId, itemId }) => {
        const player = db.players.find(p => p.id === userId);
        const item = db.storeItems.find(i => i.id === itemId);

        if (player && item && item.stock > 0 && player.credits >= item.price) {
            player.credits -= item.price;
            item.stock--;
            if(item.stock === 0) { item.status = 'Sold Out'; item.soldAt = Date.now(); }
            
            addLog(`Player ${player.user} bought ${item.name}`);
            broadcast('sync:players', db.players);
            broadcast('sync:store', db.storeItems);
        }
    });

    // Bid on Auction
    socket.on('player:place_bid', ({ userId, auctionId, bidAmount }) => {
        const player = db.players.find(p => p.id === userId);
        const auc = db.auctions.find(a => a.id === auctionId);

        if (player && auc && auc.status === 'Active' && player.credits >= bidAmount && bidAmount > auc.bid) {
            player.credits -= bidAmount; // Deduct immediately (simplified logic)
            // Refund previous bidder logic would go here in a real app
            
            auc.bid = bidAmount;
            auc.bidder = player.user;
            
            addLog(`${player.user} bid ${bidAmount} on ${auc.item}`);
            broadcast('sync:players', db.players);
            broadcast('sync:auctions', db.auctions);
        }
    });

    // Claim Daily Reward
    socket.on('player:claim_reward', ({ userId, amount }) => {
        const player = db.players.find(p => p.id === userId);
        if (player) {
            player.credits += amount;
            addLog(`${player.user} claimed Daily Reward (${amount})`);
            broadcast('sync:players', db.players);
        }
    });

    // --- ADMIN ACTIONS ---

    // Update Player
    socket.on('admin:update_player', (updatedPlayer) => {
        const idx = db.players.findIndex(p => p.id === updatedPlayer.id);
        if (idx !== -1) {
            db.players[idx] = updatedPlayer;
            addLog(`Admin updated player ${updatedPlayer.user}`);
            broadcast('sync:players', db.players);
        }
    });

    // Add Store Item
    socket.on('admin:add_item', (item) => {
        db.storeItems.unshift(item);
        broadcast('sync:store', db.storeItems);
    });

    // Create Auction
    socket.on('admin:create_auction', (auc) => {
        db.auctions.unshift(auc);
        broadcast('sync:auctions', db.auctions);
    });

    // Post Announcement
    socket.on('admin:post_announcement', (post) => {
        db.announcements.unshift(post);
        broadcast('sync:announcements', db.announcements);
    });

    // Generate Giftcodes
    socket.on('admin:generate_codes', (batch) => {
        db.giftBatches.unshift(batch);
        addLog(`Generated batch ${batch.id}`);
        broadcast('sync:giftcodes', db.giftBatches);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
