
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Tüm kaynaklardan bağlantılara izin ver
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

// Route for checking if the server is running
app.get('/', (req, res) => {
  res.send('Socket.io sunucusu çalışıyor');
});

// Socket.io bağlantı dinleyicisi
io.on('connection', (socket) => {
  console.log('Bir kullanıcı bağlandı:', socket.id);

  // Kullanıcı odaya katıldığında
  socket.on('join-room', ({ roomId, userId, userName, isHost }) => {
    console.log(`${userName} (${userId}) ${roomId} odasına katıldı`);
    
    socket.join(roomId);
    
    // Her odadaki kullanıcı listesini takip etmek için
    const roomUsers = Array.from(io.sockets.adapter.rooms.get(roomId) || [])
      .map(id => {
        const userSocket = io.sockets.sockets.get(id);
        return {
          id,
          name: userSocket?.userData?.name || "Anonim"
        };
      });
      
    // Kullanıcı bilgilerini sakla
    socket.userData = { name: userName, room: roomId, isHost };
    
    // Odadaki tüm kullanıcıları güncelle
    const users = getUsers(roomId);
    io.to(roomId).emit('user-joined', users);
  });

  // Kullanıcı ekran paylaşmaya başladığında
  socket.on('screen-share-started', ({ roomId }) => {
    console.log(`${socket.userData?.name || 'Bir kullanıcı'} ekran paylaşımı başlattı`);
    socket.to(roomId).emit('screen-share-started', {
      userId: socket.id,
      userName: socket.userData?.name
    });
  });

  // Kullanıcı ekran paylaşımını durdurduğunda
  socket.on('screen-share-stopped', ({ roomId }) => {
    socket.to(roomId).emit('screen-share-stopped');
  });

  // WebRTC sinyal gönderimi
  socket.on('sending-signal', ({ userToSignal, callerId, signal }) => {
    io.to(userToSignal).emit('receiving-signal', {
      signal,
      id: callerId
    });
  });

  // WebRTC geri gelen sinyal
  socket.on('returning-signal', ({ callerID, signal }) => {
    io.to(callerID).emit('receiving-returned-signal', {
      signal,
      id: socket.id
    });
  });

  // Sohbet mesajlarını işleme
  socket.on('chat-message', ({ roomId, message }) => {
    console.log(`Mesaj - Oda: ${roomId}, Gönderen: ${message.sender}`);
    socket.to(roomId).emit('chat-message', message);
  });

  // Kullanıcı bağlantıyı kestiğinde
  socket.on('disconnect', () => {
    console.log('Kullanıcı ayrıldı:', socket.id);
    
    // Kullanıcının odasını bul ve diğerlerine haber ver
    const roomId = socket.userData?.room;
    if (roomId) {
      const users = getUsers(roomId);
      io.to(roomId).emit('user-left', users);
    }
  });
});

// Bir odadaki tüm kullanıcıları getir
function getUsers(roomId) {
  if (!io.sockets.adapter.rooms.has(roomId)) return [];
  
  const users = [];
  io.sockets.adapter.rooms.get(roomId).forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socket.userData) {
      users.push({
        id: socketId,
        name: socket.userData.name
      });
    }
  });
  
  return users;
}

server.listen(PORT, () => {
  console.log(`Socket.io sunucusu ${PORT} portunda çalışıyor`);
});