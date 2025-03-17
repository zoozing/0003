# 班级广播系统

一个基于 WebSocket 的实时班级广播系统，支持文字和语音广播。

## 项目结构

项目分为两个主要部分：

### web 文件夹
包含服务器端、管理后台和班级接收端：
- `server/`: Node.js + Express 服务器
  - `public/admin/`: 管理员界面
  - `public/class/`: 班级接收端界面
  - `db.js`: 数据库操作
  - `server.js`: 服务器入口

### wechat 文件夹
包含微信小程序客户端（教师端）：
- `pages/`: 小程序页面
  - `login/`: 登录页面
  - `index/`: 广播发送页面
- `utils/`: 工具函数
- 应用配置文件: app.js, app.json, app.wxss等

## 功能特点

* 实时文字广播
* 语音广播
* 历史消息查看
* 按日期和内容搜索
* 多班级支持
* 教师和管理员权限分离

## 技术栈

* 前端：微信小程序（教师端）、HTML5（班级端）
* 后端：Node.js + Express
* 数据库：SQLite3
* 实时通信：WebSocket

## 安装步骤

1. 启动服务器

```
cd web/server
npm install
node server.js
```

2. 配置微信小程序（教师端）
* 在微信开发者工具中导入wechat目录
* 修改 `project.config.json` 中的 appid
* 修改 `pages/index/index.js` 中的服务器地址

## 使用说明

### 管理员

1. 访问 `/admin` 页面
2. 使用默认账号 admin / admin123 登录
3. 管理教师和班级口令
4. 查看广播历史记录

### 教师

1. 使用微信小程序扫码登录
2. 选择目标班级
3. 发送文字或语音广播

### 班级

1. 访问 `/class` 页面
2. 输入班级口令登录
3. 实时接收广播消息

## 注意事项

1. 首次使用请修改管理员默认密码
2. 定期清理上传的音频文件
3. 建议定期备份数据库

## 许可证

MIT License 