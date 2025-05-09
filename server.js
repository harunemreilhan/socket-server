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

// Ekran paylaşım kontrol ve tanılama endpoint
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

// Socket.io bağlantı dinleyicisi
io.on('connection', (socket) => {
  console.log('Yeni bir kullanıcı bağlandı:', socket.id);

  // Kullanıcı bilgilerini saklamak için
  const users = new Map();
  const rooms = new Map();

  // WebRTC ICE adayı iletme
  socket.on('relay-ice', (data) => {
    const { roomId, peerId, iceCandidate, from } = data;
    
    if (roomId && peerId) {
      console.log(`ICE adayı iletiyor: ${from} -> ${peerId}`);
      
      // ICE adayını hedef kullanıcıya ilet
      const room = io.sockets.adapter.rooms.get(roomId);
      
      if (room) {
        room.forEach((socketId) => {
          const targetSocket = io.sockets.sockets.get(socketId);
          if (targetSocket && targetSocket.userData && targetSocket.userData.id === peerId) {
            targetSocket.emit('relay-ice', {
              iceCandidate,
              from
            });
          }
        });
      }
    }
  });

  // WebRTC SDP teklif/yanıt iletme
  socket.on('relay-sdp', (data) => {
    const { roomId, peerId, sessionDescription, from } = data;
    
    if (roomId && peerId) {
      console.log(`SDP iletiyor: ${from} -> ${peerId}, Tip: ${sessionDescription.type}`);
      
      // SDP'yi hedef kullanıcıya ilet
      const room = io.sockets.adapter.rooms.get(roomId);
      
      if (room) {
        room.forEach((socketId) => {
          const targetSocket = io.sockets.sockets.get(socketId);
          if (targetSocket && targetSocket.userData && targetSocket.userData.id === peerId) {
            targetSocket.emit('relay-sdp', {
              sessionDescription,
              from
            });
          }
        });
      }
    }
  });

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

  // Ses akışı başlatma sinyali
  socket.on('voice-signal', (data) => {
    const { signal, callerId, userToSignal, senderName } = data;
    console.log(`Ses sinyali alındı: ${senderName || socket.userData?.name} (${callerId}) -> ${userToSignal}`);
    
    if (userToSignal && io.sockets.sockets.has(userToSignal)) {
      io.to(userToSignal).emit('voice-signal', {
        signal,
        callerId,
        senderName: senderName || socket.userData?.name
      });
    }
  });

  // Ses akışı yanıt sinyali
  socket.on('voice-signal-return', (data) => {
    const { signal, callerId } = data;
    console.log(`Ses yanıt sinyali: ${socket.id} -> ${callerId}`);
    
    if (callerId && io.sockets.sockets.has(callerId)) {
      io.to(callerId).emit('voice-signal-returned', {
        signal,
        id: socket.id
      });
    }
  });

  // Odaya katılma işlemi
  socket.on('join-room', (userData) => {
    try {
      const { roomId, userId, userName, isHost } = userData;
      console.log(`Kullanıcı odaya katılıyor - Gelen veri:`, userData);
      
      if (!roomId) {
        console.error('Oda ID belirtilmemiş');
        socket.emit('room-error', { message: 'Oda ID belirtilmemiş' });
        return;
      }
      
      if (!userName) {
        console.error('Kullanıcı adı belirtilmemiş:', userData);
        socket.emit('room-error', { message: 'Kullanıcı adı belirtilmemiş' });
        return;
      }
      
      // Oda varsa katıl
      socket.join(roomId);
      
      // Kullanıcı bilgilerini sakla
      socket.userData = {
        id: userId || socket.id,
        name: userName || 'Misafir',
        roomId,
        isHost: !!isHost,
        isMuted: false,
        noiseSuppression: 'normal'
      };
      
      console.log(`Kullanıcı odaya başarıyla katıldı: ${socket.userData.name} (${socket.userData.id}), Oda: ${roomId}`);
      
      // Kullanıcıları güncelle ve bildir
      updateUsers(roomId);
    } catch (error) {
      console.error('Odaya katılma hatası:', error);
      socket.emit('room-error', { message: 'Odaya katılırken bir hata oluştu' });
    }
  });

  // Kullanıcı durumu güncelleme
  socket.on('user-status', (data) => {
    try {
      if (!socket.userData) return;
      
      // Kullanıcı bilgilerini güncelle
      Object.assign(socket.userData, data);
      
      // Odadaki kullanıcıları bilgilendir
      updateUsers(data.roomId);
    } catch (error) {
      console.error('Kullanıcı durumu güncelleme hatası:', error);
    }
  });

  // Odadan ayrılma
  socket.on('leave-room', ({ roomId }) => {
    try {
      console.log(`Kullanıcı odadan ayrılıyor: ${socket.userData?.name} (${socket.id}), Oda: ${roomId}`);
      socket.leave(roomId);
      
      // Kullanıcı verilerini temizle
      socket.userData = null;
      
      // Odadaki kullanıcıları bilgilendir
      updateUsers(roomId);
    } catch (error) {
      console.error('Odadan ayrılma hatası:', error);
    }
  });

  // Odadaki kullanıcı listesini güncelle
  function updateUsers(roomId) {
    try {
      if (!roomId) {
        console.error('updateUsers: roomId belirtilmemiş');
        return;
      }
      
      const room = io.sockets.adapter.rooms.get(roomId);
      if (!room) {
        console.error(`updateUsers: ${roomId} odası bulunamadı`);
        return;
      }
      
      console.log(`${roomId} odasındaki soket sayısı: ${room.size}`);
      
      // Odadaki geçerli kullanıcıları al
      const usersList = [];
      let invalidUsers = 0;
      
      room.forEach((socketId) => {
        const userSocket = io.sockets.sockets.get(socketId);
        if (userSocket) {
          if (!userSocket.userData) {
            console.warn(`Soket (${socketId}) var ama userData yok:`, userSocket.id);
            invalidUsers++;
            return;
          }
          
          // Eksik verileri kontrol et - sadece geçerli kullanıcıları listeye ekle
          if (userSocket.userData.id && userSocket.userData.name) {
            usersList.push({
              id: userSocket.userData.id,
              name: userSocket.userData.name,
              isHost: !!userSocket.userData.isHost,
              isMuted: !!userSocket.userData.isMuted,
              noiseSuppression: userSocket.userData.noiseSuppression || 'normal'
            });
          } else {
            console.warn('Geçersiz kullanıcı verisi:', userSocket.userData);
            invalidUsers++;
          }
        } else {
          console.warn(`${socketId} soketine ait kullanıcı bulunamadı`);
          invalidUsers++;
        }
      });
      
      console.log(`Oda (${roomId}) kullanıcı listesi güncellendi: ${usersList.length} kullanıcı, ${invalidUsers} geçersiz kullanıcı`);
      
      // Boş liste kontrolü
      if (usersList.length === 0) {
        console.warn(`${roomId} odasında geçerli kullanıcı bulunamadı!`);
      }
      
      // Kullanıcı listesini odadaki herkese bildir
      io.to(roomId).emit('users-updated', usersList);
    } catch (error) {
      console.error('Kullanıcı listesi güncelleme hatası:', error);
    }
  }

  // Kullanıcı ekran paylaşmaya başladığında
  socket.on('screen-share-started', ({ roomId, userId, userName, hasAudio }) => {
    console.log(`${socket.userData?.name || 'Bir kullanıcı'} ekran paylaşımı başlattı (ses: ${hasAudio ? 'var' : 'yok'})`);
    
    // Kullanıcı bilgilerini güncelle
    if (socket.userData) {
      socket.userData.isSharing = true;
      socket.userData.hasAudio = hasAudio;
    }
    
    // Kendisine doğrulama gönder
    socket.emit('screen-share-confirmed', {
      userId: userId || socket.id,
      userName: socket.userData?.name || userName,
      startTime: Date.now(),
      streamId: `stream_${socket.id}_${Date.now()}`,
      hasAudio
    });
    
    // Diğerlerine bildir
    socket.to(roomId).emit('screen-share-started', {
      userId: userId || socket.id,
      userName: socket.userData?.name || userName,
      startTime: Date.now(),
      streamId: `stream_${socket.id}_${Date.now()}`,
      hasAudio
    });
    
    // Odadaki tüm kullanıcıları güncelle ve herkese bildir
    const users = getUsers(roomId);
    io.to(roomId).emit('user-joined', users);
    
    // Tüm kullanıcılara yeni bağlantı kurmaları için bildirim
    triggerReconnect(roomId, socket.id);
  });

  // Doğrudan medya bilgilerinin paylaşılması için yeni endpoint
  socket.on('media-stream-info', ({ roomId, constraints, streamId }) => {
    console.log(`Medya akışı bilgisi paylaşılıyor (${roomId}), stream: ${streamId}`);
    
    try {
      // Kullanıcının paylaşım yapacağı bilgisini sakla
      if (socket.userData) {
        socket.userData.mediaStreamInfo = {
          streamId: streamId,
          constraints: constraints,
          timestamp: Date.now()
        };
      }
      
      // Odadaki diğer kullanıcılara bildir
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

  // Ekran paylaşım hazır bildirimi - yeni
  socket.on('screen-share-ready', ({ roomId, offerOptions }) => {
    console.log(`${socket.userData?.name || 'Bir kullanıcı'} ekran paylaşım sinyalini hazır bildirdi`);
    
    // Odadaki diğer kullanıcılara bildir
    socket.to(roomId).emit('prepare-for-screen-share', {
      fromId: socket.id,
      userName: socket.userData?.name || 'Bilinmeyen Kullanıcı',
      offerOptions: offerOptions || {
        offerToReceiveVideo: true,
        offerToReceiveAudio: false
      }
    });
  });

  // Yeni direkt bağlantı mekanizması
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

  // Kullanıcı listesi güncelleme isteği
  socket.on('request-user-list', ({ roomId }) => {
    console.log(`${socket.userData?.name || 'Bir kullanıcı'} kullanıcı listesi güncellemesi istedi (${roomId})`);
    
    // Odadaki güncel kullanıcı listesini al
    const users = getUsers(roomId);
    
    // İsteyen kullanıcıya gönder
    socket.emit('user-joined', users);
    
    // Diğer kullanıcılara da gönder (isteğe bağlı)
    socket.to(roomId).emit('user-joined', users);
    
    console.log(`Kullanıcı listesi güncellendi ve gönderildi (${roomId}):`, users);
  });

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
    
    // Kullanıcının odasını bul
    const userData = socket.userData;
    if (userData && userData.roomId) {
      const roomId = userData.roomId;
      console.log(`${socket.id} (${userData.name}) kullanıcısı ${roomId} odasından ayrıldı`);
      
      // Odadan ayrıl
      socket.leave(roomId);
      
      // Socket'in user data'sını temizle
      socket.userData = null;
      
      // Odayı güncelle ve diğerlerine bildir
      updateUsers(roomId);
      
      // user-left olayını da gönder
      io.to(roomId).emit('user-left', { 
        userId: userData.id, 
        userName: userData.name 
      });
    } else {
      console.warn('Ayrılan kullanıcının oda bilgisi bulunamadı:', socket.id);
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

// Belirtilen odadaki tüm kullanıcıları getir
function getUsers(roomId) {
  const users = [];
  const room = io.sockets.adapter.rooms.get(roomId);
  
  if (room) {
    room.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket && socket.userData) {
        users.push({
          id: socket.userData.id || socket.id,
          name: socket.userData.name,
          isHost: socket.userData.isHost || false,
          isSharing: socket.userData.isSharing || false,
          isMuted: socket.userData.isMuted !== undefined ? socket.userData.isMuted : true,
          hasAudio: socket.userData.hasAudio !== undefined ? socket.userData.hasAudio : true,
          noiseSuppression: socket.userData.noiseSuppression || 'medium',
          connected: socket.userData.connected !== undefined ? socket.userData.connected : true
        });
      }
    });
  }
  
  return users;
}

server.listen(PORT, () => {
  console.log(`Socket.io sunucusu ${PORT} portunda çalışıyor`);
});
