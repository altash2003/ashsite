const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 }); // Allow large image uploads (10MB)

app.use(express.static(path.join(__dirname, 'public')));

// --- CENTRAL DATABASE ---
let db = {
    players: [
        { id: 1001, user: 'ashleychan', pass: 'snt_ash1', credits: 1250, crystals: 50, status: 'Active', inventory: [], claimedDaily: false },
        { id: 1002, user: 'CryptoKing', pass: 'btc_moon', credits: 50000, crystals: 1200, status: 'Active', inventory: [], claimedDaily: false },
    ],
    storeItems: [],
    auctions: [],
    announcements: [],
    giftBatches: [], // { id, prefix, amount, codes: [{code, redeemed, user}] }
    logs: []
};

// Helper: Broadcast Log
function addLog(msg) {
    db.logs.unshift({ time: Date.now(), msg: msg });
    if(db.logs.length > 50) db.logs.pop();
    io.emit('sync:logs', db.logs);
}

// Helper: Broadcast Everything
function syncAll() {
    io.emit('sync:players', db.players);
    io.emit('sync:store', db.storeItems);
    io.emit('sync:auctions', db.auctions);
    io.emit('sync:announcements', db.announcements);
    io.emit('sync:giftcodes', db.giftBatches);
}

io.on('connection', (socket) => {
    // Send Initial Data
    socket.emit('init_data', db);

    // --- ADMIN ACTIONS ---
    socket.on('admin:update_player', (p) => {
        const idx = db.players.findIndex(x => x.id === p.id);
        if(idx !== -1) { db.players[idx] = p; syncAll(); addLog(`Updated player ${p.user}`); }
    });

    socket.on('admin:add_item', (item) => {
        db.storeItems.unshift(item);
        syncAll();
        addLog(`Added Store Item: ${item.name}`);
    });

    socket.on('admin:create_auction', (auc) => {
        db.auctions.unshift(auc);
        syncAll();
        addLog(`Started Auction: ${auc.item}`);
    });

    socket.on('admin:post_announcement', (post) => {
        db.announcements.unshift(post);
        syncAll();
        addLog(`Posted News: ${post.title}`);
    });

    socket.on('admin:generate_codes', (batch) => {
        db.giftBatches.unshift(batch);
        syncAll();
        addLog(`Generated ${batch.total} codes (${batch.amount} ${batch.type})`);
    });

    // --- PLAYER ACTIONS ---
    socket.on('player:login', (user) => {
        const p = db.players.find(x => x.user === user);
        if(p) socket.emit('player:login_success', p);
    });

    socket.on('player:buy_item', ({ userId, itemId }) => {
        const p = db.players.find(x => x.id === userId);
        const item = db.storeItems.find(x => x.id === itemId);
        if(p && item && item.status === 'Available' && p.credits >= item.price) {
            p.credits -= parseInt(item.price);
            item.stock--;
            if(item.stock <= 0) { item.status = 'Sold Out'; item.soldAt = Date.now(); }
            
            // Add to inventory
            p.inventory.push({ id: Date.now(), name: item.name, img: item.img, type: 'Store Purchase' });
            
            syncAll();
            addLog(`${p.user} bought ${item.name}`);
        }
    });

    socket.on('player:place_bid', ({ userId, aucId, bid }) => {
        const p = db.players.find(x => x.id === userId);
        const auc = db.auctions.find(x => x.id === aucId);
        if(p && auc && auc.status === 'Active' && p.credits >= bid && bid > auc.bid) {
            p.credits -= bid; // Simple deduction
            auc.bid = bid;
            auc.bidder = p.user;
            syncAll();
            addLog(`${p.user} bid ${bid} on ${auc.item}`);
        }
    });

    socket.on('player:claim_reward', ({ userId, day, amount }) => {
        const p = db.players.find(x => x.id === userId);
        if(p && !p.claimedDaily) {
            p.credits += amount;
            p.claimedDaily = true;
            syncAll();
            addLog(`${p.user} claimed Day ${day} reward`);
        }
    });

    socket.on('player:redeem_code', ({ userId, code }) => {
        const p = db.players.find(x => x.id === userId);
        let found = false;
        
        // Search all batches
        for(let b of db.giftBatches) {
            let c = b.codes.find(x => x.code === code);
            if(c && !c.redeemed) {
                c.redeemed = true;
                c.user = p.user;
                b.redeemedCount++;
                
                if(b.type === 'Credits') p.credits += parseInt(b.amount);
                else p.crystals += parseInt(b.amount);
                
                found = true;
                socket.emit('player:redeem_result', { success: true, msg: `Redeemed ${b.amount} ${b.type}!` });
                syncAll();
                addLog(`${p.user} redeemed code ${code}`);
                break;
            }
        }
        if(!found) socket.emit('player:redeem_result', { success: false, msg: 'Invalid or used code.' });
    });
});

server.listen(3000, () => console.log('Server Live on 3000'));
