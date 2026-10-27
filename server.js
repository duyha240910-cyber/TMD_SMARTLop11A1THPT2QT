const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = filePath.split('?')[0];
    const absPath = path.join(PUBLIC_DIR, filePath);
    
    if (!absPath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
    
    fs.readFile(absPath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not Found'); }
        const ext = path.extname(absPath);
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[ext] || 'text/plain';
        res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
        res.end(data);
    });
});

const wss = new WebSocketServer({ server });

// Cấu trúc lưu trữ phòng: rooms = { "ROOMCODE": { dashboards: [], sensors: {} } }
const rooms = new Map();

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // 1. Tham gia phòng
            if (data.type === 'join') {
                const roomCode = data.roomCode.toUpperCase();
                ws.roomCode = roomCode;

                if (!rooms.has(roomCode)) {
                    rooms.set(roomCode, { dashboards: [], sensors: {} });
                }
                const room = rooms.get(roomCode);

                if (data.role === 'dashboard') {
                    room.dashboards.push(ws);
                    ws.send(JSON.stringify({ type: 'joined', message: 'Đã vào phòng với tư cách Máy tính' }));
                } else {
                    // Điện thoại (GROUND hoặc BUILDING)
                    room.sensors[data.role] = ws;
                    ws.send(JSON.stringify({ type: 'joined', message: `Đã vào phòng với tư cách ${data.role}` }));
                    
                    // Báo cho Dashboard biết có cảm biến mới vào
                    room.dashboards.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify({ type: 'sensor-connected', role: data.role })); });
                }
            }

            // 2. Nhận dữ liệu cảm biến và chuyển tiếp trong CÙNG PHÒNG
            if (data.type === 'sensor-data' && ws.roomCode) {
                const room = rooms.get(ws.roomCode);
                if (room) {
                    const msg = JSON.stringify(data);
                    room.dashboards.forEach(client => {
                        if (client.readyState === 1) client.send(msg);
                    });
                }
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        if (ws.roomCode && rooms.has(ws.roomCode)) {
            const room = rooms.get(ws.roomCode);
            room.dashboards = room.dashboards.filter(c => c !== ws);
            if (ws.role === 'GROUND') delete room.sensors.GROUND;
            if (ws.role === 'BUILDING') delete room.sensors.BUILDING;
            
            // Xóa phòng nếu không còn ai
            if (room.dashboards.length === 0 && Object.keys(room.sensors).length === 0) {
                rooms.delete(ws.roomCode);
            }
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Máy chủ TMD SMART (Room Mode) đang chạy ở cổng ${PORT}`);
});