# 班级广播系统 - Web组件

本目录包含班级广播系统的服务器端和Web界面部分。

## 目录结构

- `server/`: Node.js + Express 服务器
  - `public/admin/`: 管理员界面
  - `public/class/`: 班级接收端界面
  - `public/uploads/`: 上传的语音文件存储位置
  - `db.js`: 数据库操作函数
  - `server.js`: 服务器主程序

## 主要功能

### 管理员界面 (`/admin`)
- 教师账号管理
- 班级管理
- 广播记录查询
- 系统设置

### 班级接收端 (`/class`)
- 班级登录（通过班级口令）
- 实时接收广播消息
- 文字和语音消息显示
- 历史消息查看

## 安装和启动

1. 安装依赖
```
cd server
npm install
```

2. 启动服务器
```
node server.js
```

默认服务器会运行在 http://localhost:3000

## WebSocket API

系统使用WebSocket进行实时通信，主要有以下几个连接点：

- 教师端连接：`ws://服务器地址:端口?token=教师令牌`
- 班级端连接：`ws://服务器地址:端口?class=班级ID&code=班级口令`

## 数据库

系统使用SQLite3数据库，主要表结构包括：
- 教师表
- 班级表
- 广播消息表
- 系统设置表

数据库文件位于 `server/database.sqlite`。 