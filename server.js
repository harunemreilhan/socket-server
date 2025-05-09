import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();

// Extended CORS settings
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Handle CORS Preflight requests
app.options('*', cors());

const server = createServer(app);

// Socket.io with wider CORS settings
const io = new Server(server, {
  cors: {
    origin: "*", // Allow connections from all sources
    methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  },
  // Increase timeout values for connection issues
  connectTimeout: 45000,
  pingInterval: 15000,
  pingTimeout: 30000
});

const PORT = process.env.PORT || 3001;

// Status endpoint 
app.get('/', (req, res) => {
  res.send('Socket.io server is running');
});

// Data structures to store rooms and users information
const rooms = new Map();

// Socket.io connection listener
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Send connection info
  socket.emit('connection-info', {
    socketId: socket.id,
    connectionTime: new Date().toISOString(),
    serverInfo: {
      nodeVersion: process.version,
      platform: process.platform
    }
  });

  // Ping-pong mechanism to keep connection alive
  const pingInterval = setInterval(() => {
    socket.emit('server-ping', { timestamp: Date.now() });
  }, 15000);

  socket.on('client-pong', (data) => {
    const latency = Date.now() - data.timestamp;
    socket.emit('latency-report', { latency });
  });

  // Join room
  socket.on('join-room', (data) => {
    const { roomId, userId, userName, isHost } = data;
    
    // Save socket info to room
    socket.roomId = roomId;
    socket.userName = userName;
    socket.isHost = isHost;
    
    // Join room
    socket.join(roomId);
    
    // Store room info
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }
    
    const roomUsers = rooms.get(roomId);
    roomUsers.set(socket.id, {
      id: socket.id,
      name: userName,
      isHost,
      connected: true
    });
    
    // Get users in room
    const users = Array.from(roomUsers.values());
    
    // Notify everyone in room about new user
    io.to(roomId).emit('user-joined', users);
    
    console.log(`${userName} (${socket.id}) joined room: ${roomId}`);
  });

  // WebRTC signal relay
  socket.on('relay-ice', (data) => {
    const { roomId, peerId, iceCandidate, from } = data;
    
    console.log(`Relaying ICE candidate from ${from} to ${peerId}`);
    io.to(peerId).emit('relay-ice', { iceCandidate, from });
  });

  socket.on('relay-sdp', (data) => {
    const { roomId, peerId, sessionDescription, from } = data;
    
    console.log(`Relaying ${sessionDescription.type} from ${from} to ${peerId}`);
    io.to(peerId).emit('relay-sdp', { sessionDescription, from });
  });
  
  // Audio signal relay
  socket.on('audio-signal', (data) => {
    const { to, from, type, signal } = data;
    
    console.log(`Relaying ${type} signal from ${from} to ${to}`);
    io.to(to).emit('audio-signal', {
      from,
      signal,
      type
    });
  });
  
  // Audio status change
  socket.on('audio-status-change', (data) => {
    const { roomId, isMuted, userId } = data;
    
    // Update user audio status
    if (rooms.has(roomId)) {
      const roomUsers = rooms.get(roomId);
      const user = roomUsers.get(userId);
      
      if (user) {
        user.isMuted = isMuted;
        roomUsers.set(userId, user);
      }
    }
    
    // Notify everyone in room
    io.to(roomId).emit('user-audio-status', {
      userId,
      isMuted
    });
  });
  
  // Voice status change
  socket.on('voice-status-change', (data) => {
    const { roomId, isMuted } = data;
    
    // Update user voice status
    if (rooms.has(roomId)) {
      const roomUsers = rooms.get(roomId);
      const user = roomUsers.get(socket.id);
      
      if (user) {
        user.isMuted = isMuted;
        roomUsers.set(socket.id, user);
      }
    }
    
    // Notify everyone in room
    io.to(roomId).emit('user-voice-status', {
      userId: socket.id,
      isMuted
    });
  });
  
  // Speaking signal
  socket.on('user-speaking', (data) => {
    const { roomId, userId, level } = data;
    io.to(roomId).emit('user-speaking', { userId, level });
  });
  
  // Noise suppression change
  socket.on('noise-suppression-change', (data) => {
    const { roomId, level } = data;
    // Send notification to user only
    socket.emit('noise-suppression-updated', { level });
  });

  // Request user list
  socket.on('request-user-list', (data) => {
    const { roomId } = data;
    
    if (rooms.has(roomId)) {
      const users = Array.from(rooms.get(roomId).values());
      socket.emit('user-list-update', users);
    }
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Clear ping interval
    clearInterval(pingInterval);
    
    // Find user's room
    const roomId = socket.roomId;
    
    if (roomId && rooms.has(roomId)) {
      const roomUsers = rooms.get(roomId);
      
      // Remove user from room
      roomUsers.delete(socket.id);
      
      // If room is empty, remove it
      if (roomUsers.size === 0) {
        rooms.delete(roomId);
        console.log(`Room deleted: ${roomId}`);
      } else {
        // Get remaining users in room
        const users = Array.from(roomUsers.values());
        
        // Notify everyone in room
        io.to(roomId).emit('user-left', users);
      }
    }
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Socket.io server running on port ${PORT}`);
});
