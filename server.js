const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');

// Tạo thư mục data nếu chưa có
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    // API: Tải file CSV về
    if (pathname === '/api/download' && req.method === 'GET') {
        const filename = parsedUrl.searchParams.get('file');
        const filepath = path.join(DATA_DIR, filename);
        if (fs.existsSync(filepath)) {
            res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` });
            fs.createReadStream(filepath).pipe(res);
            return;
        }
        res.writeHead(404); return res.end('File not found');
    }

    // API: Lưu dữ liệu từ Web lên Server
    if (pathname === '/api/save' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const filename = `TMD_Data_${Date.now()}.csv`;
                const filepath = path.join(DATA_DIR, filename);
                
                let csv = '\uFEFFThoiGian(s),GROUND(m/s2),BUILDING(m/s2)\n';
                const maxLen = Math.max(data.GROUND.length, data.BUILDING.length);
                for (let i = 0; i < maxLen; i++) {
                    const g = data.GROUND[i] ? data.GROUND[i].toFixed(4) : '';
                    const b = data.BUILDING[i] ? data.BUILDING[i].toFixed(4) : '';
                    csv += `${(i * 0.033).toFixed(3)},${g},${b}\n`; // Giả định dt ~ 33ms
                }
                fs.writeFileSync(filepath, csv);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, file: filename }));
            } catch (e) {
                res.writeHead(500); res.end('Error saving file');
            }
        });
        return;
    }

    // Phục vụ file tĩnh
    let filePath = pathname === '/' ? '/index.html' : pathname;
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
const rooms = new Map();

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'join') {
                const roomCode = data.roomCode.toUpperCase();
                ws.roomCode = roomCode;
                ws.role = data.role;

                if (!rooms.has(roomCode)) rooms.set(roomCode, { dashboards: [], sensors: {} });
                const room = rooms.get(roomCode);

                if (data.role === 'dashboard') {
                    room.dashboards.push(ws);
                    ws.send(JSON.stringify({ type: 'joined', message: 'Đã vào phòng' }));
                } else {
                    room.sensors[data.role] = ws;
                    ws.send(JSON.stringify({ type: 'joined', message: `Đã vào phòng ${data.role}` }));
                    room.dashboards.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify({ type: 'sensor-connected', role: data.role })); });
                }
            }

            if (data.type === 'sensor-data' && ws.roomCode) {
                const room = rooms.get(ws.roomCode);
                if (room) {
                    const msg = JSON.stringify(data);
                    room.dashboards.forEach(client => { if (client.readyState === 1) client.send(msg); });
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
            if (room.dashboards.length === 0 && Object.keys(room.sensors).length === 0) rooms.delete(ws.roomCode);
        }
    });
});

// Heartbeat: Quét kết nối chết mỗi 10 giây
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 10000);

wss.on('close', () => clearInterval(interval));

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Máy chủ TMD SMART (Enterprise Backend) đang chạy ở cổng ${PORT}`);
});
