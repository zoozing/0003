const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { adminOperations, tokenOperations } = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// JWT密钥
const JWT_SECRET = 'your-secret-key';

// 中间件：验证JWT token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// 确保上传目录存在
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// 配置文件上传
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        console.log('Uploading file:', file);
        cb(null, Date.now() + '.mp3');
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        console.log('File type:', file.mimetype);
        cb(null, true);
    }
});

app.use(cors({
    exposedHeaders: ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']
}));
app.use(express.json());

// 修改静态文件服务配置
app.use(express.static(path.join(__dirname, 'public')));

// 为音频文件设置正确的MIME类型和其他必要的头信息
app.get('/uploads/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'public/uploads', filename);
    
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
        console.log('File not found:', filePath);
        return res.status(404).send('File not found');
    }

    // 设置响应头
    res.set({
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
    });

    // 发送文件
    res.sendFile(filePath);
});

// 添加文件上传路由
app.post('/upload', (req, res) => {
    console.log('Received upload request');
    upload.single('audio')(req, res, function (err) {
        if (err) {
            console.error('Upload error:', err);
            return res.status(500).json({ error: err.message });
        }
        
        if (!req.file) {
            console.error('No file uploaded');
            return res.status(400).json({ error: 'No file uploaded' });
        }

        console.log('File uploaded successfully:', req.file);
        // 返回不带引号的相对路径
        const audioPath = `/uploads/${req.file.filename}`;
        console.log('Returning audio path:', audioPath);
        res.json(audioPath);
    });
});

// 存储在线班级状态
const onlineClasses = new Set();

// 存储WebSocket连接
const connections = {
  teachers: new Map(),
  classes: new Map(),
  admins: new Map()  // 添加管理员连接存储
};

// 添加消息缓存
const messageCache = {
  // 班级消息缓存，格式: { className: { messages: [...], lastUpdated: timestamp } }
  classes: {},
  // 获取班级缓存的消息
  getMessages: function(className) {
    return this.classes[className]?.messages || null;
  },
  // 设置班级缓存的消息
  setMessages: function(className, messages) {
    this.classes[className] = {
      messages: messages,
      lastUpdated: Date.now()
    };
  },
  // 检查缓存是否有效（10分钟内的缓存视为有效）
  isValid: function(className) {
    const cache = this.classes[className];
    if (!cache) return false;
    
    // 缓存10分钟内有效
    const TEN_MINUTES = 10 * 60 * 1000;
    return (Date.now() - cache.lastUpdated) < TEN_MINUTES;
  },
  // 当有新消息时，更新缓存
  updateCache: function(className, newMessage) {
    if (!this.classes[className]) {
      this.classes[className] = { messages: [newMessage], lastUpdated: Date.now() };
      return;
    }
    
    // 将新消息添加到缓存的开头（因为是按时间降序）
    this.classes[className].messages.unshift(newMessage);
    this.classes[className].lastUpdated = Date.now();
    
    // 保持缓存大小不超过50条
    if (this.classes[className].messages.length > 50) {
      this.classes[className].messages = this.classes[className].messages.slice(0, 50);
    }
  }
};

// 广播班级状态更新
function broadcastClassStatus() {
  const status = {};
  for (const className of onlineClasses) {
    status[className] = true;
  }
  
  // 向所有教师发送班级状态更新
  for (const [ws, _] of connections.teachers) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'classStatus',
          status: status
        }));
      }
    } catch (error) {
      console.error('发送状态更新失败:', error);
    }
  }

  // 向所有管理员发送班级状态更新
  for (const [ws, _] of connections.admins) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'classStatus',
          status: status
        }));
      }
    } catch (error) {
      console.error('发送管理员状态更新失败:', error);
    }
  }
}

