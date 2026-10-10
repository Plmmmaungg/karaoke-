import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import crypto from 'node:crypto';

const app = express();
const httpServer = createServer(app);
const port = Number(process.env.PORT || 3001);
const allowedOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

app.use(cors({ origin: allowedOrigin === '*' ? true : allowedOrigin.split(',').map(s => s.trim()) }));
app.use(express.json({ limit: '100kb' }));

const io = new Server(httpServer, {
  cors: { origin: allowedOrigin === '*' ? true : allowedOrigin.split(',').map(s => s.trim()), methods: ['GET', 'POST'] }
});

const rooms = new Map();
const roomCode = () => crypto.randomInt(100000, 999999).toString();
const safeText = (value, max = 80) => String(value ?? '').trim().slice(0, max);

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    currentSong: room.currentSong,
    queue: room.queue,
    guests: [...room.guests.values()].map(g => ({ id: g.id, nickname: g.nickname })),
    createdAt: room.createdAt
  };
}
function emitRoom(room) {
  io.to(room.code).emit('room:update', publicRoom(room));
}
function getRoom(code) {
  return rooms.get(safeText(code, 12).toUpperCase());
}
function extractArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const key of ['items', 'results', 'videos', 'data', 'contents', 'videoResults']) {
    const candidate = data[key];
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') {
      for (const nested of ['items', 'results', 'videos']) if (Array.isArray(candidate[nested])) return candidate[nested];
    }
  }
  return [];
}
function normalizeResults(data) {
  return extractArray(data).map((item, index) => {
    const snippet = item.snippet || item;
    const idValue = item.videoId || item.video_id || item.id?.videoId || item.id || item.url || item.link;
    let videoId = typeof idValue === 'string' ? idValue : '';
    const url = String(item.url || item.link || item.videoUrl || item.video_url || '');
    if (!/^[\w-]{11}$/.test(videoId)) {
      const match = (url || videoId).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
      videoId = match?.[1] || '';
    }
    return {
      id: videoId || `result-${index}`,
      videoId,
      title: safeText(snippet.title || item.title || item.name || 'Untitled video', 180),
      channel: safeText(snippet.channelTitle || item.channelTitle || item.channel || item.author || item.uploader || 'YouTube', 100),
      thumbnail: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || item.thumbnail || item.thumbnailUrl || item.thumbnail_url || '',
      url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : url
    };
  }).filter(item => item.videoId && item.title);
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/search', async (req, res) => {
  const query = safeText(req.query.q, 160);
  if (query.length < 2) return res.status(400).json({ error: 'Enter at least 2 characters to search.' });
  const { RAPIDAPI_KEY, RAPIDAPI_HOST, RAPIDAPI_SEARCH_URL } = process.env;
  if (!RAPIDAPI_KEY || !RAPIDAPI_HOST || !RAPIDAPI_SEARCH_URL) {
    return res.status(503).json({
      error: 'RapidAPI is not configured yet. Add your key, host, and exact search endpoint to server/.env. See README.md.'
    });
  }
  try {
    const encoded = encodeURIComponent(query);
    let endpoint = RAPIDAPI_SEARCH_URL.replaceAll('{query}', encoded);
    if (!RAPIDAPI_SEARCH_URL.includes('{query}')) {
      const url = new URL(endpoint);
      url.searchParams.set(process.env.RAPIDAPI_QUERY_PARAM || 'query', query);
      endpoint = url.toString();
    }
    const response = await fetch(endpoint, {
      method: process.env.RAPIDAPI_METHOD || 'GET',
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': RAPIDAPI_HOST,
        'Accept': 'application/json'
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(502).json({ error: `RapidAPI returned ${response.status}. Check your endpoint, subscription, and API quota.` });
    const results = normalizeResults(body);
    if (!results.length) return res.json({ results: [], notice: 'The API responded, but no recognizable YouTube video IDs were found. Adjust normalizeResults() for this provider response.' });
    res.json({ results: results.slice(0, 20) });
  } catch (error) {
    res.status(502).json({ error: 'Could not contact RapidAPI. Check the endpoint URL and server internet connection.' });
  }
});

io.on('connection', socket => {
  socket.on('room:create', (_payload, callback) => {
    let code;
    do { code = roomCode(); } while (rooms.has(code));
    const room = { code, hostId: socket.id, currentSong: null, queue: [], guests: new Map(), createdAt: Date.now() };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 'host';
    callback?.({ ok: true, room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on('room:join', ({ code, nickname } = {}, callback) => {
    const room = getRoom(code);
    if (!room) return callback?.({ ok: false, error: 'Room not found. Check the code and try again.' });
    if (socket.data.roomCode && socket.data.roomCode !== room.code) socket.leave(socket.data.roomCode);
    const guest = { id: socket.id, nickname: safeText(nickname, 24) || 'Guest' };
    room.guests.set(socket.id, guest);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.role = 'guest';
    callback?.({ ok: true, room: publicRoom(room), guest });
    emitRoom(room);
  });

  socket.on('song:add', ({ song, nickname } = {}, callback) => {
    const room = getRoom(socket.data.roomCode);
    if (!room || socket.data.role !== 'guest') return callback?.({ ok: false, error: 'Join a room as a guest first.' });
    if (!song || !/^[\w-]{11}$/.test(String(song.videoId || ''))) return callback?.({ ok: false, error: 'This result does not contain a valid YouTube video ID.' });
    if (room.queue.length >= 100) return callback?.({ ok: false, error: 'The queue is full.' });
    const entry = {
      queueId: crypto.randomUUID(),
      videoId: song.videoId,
      title: safeText(song.title, 180),
      channel: safeText(song.channel, 100),
      thumbnail: safeText(song.thumbnail, 500),
      requestedBy: safeText(nickname, 24) || room.guests.get(socket.id)?.nickname || 'Guest',
      addedAt: Date.now()
    };
    room.queue.push(entry);
    emitRoom(room);
    callback?.({ ok: true });
  });

  socket.on('host:play-next', (_payload, callback) => {
    const room = getRoom(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return callback?.({ ok: false, error: 'Only the host can control playback.' });
    room.currentSong = room.queue.shift() || null;
    emitRoom(room);
    callback?.({ ok: true, currentSong: room.currentSong });
  });

  socket.on('host:remove-queue', ({ queueId } = {}, callback) => {
    const room = getRoom(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return callback?.({ ok: false, error: 'Only the host can edit the queue.' });
    room.queue = room.queue.filter(song => song.queueId !== queueId);
    emitRoom(room);
    callback?.({ ok: true });
  });

  socket.on('host:close-room', (_payload, callback) => {
    const room = getRoom(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return callback?.({ ok: false, error: 'Only the host can close this room.' });
    io.to(room.code).emit('room:closed');
    for (const member of io.sockets.adapter.rooms.get(room.code) || []) {
      const client = io.sockets.sockets.get(member);
      if (client) { client.leave(room.code); client.data.roomCode = null; client.data.role = null; }
    }
    rooms.delete(room.code);
    callback?.({ ok: true });
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const room = getRoom(code);
    if (!room) return;
    if (room.hostId === socket.id) {
      io.to(code).emit('room:closed');
      rooms.delete(code);
    } else {
      room.guests.delete(socket.id);
      emitRoom(room);
    }
  });
});

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Karaoke server listening on http://localhost:${port}`);
});
