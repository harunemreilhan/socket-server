import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());

const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  },
  transports: ['websocket', 'polling'] 
});

const PORT = process.env.PORT || 3001;

app.get('/', (req, res) => {
  res.send('Socket.io sunucusu çalışıyor');
});

app.get('/status', (req, res) => {
  const roomStats = [];
  io.sockets.adapter.rooms.forEach((sockets, room) => {
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
    },
    screen_sharing_tips: {
      browser_settings: 'Chrome ve Firefox ekran paylaşımı için tercih edilir. Safari ve Edge bazı kısıtlamalar içerebilir.',
      permissions: 'Ekran paylaşımı için tarayıcı izinlerinin verildiğinden emin olun.',
      connection_steps: [
        '1. Ekran paylaşım isteği açılır penceresinde mutlaka bir kaynak seçilmelidir (Ekran, Pencere veya Sekme)',
        '2. İzin verildikten sonra birkaç saniye beklenmesi gerekebilir',
        '3. Tarayıcı konsolunda (F12) hata olup olmadığını kontrol edin'
      ],
      known_issues: 'Bazı tarayıcılarda (özellikle iOS Safari) ekran paylaşımı desteği sınırlı olabilir.'
    },
    mediastream_check: 'navigator.mediaDevices.getDisplayMedia() browser konsolunda test edilebilir'
  });
});

