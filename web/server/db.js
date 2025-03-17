const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

// 数据库连接
let db = null;

// 获取数据库连接
async function getDb() {
    if (db) return db;
    
    return new Promise((resolve, reject) => {
        const dbPath = path.join(__dirname, 'database.sqlite');
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Error connecting to database:', err);
                reject(err);
            } else {
                console.log('Connected to database');
                resolve(db);
            }
        });
    });
}

// 初始化数据库表
async function initDatabase() {
    const db = await getDb();
    
    // 创建管理员表
    await new Promise((resolve, reject) => {
        db.run(`CREATE TABLE IF NOT EXISTS admin (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )`, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });

    // 创建教师口令表
    await new Promise((resolve, reject) => {
        db.run(`CREATE TABLE IF NOT EXISTS teacher_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT UNIQUE NOT NULL,
            description TEXT
        )`, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });

    // 创建班级口令表
    await new Promise((resolve, reject) => {
        db.run(`CREATE TABLE IF NOT EXISTS class_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            class_name TEXT NOT NULL,
            token TEXT UNIQUE NOT NULL,
            description TEXT
        )`, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });

    // 教师-班级绑定表
    await new Promise((resolve, reject) => {
        db.run(`CREATE TABLE IF NOT EXISTS teacher_class_bindings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            teacher_token_id INTEGER NOT NULL,
            class_token_id INTEGER NOT NULL,
            FOREIGN KEY (teacher_token_id) REFERENCES teacher_tokens(id),
            FOREIGN KEY (class_token_id) REFERENCES class_tokens(id),
            UNIQUE(teacher_token_id, class_token_id)
        )`, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });

    // 创建广播消息记录表
    await new Promise((resolve, reject) => {
        // 这里不能使用DROP TABLE，因为这会删除所有现有数据
        // 我们应该先检查是否需要修改表
        db.all(`PRAGMA table_info(broadcast_messages)`, async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            
            // 如果表不存在或者需要添加display_mode字段
            let needToCreateTable = false;
            let needToAddDisplayMode = false;
            
            if (!rows || rows.length === 0) {
                needToCreateTable = true;
            } else {
                // 检查是否存在display_mode字段
                const hasDisplayMode = rows.some(row => row.name === 'display_mode');
                if (!hasDisplayMode) {
                    needToAddDisplayMode = true;
                }
            }
            
            if (needToCreateTable) {
                db.run(`CREATE TABLE IF NOT EXISTS broadcast_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    sender_token TEXT NOT NULL,
                    sender_role TEXT NOT NULL,
                    sender_description TEXT,
                    target_class TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    display_mode TEXT DEFAULT 'banner',
                    FOREIGN KEY (target_class) REFERENCES class_tokens (class_name)
                )`, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            } else if (needToAddDisplayMode) {
                // 如果表已存在但需要添加display_mode字段
                db.run(`ALTER TABLE broadcast_messages ADD COLUMN display_mode TEXT DEFAULT 'banner'`, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            } else {
                resolve(); // 表已经是最新的
            }
        });
    });

    // 为广播消息表添加索引
    await new Promise((resolve, reject) => {
        db.run(`CREATE INDEX IF NOT EXISTS idx_broadcast_messages_target 
               ON broadcast_messages(target_class, created_at DESC)`, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });

    // 检查是否需要创建默认管理员账户
    const admin = await new Promise((resolve, reject) => {
        db.get("SELECT * FROM admin WHERE username = ?", ['admin'], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

    if (!admin) {
        // 创建默认管理员账户
        const defaultPassword = 'admin123';
        const hash = await bcrypt.hash(defaultPassword, 10);
        await new Promise((resolve, reject) => {
            db.run('INSERT INTO admin (username, password) VALUES (?, ?)', 
                ['admin', hash], 
                (err) => {
                    if (err) reject(err);
                    else {
                        console.log('Created default admin account');
                        resolve();
                    }
                }
            );
        });
    }
}

// 初始化数据库
initDatabase().catch(console.error);

// 管理员相关操作
const adminOperations = {
    // 验证管理员登录
    verifyAdmin: (username, password) => {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM admin WHERE username = ?', [username], (err, row) => {
                if (err) reject(err);
                if (!row) resolve(false);
                else {
                    bcrypt.compare(password, row.password, (err, result) => {
                        if (err) reject(err);
                        resolve(result);
                    });
                }
            });
        });
    },
    
    // 更改管理员密码
    changePassword: (username, newPassword) => {
        return new Promise((resolve, reject) => {
            bcrypt.hash(newPassword, 10, (err, hash) => {
                if (err) reject(err);
                db.run('UPDATE admin SET password = ? WHERE username = ?',
                    [hash, username],
                    (err) => {
                        if (err) reject(err);
                        resolve(true);
                    }
                );
            });
        });
    }
};

// 口令相关操作
const tokenOperations = {
    // 添加教师口令
    addTeacherToken: (token, description) => {
        return new Promise((resolve, reject) => {
            db.run('INSERT INTO teacher_tokens (token, description) VALUES (?, ?)',
                [token, description],
                (err) => {
                    if (err) reject(err);
                    resolve(true);
                }
            );
        });
    },

    // 添加班级口令
    addClassToken: (className, token, description) => {
        return new Promise((resolve, reject) => {
            db.run('INSERT INTO class_tokens (class_name, token, description) VALUES (?, ?, ?)',
                [className, token, description],
                (err) => {
                    if (err) reject(err);
                    resolve(true);
                }
            );
        });
    },

    // 验证教师口令
    verifyTeacherToken: (token) => {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM teacher_tokens WHERE token = ?', [token], (err, row) => {
                if (err) reject(err);
                resolve(!!row);
            });
        });
    },

    // 验证班级口令
    verifyClassToken: (token) => {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM class_tokens WHERE token = ?', [token], (err, row) => {
                if (err) reject(err);
                resolve(row || null);
            });
        });
    },

    // 获取所有教师口令
    getAllTeacherTokens: () => {
        return new Promise((resolve, reject) => {
            db.all('SELECT * FROM teacher_tokens ORDER BY created_at DESC', (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            });
        });
    },

    // 获取所有班级口令
    getAllClassTokens: () => {
        return new Promise((resolve, reject) => {
            db.all('SELECT * FROM class_tokens ORDER BY created_at DESC', (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            });
        });
    },

    // 删除教师口令
    deleteTeacherToken: (id) => {
        return new Promise((resolve, reject) => {
            db.run('DELETE FROM teacher_tokens WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                resolve(true);
            });
        });
    },

    // 删除班级口令
    deleteClassToken: (id) => {
        return new Promise((resolve, reject) => {
            db.run('DELETE FROM class_tokens WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                resolve(true);
            });
        });
    },

    // 教师-班级绑定操作
    addBinding: (teacherTokenId, classTokenId) => {
        return new Promise((resolve, reject) => {
            db.run("INSERT INTO teacher_class_bindings (teacher_token_id, class_token_id) VALUES (?, ?)",
                [teacherTokenId, classTokenId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    },

    deleteBinding: (id) => {
        return new Promise((resolve, reject) => {
            db.run("DELETE FROM teacher_class_bindings WHERE id = ?", [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    getAllBindings: () => {
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    b.id,
                    tt.token as teacher_token,
                    tt.description as teacher_description,
                    ct.class_name,
                    ct.token as class_token
                FROM teacher_class_bindings b
                JOIN teacher_tokens tt ON b.teacher_token_id = tt.id
                JOIN class_tokens ct ON b.class_token_id = ct.id
                ORDER BY b.created_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    getTeacherClasses: (teacherToken) => {
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    ct.*
                FROM class_tokens ct
                JOIN teacher_class_bindings b ON ct.id = b.class_token_id
                JOIN teacher_tokens tt ON b.teacher_token_id = tt.id
                WHERE tt.token = ?
                ORDER BY ct.class_name
            `, [teacherToken], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    // 更新教师口令
    updateTeacherToken: (id, token, description) => {
        return new Promise((resolve, reject) => {
            db.run('UPDATE teacher_tokens SET token = ?, description = ? WHERE id = ?',
                [token, description, id],
                (err) => {
                    if (err) reject(err);
                    resolve(true);
                }
            );
        });
    },

    // 更新班级口令
    updateClassToken: (id, className, token, description) => {
        return new Promise((resolve, reject) => {
            db.run('UPDATE class_tokens SET class_name = ?, token = ?, description = ? WHERE id = ?',
                [className, token, description, id],
                (err) => {
                    if (err) reject(err);
                    resolve(true);
                }
            );
        });
    },

    // 获取广播消息记录
    getBroadcastMessages: () => {
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    id,
                    type,
                    content,
                    sender_token,
                    sender_role,
                    sender_description,
                    target_class,
                    created_at,
                    display_mode
                FROM broadcast_messages
                ORDER BY created_at DESC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    // 添加广播消息记录
    addBroadcastMessage: (type, content, sender, targetClass, senderRole, senderDescription, displayMode = 'banner') => {
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO broadcast_messages 
                 (type, content, sender_token, target_class, sender_role, sender_description, created_at, display_mode) 
                 VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
                [type, content, sender, targetClass, senderRole, senderDescription, displayMode],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.lastID);
                    }
                }
            );
        });
    },

    // 获取广播消息历史
    getBroadcastHistory: async (targetClass, limit = 50) => {
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    type,
                    content,
                    sender_token,
                    sender_role,
                    sender_description,
                    target_class,
                    created_at,
                    display_mode
                FROM broadcast_messages
                WHERE target_class = ?
                ORDER BY created_at DESC
                LIMIT ?
            `, [targetClass, limit], (err, rows) => {
                if (err) {
                    console.error('获取广播历史失败:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    },

    // 获取教师信息
    getTeacherByToken: (token) => {
        return new Promise((resolve, reject) => {
            db.get(`
                SELECT * FROM teacher_tokens WHERE token = ?
            `, [token], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }
};

module.exports = {
    getDb,
    initDatabase,
    adminOperations,
    tokenOperations
}; 