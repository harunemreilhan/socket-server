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

// Tanılama ve durum endpointi
app.get('/status', (req, res) => {
  const roomStats = [];
  io.sockets.adapter.rooms.forEach((sockets, room) => {
    // Soket ID'lerini istatistiklere dahil etme
    if (!room.startsWith('/')) {
      const users = getUsers(room);
      roomStats.push({
        roomId: room,
        userCount: users.length,
        users: users,
        sharing: users.filter(u => u.isSharing).length > 0
      });
    }
  });

  res.json({
    status: 'running',
    connections: {
      totalConnections: io.engine.clientsCount,
      rooms: roomStats
    },
    serverInfo: {
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      nodeVersion: process.version
    }
  });
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

  // Ekran bağlantısı tanılama
  socket.on('rtc-diagnostic', ({ roomId, targetId }) => {
    console.log(`Tanılama isteği alındı: ${socket.id} -> ${targetId}, Oda: ${roomId}`);
    
    try {
      // Tanılama verilerini gönder
      const diagnosticInfo = {
        serverTime: Date.now(),
        serverUptime: process.uptime(),
        roomPresent: io.sockets.adapter.rooms.has(roomId),
        targetPresent: io.sockets.sockets.has(targetId),
        usersInRoom: getUsers(roomId)
      };
      
      socket.emit('rtc-diagnostic-result', diagnosticInfo);
      
      // Hedef kullanıcı mevcutsa ona da bildirim gönder
      if (targetId && io.sockets.sockets.has(targetId)) {
        io.sockets.sockets.get(targetId).emit('rtc-connection-check', {
          fromId: socket.id,
          userName: socket.userData?.name || 'Bilinmeyen kullanıcı'
        });
      }
    } catch (error) {
      console.error('Tanılama hatası:', error);
      socket.emit('rtc-diagnostic-error', { message: error.message });
    }
  });

  // Kullanıcı odaya katıldığında
  socket.on('join-room', ({ roomId, userId, userName, isHost }) => {
    console.log(`${userName} (${userId || socket.id}) ${roomId} odasına katıldı`);
    
    // Kullanıcı oturumunu yeniden bağlanma durumu için kontrol et
    let isReconnect = false;
    const previousRoom = Object.keys(socket.rooms).find(room => room !== socket.id);
    
    if (previousRoom) {
      console.log(`${userName} önceki bir odadan tekrar bağlanıyor: ${previousRoom}`);
      socket.leave(previousRoom);
      isReconnect = true;
    }
    
    // Odaya katıl
    socket.join(roomId);
    
    // Kullanıcı bilgilerini sakla - ID'yi saklamayı unutma
    socket.userData = { id: userId || socket.id, name: userName, room: roomId, isHost, isConnected: true };
    
    // Odadaki tüm kullanıcıları güncelle
    const users = getUsers(roomId);
    console.log(`Odadaki kullanıcılar (${roomId}):`, users);
    
    // Herkese kullanıcı listesini gönder
    io.to(roomId).emit('user-joined', users);
    
    // Özellikle yeni kullanıcıya bilgi ver
    socket.emit('room-info', {
      roomId,
      users,
      yourId: socket.id,
      isReconnect
    });

    // Yeniden bağlanma durumunda ekstra işlemler yap
    if (isReconnect) {
      console.log(`${userName} yeniden bağlandı, mevcut ekran paylaşımlarını bildirme`);
      
      // Bu odada ekran paylaşan kullanıcıları bul ve yeni kullanıcıya bildir
      const sharingSockets = findScreenSharingSockets(roomId);
      sharingSockets.forEach(sharingSocket => {
        if (sharingSocket.id !== socket.id) {
          console.log(`${sharingSocket.userData?.name} ekran paylaştığı bilgisi gönderiliyor`);
          
          // Yeni bağlanan kullanıcıya bildir
          socket.emit('screen-share-started', {
            userId: sharingSocket.id,
            userName: sharingSocket.userData?.name
          });
        }
      });
    }
  });

  // Kullanıcı ekran paylaşmaya başladığında
  socket.on('screen-share-started', ({ roomId, userId, userName }) => {
    console.log(`${socket.userData?.name || 'Bir kullanıcı'} ekran paylaşımı başlattı`);
    
    // Kullanıcı bilgilerini güncelle
    if (socket.userData) {
      socket.userData.isSharing = true;
    }
    
    // Kendisine doğrulama gönder
    socket.emit('screen-share-confirmed', {
      userId: userId || socket.id,
      userName: socket.userData?.name || userName
    });
    
    // Diğerlerine bildir
    socket.to(roomId).emit('screen-share-started', {
      userId: userId || socket.id,
      userName: socket.userData?.name || userName
    });
    
    // Odadaki tüm kullanıcıları güncelle ve herkese bildir
    const users = getUsers(roomId);
    io.to(roomId).emit('user-joined', users);
    
    // Tüm kullanıcılara yeni bağlantı kurmaları için bildirim
    triggerReconnect(roomId, socket.id);
  });

  // Ekran paylaşımı için otomatik bağlantı yenileme
  function triggerReconnect(roomId, sharingUserId) {
    console.log(`Odadaki herkese bağlantı yenileme tetikleniyor (${roomId})`);
    
    // Odadaki tüm kullanıcıları bul
    const users = getUsers(roomId);
    
    // Ekran paylaşan kullanıcı dışındaki herkese bildir
    users.forEach(user => {
      if (user.id !== sharingUserId) {
        const targetSocket = io.sockets.sockets.get(user.id);
        if (targetSocket && targetSocket.connected) {
          console.log(`${user.name} kullanıcısına yeniden bağlanma sinyali gönderiliyor`);
          targetSocket.emit('request-reconnect', {
            shareUserId: sharingUserId,
            roomId: roomId,
            timestamp: Date.now()
          });
        }
      }
    });
  }

  // Yeniden bağlanma isteği - yeni
  socket.on('request-peer-reconnect', ({ targetId, roomId }) => {
    console.log(`Bağlantı yenileme isteği: ${socket.id} -> ${targetId}`);
    
    try {
      const targetSocket = io.sockets.sockets.get(targetId);
      if (targetSocket && targetSocket.connected) {
        targetSocket.emit('peer-reconnect-signal', {
          fromId: socket.id,
          userName: socket.userData?.name || 'Bilinmeyen kullanıcı',
          roomId: roomId,
          timestamp: Date.now()
        });
        
        socket.emit('reconnect-initiated', {
          targetId: targetId,
          success: true
        });
        
        console.log(`Bağlantı yenileme talebi iletildi: ${socket.id} -> ${targetId}`);
      } else {
        socket.emit('reconnect-error', {
          targetId: targetId,
          message: 'Hedef kullanıcı bağlı değil'
        });
      }
    } catch (error) {
      console.error(`Bağlantı yenileme hatası: ${error.message}`);
      socket.emit('reconnect-error', {
        targetId: targetId,
        message: error.message
      });
    }
  });

  // Kullanıcı ekran paylaşımını durdurduğunda
  socket.on('screen-share-stopped', ({ roomId, userId, userName }) => {
    console.log(`${socket.userData?.name || 'Bir kullanıcı'} ekran paylaşımını durdurdu`);
    
    // Kullanıcı bilgilerini güncelle
    if (socket.userData) {
      socket.userData.isSharing = false;
    }
    
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
    
    // Hedef kullanıcı bağlı mı kontrol et
    if (!targetSocket.connected) {
      console.error(`Hedef soket bağlı değil: ${userToSignal}`);
      socket.emit('signal-error', {
        error: 'Hedef kullanıcı bağlantısı kopmuş',
        targetId: userToSignal
      });
      return;
    }
    
    try {
      // Ek bilgilerle beraber sinyali gönder
      targetSocket.emit('receiving-signal', {
        signal,
        id: callerId,
        callerId: callerId, // Ek güvenlik için çift alan
        senderName: senderName || socket.userData?.name || 'Bilinmeyen kullanıcı',
        timestamp: Date.now() // Zamansal kontrol için
      });
      
      // Gönderim başarı onayı
      socket.emit('signal-sent', {
        targetId: userToSignal,
        success: true
      });
      
      console.log(`Sinyal gönderildi: ${callerId} -> ${userToSignal}`);
    } catch (error) {
      console.error(`Sinyal gönderirken hata: ${error.message}`);
      socket.emit('signal-error', {
        error: 'Sinyal gönderme hatası',
        message: error.message
      });
    }
  });

  // Bağlantı yenileme talebi
  socket.on('signal-reconnect-request', ({ targetId, roomId }) => {
    console.log(`Bağlantı yenileme talebi: ${socket.id} -> ${targetId}`);
    
    // Hedef soket mevcut mu kontrol et 
    const targetSocket = io.sockets.sockets.get(targetId);
    if (!targetSocket) {
      console.error(`Yeniden bağlanılacak soket bulunamadı: ${targetId}`);
      return;
    }
    
    // Kullanıcıya yeniden bağlanma sinyali gönder
    targetSocket.emit('reconnect-signal', {
      userId: socket.id,
      userName: socket.userData?.name || 'Bilinmeyen kullanıcı',
      roomId
    });
    
    console.log(`Yeniden bağlanma talebi gönderildi: ${socket.id} -> ${targetId}`);
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
    
    try {
      targetSocket.emit('receiving-returned-signal', {
        signal,
        id: socket.id,
        senderName: socket.userData?.name || 'Bilinmeyen kullanıcı'
      });
      
      console.log(`Yanıt sinyali gönderildi: ${socket.id} -> ${callerID}`);
    } catch (error) {
      console.error(`Yanıt sinyali gönderirken hata: ${error.message}`);
      socket.emit('signal-error', {
        error: 'Yanıt sinyali gönderme hatası',
        message: error.message
      });
    }
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

// Ekran paylaşan kullanıcıları bul
function findScreenSharingSockets(roomId) {
  const sharingSockets = [];
  
  if (!io.sockets.adapter.rooms.has(roomId)) return sharingSockets;
  
  io.sockets.adapter.rooms.get(roomId).forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socket.userData && socket.userData.isSharing) {
      sharingSockets.push(socket);
    }
  });
  
  return sharingSockets;
}

// Bir odadaki tüm kullanıcıları getir - güçlendirildi
function getUsers(roomId) {
  if (!roomId) {
    console.error('getUsers: Oda kimliği belirtilmedi!');
    return [];
  }
  
  if (!io.sockets.adapter.rooms.has(roomId)) {
    console.log(`getUsers: ${roomId} odası mevcut değil`);
    return [];
  }
  
  try {
    const users = [];
    const socketIds = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    
    socketIds.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket && socket.userData) {
        users.push({
          id: socketId,
          name: socket.userData.name || 'Adsız Kullanıcı',
          isHost: socket.userData.isHost || false,
          isSharing: socket.userData.isSharing || false,
          connected: socket.connected
        });
      } else if (socket) {
        // Soket var ama userData tanımlı değilse
        users.push({
          id: socketId,
          name: 'Bilinmeyen Kullanıcı',
          isHost: false,
          isSharing: false,
          connected: socket.connected
        });
      }
    });
    
    console.log(`Kullanıcı listesi hazırlandı (${roomId}):`, users);
    return users;
  } catch (error) {
    console.error(`getUsers hatası (${roomId}):`, error);
    return [];
  }
}

server.listen(PORT, () => {
  console.log(`Socket.io sunucusu ${PORT} portunda çalışıyor`);
});
