const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
// Increased buffer size to handle your image uploads (5MB limit)
const io = new Server(server, { maxHttpBufferSize: 5e6 }); 

app.use(express.static(path.join(__dirname, 'public')));

// --- CENTRAL DATABASE ---
let db = {
    players: [
        { id: 1001, user: 'ashleychan', pass: 'snt_ash1', credits: 1250, crystals: 50, status: 'Active', inventory: [], dailyStreak: 4, lastClaimed: 0 },
        { id: 1002, user: 'CryptoKing', pass: 'btc_moon', credits: 50000, crystals: 1200, status: 'Active', inventory: [], dailyStreak: 6, lastClaimed: 0 },
        { id: 1003, user: 'Ghost_User', pass: 'ghost123', credits: 0, crystals: 0, status: 'Offline', inventory: [], dailyStreak: 1, lastClaimed: 0 },
        { id: 1005, user: 'Cheater_X', pass: 'hack', credits: 999999, crystals: 9999, status: 'Banned', inventory: [], dailyStreak: 0, lastClaimed: 0 }
    ],
    storeItems: [
        { id: 1, img: 'https://placehold.co/100x100/purple/white?text=Potion', name: 'Health Potion', price: 50, stock: 999, status: 'Available', soldAt: null }
    ],
    auctions: [
        { id: 1, img: 'https://placehold.co/100x100/blue/white?text=Shield', item: 'Void Shield', bid: 1200, bidder: 'ashleychan', status: 'Active', endTime: Date.now() + 3600000, endedAt: null }
    ],
    announcements: [],
    giftBatches: [], // { id, type, prefix, amount, total, redeemedCount, codes: [] }
    logs: []
};

// --- HELPERS ---
function syncAll() {
    io.emit('sync:full_data', db);
}
function addLog(msg) {
    db.logs.unshift({ time: Date.now(), msg: msg });
    if(db.logs.length > 50) db.logs.pop();
    syncAll();
}

io.on('connection', (socket) => {
    // Send full state on connect
    socket.emit('sync:full_data', db);

    // --- PLAYER EVENTS ---
    socket.on('player:login', (username) => {
        const user = db.players.find(p => p.user === username);
        if(user) socket.emit('player:login_success', user);
    });

    socket.on('player:buy_item', ({ userId, itemId }) => {
        const p = db.players.find(x => x.id === userId);
        const item = db.storeItems.find(x => x.id === itemId);
        if (p && item && item.stock > 0 && p.credits >= item.price) {
            p.credits -= parseInt(item.price);
            item.stock--;
            if (item.stock === 0) { item.status = 'Sold Out'; item.soldAt = Date.now(); }
            
            p.inventory.push({ id: Date.now(), name: item.name, img: item.img, type: 'Store Purchase' });
            addLog(`${p.user} bought ${item.name}`);
            syncAll();
        }
    });

    socket.on('player:place_bid', ({ userId, aucId, bid }) => {
        const p = db.players.find(x => x.id === userId);
        const auc = db.auctions.find(x => x.id === aucId);
        if (p && auc && auc.status === 'Active' && p.credits >= bid && bid > auc.bid) {
            // Refund previous bidder (Simple logic: just credit them back)
            if(auc.bidder) {
                const prev = db.players.find(x => x.user === auc.bidder);
                if(prev) prev.credits += parseInt(auc.bid);
            }
            
            p.credits -= parseInt(bid);
            auc.bid = parseInt(bid);
            auc.bidder = p.user;
            addLog(`${p.user} bid ${bid} on ${auc.item}`);
            syncAll();
        }
    });

    socket.on('player:claim_daily', ({ userId, amount }) => {
        const p = db.players.find(x => x.id === userId);
        // Simple 24h check could go here, for now allowing claim for demo
        if(p) {
            p.credits += parseInt(amount);
            p.lastClaimed = Date.now();
            p.dailyStreak++;
            addLog(`${p.user} claimed Daily Reward (${amount})`);
            syncAll();
        }
    });

    // --- ADMIN EVENTS ---
    socket.on('admin:update_player', (data) => {
        const idx = db.players.findIndex(x => x.id === data.id);
        if(idx !== -1) {
            db.players[idx] = { ...db.players[idx], ...data };
            addLog(`Admin updated player ${db.players[idx].user}`);
            syncAll();
        }
    });

    socket.on('admin:add_item', (item) => {
        db.storeItems.unshift(item);
        addLog(`Added Store Item: ${item.name}`);
        syncAll();
    });

    socket.on('admin:create_auction', (auc) => {
        db.auctions.unshift(auc);
        addLog(`Started Auction: ${auc.item}`);
        syncAll();
    });

    socket.on('admin:post_announcement', (post) => {
        db.announcements.unshift(post);
        addLog(`Posted Announcement: ${post.title}`);
        syncAll();
    });

    socket.on('admin:generate_codes', (batch) => {
        // Generate codes server-side for security
        let codes = [];
        for(let i=0; i<batch.total; i++) {
            let suffix = Math.random().toString(36).substring(2,6).toUpperCase();
            codes.push({ code: batch.prefix + suffix, redeemed: false, user: null });
        }
        batch.codes = codes;
        batch.redeemedCount = 0;
        
        db.giftBatches.unshift(batch);
        addLog(`Generated Batch ${batch.id} (${batch.total} codes)`);
        syncAll();
    });
    
    // Admin Actions on items
    socket.on('admin:delete_item', (id) => { db.storeItems = db.storeItems.filter(i => i.id !== id); syncAll(); });
    socket.on('admin:mark_sold', (id) => { 
        let i = db.storeItems.find(x => x.id === id); 
        if(i) { i.stock = 0; i.status='Sold Out'; i.soldAt = Date.now(); syncAll(); } 
    });
    socket.on('admin:cancel_auction', (id) => {
        let a = db.auctions.find(x => x.id === id);
        if(a) { a.status = 'Cancelled'; syncAll(); }
    });
});

// Auction Timer Check (Every minute)
setInterval(() => {
    let changed = false;
    const now = Date.now();
    db.auctions.forEach(a => {
        if(a.status === 'Active' && now >= a.endTime) {
            a.status = 'Ended';
            a.endedAt = now;
            // Transfer item to winner
            if(a.bidder) {
                const winner = db.players.find(p => p.user === a.bidder);
                if(winner) winner.inventory.push({ id: now, name: a.item, img: a.img, type: 'Auction Win' });
            }
            changed = true;
        }
    });
    if(changed) syncAll();
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
