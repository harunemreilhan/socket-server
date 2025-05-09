import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();

// CORS ayarları genişletildi
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// CORS Preflight isteklerine cevap ver
app.options('*', cors());

const server = createServer(app);

// Socket.io CORS ayarlarını güncelledik
const io = new Server(server, {
  cors: {
    origin: "*", // Tüm kaynaklardan bağlantılara izin ver
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  },
  transports: ['websocket', 'polling'] // WebSocket ve polling destekle
});

const PORT = process.env.PORT || 3001;

// Route for checking if the server is running
app.get('/', (req, res) => {
  res.send('Socket.io sunucusu çalışıyor');
});

// WebRTC compatibility information route
app.get('/webrtc-check', (req, res) => {
  res.json({
    server: {
      status: 'running',
      node_version: process.version,
      timestamp: new Date().toISOString()
    },
    info: 'Bu endpoint, istemcilere sunucunun çalışır durumda olduğunu ve WebRTC bağlantılarının kurulabileceğini doğrulamak için kullanılır.',
    client_troubleshooting: {
      webrtc_test: 'https://test.webrtc.org/',
      turn_servers: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302'
      ],
      note: 'Ekran paylaşımı sorunları yaşıyorsanız, tarayıcınızın WebRTC desteğini ve ağ ayarlarınızı kontrol edin.'
    }
  });
});

// Socket.io bağlantı dinleyicisi
io.on('connection', (socket) => {
  console.log('Bir kullanıcı bağlandı:', socket.id);

  // Kullanıcı odaya katıldığında
  socket.on('join-room', ({ roomId, userId, userName, isHost }) => {
    console.log(`${userName} (${userId || socket.id}) ${roomId} odasına katıldı`);
    
    // Odaya katıl
    socket.join(roomId);
    
    // Kullanıcı bilgilerini sakla - ID'yi saklamayı unutma
    socket.userData = { id: userId || socket.id, name: userName, room: roomId, isHost };
    
    // Odadaki tüm kullanıcıları güncelle
    const users = getUsers(roomId);
    console.log(`Odadaki kullanıcılar (${roomId}):`, users);
    
    // Herkese kullanıcı listesini gönder
    io.to(roomId).emit('user-joined', users);
    
    // Özellikle yeni kullanıcıya bilgi ver
    socket.emit('room-info', {
      roomId,
      users,
      yourId: socket.id
    });
  });

  // Kullanıcı ekran paylaşmaya başladığında
  socket.on('screen-share-started', ({ roomId, userId, userName }) => {
    console.log(`${socket.userData?.name || 'Bir kullanıcı'} ekran paylaşımı başlattı`);
    socket.to(roomId).emit('screen-share-started', {
      userId: userId || socket.id,
      userName: socket.userData?.name || userName
    });
  });

  // Kullanıcı ekran paylaşımını durdurduğunda
  socket.on('screen-share-stopped', ({ roomId, userId, userName }) => {
    socket.to(roomId).emit('screen-share-stopped', {
      userId: userId || socket.id,
      userName: socket.userData?.name || userName
    });
  });

  // WebRTC sinyal gönderimi - iyileştirildi
  socket.on('sending-signal', ({ userToSignal, callerId, signal, senderName }) => {
    console.log(`Sinyal gönderiliyor: ${callerId} -> ${userToSignal}`);
    console.log(`Gönderenin adı: ${senderName || socket.userData?.name || 'Bilinmeyen kullanıcı'}`);
    
    // Signal nesnesinin içeriğini kontrol et
    if (signal) {
      console.log(`Sinyal tipi: ${signal.type || 'Bilinmiyor'}, SDPLength: ${signal.sdp ? signal.sdp.length : 0}`);
    }
    
    // Hedef soket mevcut mu kontrol et
    const targetSocket = io.sockets.sockets.get(userToSignal);
    if (!targetSocket) {
      console.error(`Hedef soket bulunamadı: ${userToSignal}`);
      socket.emit('signal-error', {
        error: 'Hedef kullanıcı bulunamadı',
        targetId: userToSignal
      });
      return;
    }
    
    // Ek bilgilerle beraber sinyali gönder
    io.to(userToSignal).emit('receiving-signal', {
      signal,
      id: callerId,
      callerId: callerId, // Ek güvenlik için çift alan
      senderName: senderName || socket.userData?.name || 'Bilinmeyen kullanıcı'
    });
  });

  // WebRTC geri gelen sinyal - iyileştirildi
  socket.on('returning-signal', ({ callerID, signal }) => {
    console.log(`Yanıt sinyali gönderiliyor: ${socket.id} -> ${callerID}`);
    
    // Signal nesnesinin içeriğini kontrol et
    if (signal) {
      console.log(`Sinyal tipi: ${signal.type || 'Bilinmiyor'}, SDPLength: ${signal.sdp ? signal.sdp.length : 0}`);
    }
    
    // Hedef soket mevcut mu kontrol et
    const targetSocket = io.sockets.sockets.get(callerID);
    if (!targetSocket) {
      console.error(`Hedef soket bulunamadı: ${callerID}`);
      socket.emit('signal-error', {
        error: 'Hedef kullanıcı bulunamadı',
        targetId: callerID
      });
      return;
    }
    
    io.to(callerID).emit('receiving-returned-signal', {
      signal,
      id: socket.id,
      senderName: socket.userData?.name || 'Bilinmeyen kullanıcı'
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

// Bir odadaki tüm kullanıcıları getir - iyileştirildi
function getUsers(roomId) {
  if (!io.sockets.adapter.rooms.has(roomId)) return [];
  
  const users = [];
  io.sockets.adapter.rooms.get(roomId).forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socket.userData) {
      users.push({
        id: socketId,
        name: socket.userData.name,
        isHost: socket.userData.isHost || false
      });
    }
  });
  
  console.log(`Kullanıcı listesi hazırlandı (${roomId}):`, users);
  return users;
}

server.listen(PORT, () => {
  console.log(`Socket.io sunucusu ${PORT} portunda çalışıyor`);
});