// WebSocket连接处理
wss.on('connection', async (ws) => {
  console.log('New client connected');
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received message:', data);
      
      // 处理身份识别
      if (data.type === 'identity') {
        if (data.role === 'admin') {
          connections.admins.set(ws, true);
          // 发送当前班级状态
          try {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'classStatus',
                status: Object.fromEntries([...onlineClasses].map(name => [name, true]))
              }));
              console.log('Admin connected, sent class status');
            }
          } catch (error) {
            console.error('发送管理员状态失败:', error);
          }
        } else if (data.role === 'teacher') {
          connections.teachers.set(ws, true);
          // 发送当前班级状态
          try {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'classStatus',
                status: Object.fromEntries([...onlineClasses].map(name => [name, true]))
              }));
              console.log('Teacher connected, sent class status');
            }
          } catch (error) {
            console.error('发送教师状态失败:', error);
          }
        } else if (data.role === 'class') {
          const className = data.class;
          if (className) {
            connections.classes.set(ws, className);
            onlineClasses.add(className);
            console.log(`Class ${className} connected`);
            
            // 使用缓存和延迟加载获取历史消息
            try {
              let history = [];
              
              // 1. 首先尝试从缓存获取
              if (messageCache.isValid(className)) {
                console.log(`使用缓存的历史消息 - 班级: ${className}`);
                history = messageCache.getMessages(className);
              } else {
                // 2. 缓存无效，从数据库获取
                console.log(`从数据库获取历史消息 - 班级: ${className}`);
                history = await tokenOperations.getBroadcastHistory(className);
                
                // 更新缓存
                messageCache.setMessages(className, history);
              }
              
              console.log(`获取班级 ${className} 的历史消息:`, history.length, '条');
              
              // 检查并确保每条历史消息都有正确的显示模式字段
              if (history && history.length > 0) {
                history.forEach((msg, index) => {
                  if (!msg.display_mode) {
                    console.log(`警告: 第${index+1}条历史消息没有显示模式字段，设置为默认值'banner'`);
                    msg.display_mode = 'banner';
                  } else {
                    console.log(`第${index+1}条历史消息的显示模式:`, msg.display_mode, '类型:', typeof msg.display_mode);
                  }
                });
                
                console.log('第一条历史消息的详细信息:', JSON.stringify(history[0]));
              }
              
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'history',
                  messages: history
                }));
                console.log('历史消息已发送到班级', className);
              }
            } catch (error) {
              console.error('发送历史消息失败:', error);
            }
            
            // 广播班级状态更新
            broadcastClassStatus();
          }
        }
      }
      
      // 处理广播消息
      if (data.type === 'text' || data.type === 'audio') {
        console.log('收到广播消息:', data);
        
        // 检查发送者身份（教师或管理员）
        let isAuthorized = false;
        let senderRole = null;
        let senderDescription = null;

        if (data.teacherToken) {
          // 教师发送的消息
          try {
            const decoded = jwt.verify(data.teacherToken, JWT_SECRET);
            if (decoded.role === 'teacher') {
              isAuthorized = true;
              senderRole = 'teacher';
              // 获取教师信息
              const teacherInfo = await tokenOperations.getTeacherByToken(decoded.token);
              senderDescription = teacherInfo ? teacherInfo.description : null;
            }
          } catch (error) {
            console.error('教师token验证失败:', error);
          }
        } else if (data.adminToken) {
          // 管理员发送的消息
          try {
            const decoded = jwt.verify(data.adminToken, JWT_SECRET);
            if (decoded.role === 'admin') {
              isAuthorized = true;
              senderRole = 'admin';
            }
          } catch (error) {
            console.error('管理员token验证失败:', error);
          }
        }

        if (!isAuthorized) {
          console.error('未授权的广播请求');
          return;
        }

        // 首先保存消息到数据库
        try {
          console.log('保存消息到数据库，显示模式:', data.displayMode);
          await tokenOperations.addBroadcastMessage(
            data.type,
            data.content,
            senderRole === 'teacher' ? jwt.verify(data.teacherToken, JWT_SECRET).token : 'admin',
            data.targetClass,
            senderRole,
            senderDescription,
            data.displayMode || 'banner' // 添加显示模式，默认为横幅
          );
          
          // 创建新消息对象
          const newMessage = {
            type: data.type,
            content: data.content,
            sender_token: senderRole === 'teacher' ? jwt.verify(data.teacherToken, JWT_SECRET).token : 'admin',
            sender_role: senderRole,
            sender_description: senderDescription,
            target_class: data.targetClass,
            created_at: new Date().toISOString(),
            display_mode: data.displayMode || 'banner'
          };
          
          // 更新消息缓存
          messageCache.updateCache(data.targetClass, newMessage);
          
        } catch (error) {
          console.error('保存广播消息失败:', error);
          return;  // 如果保存失败，不继续发送
        }

        // 向目标班级的所有连接发送消息
        for (const [clientWs, className] of connections.classes) {
          if (className === data.targetClass && clientWs.readyState === WebSocket.OPEN) {
            try {
              const messageData = {
                type: data.type,
                content: data.content,
                sender: senderRole === 'teacher' ? jwt.verify(data.teacherToken, JWT_SECRET).token : 'admin',
                senderRole: senderRole,
                senderDescription: senderDescription,
                created_at: new Date().toISOString(),  // 添加时间戳
                displayMode: data.displayMode || 'banner' // 使用一致的字段名
              };
              console.log(`向班级 ${className} 发送消息，显示模式: ${messageData.displayMode}，类型: ${typeof messageData.displayMode}`);
              clientWs.send(JSON.stringify(messageData));
            } catch (error) {
              console.error('发送消息失败:', error);
            }
          }
        }
      }
    } catch (error) {
      console.error('处理消息失败:', error);
    }
  });

  // 处理连接关闭
  ws.on('close', () => {
    // 检查是否是班级连接
    const className = connections.classes.get(ws);
    if (className) {
      connections.classes.delete(ws);
      // 检查该班级是否还有其他连接
      let hasOtherConnection = false;
      for (const [_, otherClassName] of connections.classes) {
        if (otherClassName === className) {
          hasOtherConnection = true;
          break;
        }
      }
      if (!hasOtherConnection) {
        onlineClasses.delete(className);
        try {
          broadcastClassStatus();
        } catch (error) {
          console.error('广播班级状态失败:', error);
        }
        console.log(`Class ${className} disconnected`);
      }
    }
    
    // 移除教师连接
    if (connections.teachers.has(ws)) {
      connections.teachers.delete(ws);
      console.log('Teacher disconnected');
    }

    // 移除管理员连接
    if (connections.admins.has(ws)) {
      connections.admins.delete(ws);
      console.log('Admin disconnected');
    }
  });
});