app.get('/screen-sharing-debug', (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <title>Ekran Paylaşımı Tanılama</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
      button { padding: 10px; margin: 10px 0; }
      #log { background: #f4f4f4; padding: 10px; border-radius: 5px; max-height: 300px; overflow-y: auto; }
      .success { color: green; }
      .error { color: red; }
    </style>
  </head>
  <body>
    <h1>Ekran Paylaşımı Tanılama Aracı</h1>
    <p>Bu sayfa, tarayıcınızın ekran paylaşımı yeteneklerini test etmek için kullanılabilir.</p>
    
    <button id="checkSupport">WebRTC Desteğini Kontrol Et</button>
    <button id="testScreenShare">Ekran Paylaşımını Test Et</button>
    <button id="stopScreenShare" disabled>Ekran Paylaşımını Durdur</button>
    
    <h3>Test Sonuçları:</h3>
    <div id="log"></div>
    
    <video id="preview" autoplay muted style="max-width: 100%; margin-top: 20px; display: none;"></video>
    
    <script>
      const log = document.getElementById('log');
      const preview = document.getElementById('preview');
      const stopBtn = document.getElementById('stopScreenShare');
      let stream = null;
      
      function addLog(message, type = 'info') {
        const entry = document.createElement('div');
        entry.className = type;
        entry.textContent = message;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
      }
      
      document.getElementById('checkSupport').addEventListener('click', () => {
        addLog('WebRTC destek kontrolü başlatılıyor...', 'info');
        
        // Navigator kontrolü
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
          addLog('HATA: Bu tarayıcı ekran paylaşımını desteklemiyor (navigator.mediaDevices.getDisplayMedia mevcut değil)', 'error');
        } else {
          addLog('BAŞARILI: Bu tarayıcı ekran paylaşımını destekliyor', 'success');
        }
        
        // RTCPeerConnection kontrolü
        if (window.RTCPeerConnection) {
          addLog('BAŞARILI: RTCPeerConnection destekleniyor', 'success');
        } else {
          addLog('HATA: RTCPeerConnection desteklenmiyor', 'error');
        }
        
        // Tarayıcı bilgileri
        addLog(\`Tarayıcı: \${navigator.userAgent}\`, 'info');
      });
      
      document.getElementById('testScreenShare').addEventListener('click', async () => {
        addLog('Ekran paylaşımı testi başlatılıyor...', 'info');
        
        try {
          if (stream) {
            stream.getTracks().forEach(track => track.stop());
          }
          
          const constraints = {
            video: {
              cursor: "always"
            },
            audio: false
          };
          
          stream = await navigator.mediaDevices.getDisplayMedia(constraints);
          
          addLog(\`BAŞARILI: Ekran paylaşımı başlatıldı (\${stream.getVideoTracks().length} video track)\`, 'success');
          addLog(\`Video özellikleri: \${JSON.stringify(stream.getVideoTracks()[0].getSettings())}\`, 'info');
          
          preview.style.display = 'block';
          preview.srcObject = stream;
          stopBtn.disabled = false;
          
          // Takip paylaşımı durduğunda event
          stream.getVideoTracks()[0].onended = () => {
            addLog('Kullanıcı ekran paylaşımını durdurdu', 'info');
            preview.style.display = 'none';
            stopBtn.disabled = true;
            stream = null;
          };
          
        } catch (err) {
          addLog(\`HATA: \${err.name}: \${err.message}\`, 'error');
        }
      });
      
      document.getElementById('stopScreenShare').addEventListener('click', () => {
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
          addLog('Ekran paylaşımı durduruldu', 'info');
          preview.style.display = 'none';
          stopBtn.disabled = true;
          stream = null;
        }
      });
      
      // Sayfa yüklendiğinde tarayıcı uyumluluk kontrolü yap
      document.addEventListener('DOMContentLoaded', () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
          addLog('UYARI: Bu tarayıcı ekran paylaşımını desteklemiyor veya HTTPS kullanmıyorsunuz', 'error');
        }
      });
    </script>
  </body>
  </html>
  `);
});

io.on('connection', (socket) => {
  console.log('Bir kullanıcı bağlandı:', socket.id);

  socket.on('rtc-diagnostic', ({ roomId, targetId }) => {
    console.log(`Tanılama isteği alındı: ${socket.id} -> ${targetId}, Oda: ${roomId}`);
    
    try {
      const diagnosticInfo = {
        serverTime: Date.now(),
        serverUptime: process.uptime(),
        roomPresent: io.sockets.adapter.rooms.has(roomId),
        targetPresent: io.sockets.sockets.has(targetId),
        usersInRoom: getUsers(roomId)
      };
      
      socket.emit('rtc-diagnostic-result', diagnosticInfo);
      
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

  socket.on('join-room', ({ roomId, userId, userName, isHost }) => {
    console.log(`${userName} (${userId || socket.id}) ${roomId} odasına katıldı`);
    
    let isReconnect = false;
    const previousRoom = Object.keys(socket.rooms).find(room => room !== socket.id);
    
    if (previousRoom) {
      console.log(`${userName} önceki bir odadan tekrar bağlanıyor: ${previousRoom}`);
      socket.leave(previousRoom);
      isReconnect = true;
    }
    
    socket.join(roomId);
    
    socket.userData = { id: userId || socket.id, name: userName, room: roomId, isHost, isConnected: true };
    
    const users = getUsers(roomId);
    console.log(`Odadaki kullanıcılar (${roomId}):`, users);
    
    io.to(roomId).emit('user-joined', users);
    
    socket.emit('room-info', {
      roomId,
      users,
      yourId: socket.id,
      isReconnect
    });

    if (isReconnect) {
      console.log(`${userName} yeniden bağlandı, mevcut ekran paylaşımlarını bildirme`);
      
      const sharingSockets = findScreenSharingSockets(roomId);
      sharingSockets.forEach(sharingSocket => {
        if (sharingSocket.id !== socket.id) {
          console.log(`${sharingSocket.userData?.name} ekran paylaştığı bilgisi gönderiliyor`);
          
          socket.emit('screen-share-started', {
            userId: sharingSocket.id,
            userName: sharingSocket.userData?.name
          });
        }
      });
    }
  });

  socket.on('screen-share-started', ({ roomId, userId, userName, hasAudio }) => {
    console.log(`${socket.userData?.name || 'Bir kullanıcı'} ekran paylaşımı başlattı (ses: ${hasAudio ? 'var' : 'yok'})`);
    
    if (socket.userData) {
      socket.userData.isSharing = true;
      socket.userData.hasAudio = hasAudio;
    }
    
    socket.emit('screen-share-confirmed', {
      userId: userId || socket.id,
      userName: socket.userData?.name || userName,
      startTime: Date.now(),
      streamId: `stream_${socket.id}_${Date.now()}`,
      hasAudio
    });
    
    socket.to(roomId).emit('screen-share-started', {
      userId: userId || socket.id,
      userName: socket.userData?.name || userName,
      startTime: Date.now(),
      streamId: `stream_${socket.id}_${Date.now()}`,
      hasAudio
    });
    
    const users = getUsers(roomId);
    io.to(roomId).emit('user-joined', users);
    
    triggerReconnect(roomId, socket.id);
  });

  socket.on('media-stream-info', ({ roomId, constraints, streamId }) => {
    console.log(`Medya akışı bilgisi paylaşılıyor (${roomId}), stream: ${streamId}`);
    
    try {
      if (socket.userData) {
        socket.userData.mediaStreamInfo = {
          streamId: streamId,
          constraints: constraints,
          timestamp: Date.now()
        };
      }
      
      socket.to(roomId).emit('new-media-stream-available', {
        userId: socket.id,
        userName: socket.userData?.name || 'Bilinmeyen Kullanıcı',
        streamId: streamId,
        constraints: constraints
      });
      
    } catch (error) {
      console.error('Medya akışı bilgisi paylaşımı hatası:', error);
      socket.emit('media-stream-error', {
        error: error.message
      });
    }
  });

  socket.on('screen-share-ready', ({ roomId, offerOptions }) => {
    console.log(`${socket.userData?.name || 'Bir kullanıcı'} ekran paylaşım sinyalini hazır bildirdi`);
    
    socket.to(roomId).emit('prepare-for-screen-share', {
      fromId: socket.id,
      userName: socket.userData?.name || 'Bilinmeyen Kullanıcı',
      offerOptions: offerOptions || {
        offerToReceiveVideo: true,
        offerToReceiveAudio: false
      }
    });
  });

  socket.on('direct-signal', ({ targetId, signalData, type }) => {
    console.log(`Doğrudan sinyal gönderiliyor: ${socket.id} -> ${targetId}, tip: ${type}`);
    
    try {
      const targetSocket = io.sockets.sockets.get(targetId);
      if (targetSocket && targetSocket.connected) {
        targetSocket.emit('direct-signal', {
          fromId: socket.id,
          signalData: signalData,
          type: type,
          userName: socket.userData?.name || 'Bilinmeyen Kullanıcı',
          timestamp: Date.now()
        });
      } else {
        socket.emit('direct-signal-error', {
          targetId: targetId,
          error: 'Hedef kullanıcı bağlı değil'
        });
      }
    } catch (error) {
      console.error('Doğrudan sinyal gönderimi hatası:', error);
      socket.emit('direct-signal-error', {
        targetId: targetId,
        error: error.message
      });
    }
  });

  function triggerReconnect(roomId, sharingUserId) {
    console.log(`Odadaki herkese bağlantı yenileme tetikleniyor (${roomId})`);
    
    const users = getUsers(roomId);
    
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

  socket.on('request-user-list', ({ roomId }) => {
    console.log(`${socket.userData?.name || 'Bir kullanıcı'} kullanıcı listesi güncellemesi istedi (${roomId})`);
    
    const users = getUsers(roomId);
    
    socket.emit('user-joined', users);
    
    socket.to(roomId).emit('user-joined', users);
    
    console.log(`Kullanıcı listesi güncellendi ve gönderildi (${roomId}):`, users);
  });

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

  socket.on('screen-share-stopped', ({ roomId, userId, userName }) => {
    console.log(`${socket.userData?.name || 'Bir kullanıcı'} ekran paylaşımını durdurdu`);
    
    if (socket.userData) {
      socket.userData.isSharing = false;
    }
    
    socket.to(roomId).emit('screen-share-stopped', {
      userId: userId || socket.id,
      userName: socket.userData?.name || userName
    });
  });

  socket.on('sending-signal', ({ userToSignal, callerId, signal, senderName }) => {
    console.log(`Sinyal gönderiliyor: ${callerId} -> ${userToSignal}`);
    console.log(`Gönderenin adı: ${senderName || socket.userData?.name || 'Bilinmeyen kullanıcı'}`);
    
    if (signal) {
      console.log(`Sinyal tipi: ${signal.type || 'Bilinmiyor'}, SDPLength: ${signal.sdp ? signal.sdp.length : 0}`);
    }
    
    const targetSocket = io.sockets.sockets.get(userToSignal);
    if (!targetSocket) {
      console.error(`Hedef soket bulunamadı: ${userToSignal}`);
      socket.emit('signal-error', {
        error: 'Hedef kullanıcı bulunamadı',
        targetId: userToSignal
      });
      return;
    }
    
    if (!targetSocket.connected) {
      console.error(`Hedef soket bağlı değil: ${userToSignal}`);
      socket.emit('signal-error', {
        error: 'Hedef kullanıcı bağlantısı kopmuş',
        targetId: userToSignal
      });
      return;
    }
    
    try {
      targetSocket.emit('receiving-signal', {
        signal,
        id: callerId,
        callerId: callerId, 
        senderName: senderName || socket.userData?.name || 'Bilinmeyen kullanıcı',
        timestamp: Date.now() 
      });
      
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

  socket.on('signal-reconnect-request', ({ targetId, roomId }) => {
    console.log(`Bağlantı yenileme talebi: ${socket.id} -> ${targetId}`);
    
    const targetSocket = io.sockets.sockets.get(targetId);
    if (!targetSocket) {
      console.error(`Yeniden bağlanılacak soket bulunamadı: ${targetId}`);
      return;
    }
    
    targetSocket.emit('reconnect-signal', {
      userId: socket.id,
      userName: socket.userData?.name || 'Bilinmeyen kullanıcı',
      roomId
    });
    
    console.log(`Yeniden bağlanma talebi gönderildi: ${socket.id} -> ${targetId}`);
  });

  socket.on('returning-signal', ({ callerID, signal }) => {
    console.log(`Yanıt sinyali gönderiliyor: ${socket.id} -> ${callerID}`);
    
    if (signal) {
      console.log(`Sinyal tipi: ${signal.type || 'Bilinmiyor'}, SDPLength: ${signal.sdp ? signal.sdp.length : 0}`);
    }
    
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

  socket.on('chat-message', ({ roomId, message }) => {
    console.log(`Mesaj - Oda: ${roomId}, Gönderen: ${message.sender}`);
    socket.to(roomId).emit('chat-message', message);
  });

  socket.on('disconnect', () => {
    console.log('Kullanıcı ayrıldı:', socket.id);
    
    const roomId = socket.userData?.room;
    if (roomId) {
      const users = getUsers(roomId);
      io.to(roomId).emit('user-left', users);
    }
  });
});

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
