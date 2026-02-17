const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 }); // 100MB limit for images

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// --- DATABASE ---
let db = {
    players: [
        { id: 1001, user: 'tussday', pass: 'admin123', credits: 164999288974, crystals: 100000000, status: 'Active', inventory: [], dailyStreak: 4, claimedToday: false, badges: ['STAFF', 'MILLIONAIRE', 'RADIANT'] },
        { id: 1002, user: 'PlayerOne', pass: '1234', credits: 500, crystals: 10, status: 'Active', inventory: [], dailyStreak: 1, claimedToday: false, badges: [] }
    ],
    storeItems: [
        { id: 1, img: 'https://placehold.co/100x100/purple/white?text=Potion', name: 'Health Potion', price: 50, stock: 999, status: 'Available' }
    ],
    auctions: [],
    giftBatches: [],
    announcements: [],
    logs: []
};

// --- HELPERS ---
function syncAll() { io.emit('sync:full_data', db); }
function addLog(msg) { 
    db.logs.unshift({ time: Date.now(), msg }); 
    if(db.logs.length > 50) db.logs.pop(); 
    syncAll(); 
}

io.on('connection', (socket) => {
    socket.emit('sync:full_data', db);

    // --- PLAYER ACTIONS ---
    socket.on('player:login', (username) => {
        const user = db.players.find(p => p.user === username);
        if(user) socket.emit('player:login_success', user);
    });

    socket.on('player:claim_daily', ({ userId, day, amount }) => {
        const p = db.players.find(x => x.id === userId);
        if(p && !p.claimedToday) {
            p.credits += amount;
            p.claimedToday = true;
            // Logic to reset claimedToday would happen on a cron job in production
            addLog(`${p.user} claimed Day ${day} reward (${amount})`);
            syncAll();
        }
    });

    socket.on('player:buy_item', ({ userId, itemId }) => {
        const p = db.players.find(x => x.id === userId);
        const item = db.storeItems.find(x => x.id === itemId);
        if(p && item && item.stock > 0 && p.credits >= item.price) {
            p.credits -= item.price;
            item.stock--;
            if(item.stock <= 0) item.status = 'Sold Out';
            p.inventory.push({ id: Date.now(), name: item.name, img: item.img });
            addLog(`${p.user} bought ${item.name}`);
            syncAll();
        }
    });

    socket.on('player:place_bid', ({ userId, aucId, bid }) => {
        const p = db.players.find(x => x.id === userId);
        const auc = db.auctions.find(x => x.id === aucId);
        if(p && auc && auc.status === 'Active' && p.credits >= bid && bid > auc.bid) {
            p.credits -= bid;
            auc.bid = bid;
            auc.bidder = p.user;
            addLog(`${p.user} bid ${bid} on ${auc.item}`);
            syncAll();
        }
    });

    socket.on('player:redeem_code', ({ userId, code }) => {
        const p = db.players.find(x => x.id === userId);
        let found = false;
        db.giftBatches.forEach(batch => {
            const c = batch.codes.find(c => c.code === code);
            if(c && !c.redeemed) {
                c.redeemed = true; c.user = p.user; batch.redeemedCount++;
                if(batch.type === 'Credits') p.credits += parseInt(batch.amount);
                else p.crystals += parseInt(batch.amount);
                found = true;
                addLog(`${p.user} redeemed code ${code}`);
                socket.emit('redeem_success', `Redeemed ${batch.amount} ${batch.type}!`);
                syncAll();
            }
        });
        if(!found) socket.emit('redeem_fail', 'Invalid Code');
    });

    // --- ADMIN ACTIONS ---
    socket.on('admin:add_item', (i) => { db.storeItems.unshift(i); syncAll(); });
    socket.on('admin:create_auction', (a) => { db.auctions.unshift(a); syncAll(); });
    socket.on('admin:post_announcement', (p) => { db.announcements.unshift(p); syncAll(); });
    socket.on('admin:generate_codes', (b) => {
        let codes = [];
        for(let i=0; i<b.total; i++) codes.push({ code: b.prefix + Math.random().toString(36).substr(2,6).toUpperCase(), redeemed:false, user:null });
        b.codes = codes; b.redeemedCount = 0;
        db.giftBatches.unshift(b);
        syncAll();
    });
    socket.on('admin:update_player', (p) => { 
        const idx = db.players.findIndex(x => x.id === p.id);
        if(idx !== -1) db.players[idx] = { ...db.players[idx], ...p };
        syncAll();
    });
});

setInterval(() => {
    const now = Date.now();
    let changed = false;
    db.auctions.forEach(a => {
        if(a.status === 'Active' && now > a.endTime) { a.status = 'Ended'; changed = true; }
    });
    if(changed) syncAll();
}, 10000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