// 添加定期清理无效缓存的定时任务
setInterval(() => {
  console.log('开始清理过期的消息缓存...');
  let count = 0;
  for (const className in messageCache.classes) {
    if (!messageCache.isValid(className)) {
      delete messageCache.classes[className];
      count++;
    }
  }
  console.log(`清理完成，共移除 ${count} 个过期缓存`);
}, 30 * 60 * 1000); // 每30分钟执行一次

// 管理员登录
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const isValid = await adminOperations.verifyAdmin(username, password);
        if (isValid) {
            const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
            res.json({ token });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// 教师登录（验证口令）
app.post('/api/teacher/login', async (req, res) => {
    const { token } = req.body;
    console.log('收到教师登录请求，口令:', token);
    
    try {
        const isValid = await tokenOperations.verifyTeacherToken(token);
        console.log('口令验证结果:', isValid);
        
        if (isValid) {
            // 获取教师绑定的班级列表
            const classes = await tokenOperations.getTeacherClasses(token);
            const jwtToken = jwt.sign({ 
                role: 'teacher',
                token: token,
                classes: classes.map(c => c.class_name)
            }, JWT_SECRET, { expiresIn: '24h' });
            
            console.log('生成JWT令牌成功');
            res.json({ 
                token: jwtToken,
                classes: classes
            });
        } else {
            console.log('口令无效');
            res.status(401).json({ error: '口令无效' });
        }
    } catch (error) {
        console.error('服务器错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

// 班级登录（验证口令）
app.post('/api/class/login', async (req, res) => {
    const { token } = req.body;
    try {
        const classInfo = await tokenOperations.verifyClassToken(token);
        if (classInfo) {
            const jwtToken = jwt.sign({ 
                role: 'class',
                className: classInfo.class_name
            }, JWT_SECRET, { expiresIn: '24h' });
            res.json({ token: jwtToken, className: classInfo.class_name });
        } else {
            res.status(401).json({ error: 'Invalid token' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// 管理员API：获取所有教师口令
app.get('/api/admin/teacher-tokens', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        const tokens = await tokenOperations.getAllTeacherTokens();
        res.json(tokens);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// 管理员API：获取所有班级口令
app.get('/api/admin/class-tokens', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        const tokens = await tokenOperations.getAllClassTokens();
        res.json(tokens);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// 管理员API：添加教师口令
app.post('/api/admin/teacher-tokens', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const { token, description } = req.body;
    try {
        await tokenOperations.addTeacherToken(token, description);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// 管理员API：添加班级口令
app.post('/api/admin/class-tokens', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const { className, token, description } = req.body;
    try {
        await tokenOperations.addClassToken(className, token, description);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// 管理员API：删除教师口令
app.delete('/api/admin/teacher-tokens/:id', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        await tokenOperations.deleteTeacherToken(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// 管理员API：删除班级口令
app.delete('/api/admin/class-tokens/:id', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        await tokenOperations.deleteClassToken(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// 添加获取班级列表的API
app.get('/api/teacher/classes', authenticateToken, async (req, res) => {
    if (req.user.role !== 'teacher') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        const classes = await tokenOperations.getAllClassTokens();
        res.json(classes.map(c => ({
            id: c.id,
            className: c.class_name,
            description: c.description
        })));
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// 管理员API：更新教师口令
app.put('/api/admin/teacher-tokens/:id', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const { token, description } = req.body;
    try {
        await tokenOperations.updateTeacherToken(req.params.id, token, description);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// 管理员API：更新班级口令
app.put('/api/admin/class-tokens/:id', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const { class_name, token, description } = req.body;
    try {
        await tokenOperations.updateClassToken(req.params.id, class_name, token, description);
        res.json({ success: true });
    } catch (error) {
        console.error('更新班级口令失败:', error);
        res.status(500).json({ error: error.message || 'Server error' });
    }
});

// 管理员API：获取所有教师-班级绑定
app.get('/api/admin/teacher-class-bindings', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        const bindings = await tokenOperations.getAllBindings();
        res.json(bindings);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// 管理员API：添加教师-班级绑定
app.post('/api/admin/teacher-class-bindings', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const { teacherId, classId } = req.body;
    try {
        await tokenOperations.addBinding(teacherId, classId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// 管理员API：删除教师-班级绑定
app.delete('/api/admin/teacher-class-bindings/:id', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        await tokenOperations.deleteBinding(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// 管理员API：获取广播消息记录
app.get('/api/admin/broadcast-messages', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
        const messages = await tokenOperations.getBroadcastMessages();
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
}); 