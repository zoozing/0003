// index.js
const app = getApp();
let recorderManager = wx.getRecorderManager();
let innerAudioContext = wx.createInnerAudioContext();
let websocket = null;

Page({
  data: {
    motto: 'Hello World',
    userInfo: {
      avatarUrl: 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0',
      nickName: '',
    },
    hasUserInfo: false,
    canIUseGetUserProfile: wx.canIUse('getUserProfile'),
    canIUseNicknameComp: wx.canIUse('input.type.nickname'),
    textContent: '',
    isRecording: false,
    messages: [],
    wsConnected: false,
    recording: false,
    playing: false,
    inputContent: '',
    classList: [],
    selectedClasses: [],
    selectedClass: null,
    onlineClasses: {},
    teacherToken: '',
    displayModes: [
      {name: '顶部横幅', value: 'banner', checked: true},
      {name: '全屏显示', value: 'fullscreen', checked: false},
      {name: '弹窗显示', value: 'popup', checked: false}
    ],
    selectedDisplayMode: 'banner',
    isScheduled: false,
    scheduledTime: '',
    scheduledDate: '',
    showScheduleOptions: false
  },
  bindViewTap() {
    wx.navigateTo({
      url: '../logs/logs'
    })
  },
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail
    const { nickName } = this.data.userInfo
    this.setData({
      "userInfo.avatarUrl": avatarUrl,
      hasUserInfo: nickName && avatarUrl && avatarUrl !== 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0',
    })
  },
  onInputChange(e) {
    this.setData({
      inputContent: e.detail.value.trim()
    });
  },
  getUserProfile(e) {
    // 推荐使用wx.getUserProfile获取用户信息，开发者每次通过该接口获取用户个人信息均需用户确认，开发者妥善保管用户快速填写的头像昵称，避免重复弹窗
    wx.getUserProfile({
      desc: '展示用户信息', // 声明获取用户个人信息后的用途，后续会展示在弹窗中，请谨慎填写
      success: (res) => {
        console.log(res)
        this.setData({
          userInfo: res.userInfo,
          hasUserInfo: true
        })
      }
    })
  },
  onLoad() {
    // 检查登录状态
    const token = wx.getStorageSync('teacherToken');
    if (!token) {
      wx.reLaunch({
        url: '/pages/login/login'
      });
      return;
    }

    // 获取班级列表
    const classes = wx.getStorageSync('teacherClasses') || [];
    this.setData({
      classList: classes,
      teacherToken: token
    });

    this.connectWebSocket();
    this.initRecorder();
  },
  onUnload() {
    if (websocket) {
      websocket.close();
    }
  },
  connectWebSocket() {
    const token = wx.getStorageSync('teacherToken');
    if (!token) return;

    // 先关闭之前的连接
    if (websocket) {
      websocket.close();
    }

    // 使用本地IP地址和端口
    websocket = wx.connectSocket({
      url: `ws://192.168.1.3:3000?token=${token}`,
      success: () => {
        console.log('WebSocket连接成功');
      },
      fail: (error) => {
        console.error('WebSocket连接失败:', error);
      }
    });

    websocket.onOpen(() => {
      console.log('WebSocket连接已打开');
      this.setData({ wsConnected: true });
      
      // 发送身份验证信息
      const classes = wx.getStorageSync('teacherClasses') || [];
      websocket.send({
        data: JSON.stringify({
          type: 'identity',
          role: 'teacher',
          token: token,
          classes: classes.map(c => c.class_name)
        })
      });
    });

    websocket.onClose(() => {
      console.log('WebSocket连接已断开，5秒后重新连接...');
      this.setData({ wsConnected: false });
      setTimeout(() => this.connectWebSocket(), 5000);
    });

    websocket.onError((error) => {
      console.error('WebSocket错误:', error);
      this.setData({ wsConnected: false });
    });

    // 监听WebSocket接收到服务器的消息
    websocket.onMessage((res) => {
      try {
        const data = JSON.parse(res.data);
        if (data.type === 'history') {
          // 处理历史消息
          this.setData({
            messages: data.messages.map(msg => ({
              type: msg.type,
              content: msg.content,
              time: new Date(msg.created_at).toLocaleTimeString(),
              sender: msg.sender_token,
              senderRole: msg.sender_role,
              senderDescription: msg.sender_description
            }))
          });
        } else if (data.type === 'text' || data.type === 'audio') {
          // 处理新消息
          const messages = this.data.messages;
          messages.unshift({
            type: data.type,
            content: data.content,
            time: new Date(data.created_at).toLocaleTimeString(),
            sender: data.sender,
            senderRole: data.senderRole,
            senderDescription: data.senderDescription
          });
          this.setData({ messages });
        } else if (data.type === 'classStatus') {
          // 处理班级在线状态更新
          console.log('收到班级在线状态更新:', data);
          
          // 更新班级列表的在线状态
          const onlineClasses = {...this.data.onlineClasses};
          const status = data.status || {};
          
          Object.keys(status).forEach(className => {
            onlineClasses[className] = status[className] === true;
          });
          
          // 更新classList中每个班级的在线状态
          const classList = this.data.classList.map(classItem => ({
            ...classItem,
            online: onlineClasses[classItem.class_name] === true
          }));
          
          this.setData({ 
            onlineClasses,
            classList
          });
        }
      } catch (error) {
        console.error('解析消息失败:', error);
      }
    });
  },
  initRecorder() {
    recorderManager.onStart(() => {
      console.log('录音开始');
      this.setData({ isRecording: true });
    });

    recorderManager.onStop((res) => {
      console.log('录音结束', res);
      this.setData({ isRecording: false });
      
      if (this.data.selectedClasses.length === 0) {
        wx.showToast({
          title: '请先选择班级',
          icon: 'none'
        });
        return;
      }

      wx.showLoading({
        title: '正在发送...',
      });

      // 上传录音文件
      wx.uploadFile({
        url: 'http://192.168.1.3:3000/upload',
        filePath: res.tempFilePath,
        name: 'audio',
        formData: {
          type: 'audio'
        },
        success: (uploadRes) => {
          try {
            const data = JSON.parse(uploadRes.data);
            console.log('上传成功，返回数据:', data);
            
            // 获取当前选择的显示模式
            const displayMode = this.data.selectedDisplayMode;
            
            // 向每个选中的班级发送消息
            this.data.selectedClasses.forEach(selectedClass => {
              // 发送WebSocket消息
              const message = {
                type: 'audio',
                content: data,
                targetClass: selectedClass.class_name,
                teacherToken: this.data.teacherToken,
                displayMode: displayMode // 添加显示模式
              };

              websocket.send({
                data: JSON.stringify(message),
                success: () => {
                  // 添加到消息列表
                  const messages = this.data.messages;
                  messages.unshift({
                    type: 'audio',
                    content: '[语音消息]',
                    time: new Date().toLocaleTimeString(),
                    targetClass: selectedClass.class_name,
                    displayMode: displayMode // 记录显示模式
                  });
                  this.setData({ messages });
                },
                fail: (error) => {
                  console.error('发送失败:', error);
                  wx.showToast({
                    title: '发送失败',
                    icon: 'none'
                  });
                }
              });
            });

            wx.showToast({
              title: '发送成功',
              icon: 'success'
            });
          } catch (error) {
            console.error('处理上传响应失败:', error);
            wx.showToast({
              title: '发送失败',
              icon: 'none'
            });
          }
        },
        fail: (error) => {
          console.error('上传失败:', error);
          wx.showToast({
            title: '上传失败',
            icon: 'none'
          });
        },
        complete: () => {
          wx.hideLoading();
        }
      });
    });

    recorderManager.onError((error) => {
      console.error('录音错误:', error);
      this.setData({ isRecording: false });
      wx.showToast({
        title: '录音失败',
        icon: 'none'
      });
    });
  },
  sendText() {
    if (this.data.selectedClasses.length === 0) {
      wx.showToast({
        title: '请先选择班级',
        icon: 'none'
      });
      return;
    }

    if (!this.data.inputContent.trim()) {
      wx.showToast({
        title: '请输入广播内容',
        icon: 'none'
      });
      return;
    }

    if (!this.data.wsConnected) {
      wx.showToast({
        title: '未连接到服务器',
        icon: 'none'
      });
      return;
    }

    // 保存当前输入内容和显示模式
    const content = this.data.inputContent;
    const displayMode = this.data.selectedDisplayMode;
    
    // 处理定时发送
    if (this.data.isScheduled && this.data.scheduledTime && this.data.scheduledDate) {
      const delay = this.calculateScheduleDelay();
      
      if (delay <= 0) {
        wx.showToast({
          title: '请选择未来的时间',
          icon: 'none'
        });
        return;
      }
      
      wx.showToast({
        title: `将在${this.data.scheduledDate} ${this.data.scheduledTime}发送`,
        icon: 'success'
      });
      
      // 清空输入框，保留班级选择和显示模式
      this.setData({ inputContent: '' });
      
      // 设置定时器，到时间后发送消息
      setTimeout(() => {
        // 向每个选中的班级发送消息
        this.data.selectedClasses.forEach(selectedClass => {
          this.sendMessageToClass(selectedClass, content, displayMode);
        });
        
        // 播放提示音，提示用户定时消息已发送
        const innerAudioContext = wx.createInnerAudioContext();
        innerAudioContext.src = '/assets/send_sound.mp3'; // 需要预先准备提示音文件
        innerAudioContext.play();
      }, delay);
      
      return;
    }
    
    // 立即发送消息
    // 向每个选中的班级发送消息
    this.data.selectedClasses.forEach(selectedClass => {
      this.sendMessageToClass(selectedClass, content, displayMode);
    });
    
    // 清空输入框
    this.setData({ inputContent: '' });
    
    wx.showToast({
      title: '发送成功',
      icon: 'success'
    });
  },
  
  // 提取发送消息到班级的函数
  sendMessageToClass(selectedClass, content, displayMode) {
    const message = {
      type: 'text',
      content: content,
      targetClass: selectedClass.class_name,
      teacherToken: this.data.teacherToken,
      displayMode: displayMode // 添加显示模式
    };

    websocket.send({
      data: JSON.stringify(message),
      success: () => {
        // 添加到消息列表
        const messages = this.data.messages;
        messages.unshift({
          type: 'text',
          content: content,
          time: new Date().toLocaleTimeString(),
          targetClass: selectedClass.class_name,
          displayMode: displayMode // 记录显示模式
        });
        this.setData({ messages });
      },
      fail: (error) => {
        console.error('发送失败:', error);
        wx.showToast({
          title: '发送失败',
          icon: 'none'
        });
      }
    });
  },
  startRecording() {
    if (this.data.selectedClasses.length === 0) {
      wx.showToast({
        title: '请先选择班级',
        icon: 'none'
      });
      return;
    }

    // 检查录音权限
    wx.authorize({
      scope: 'scope.record',
      success: () => {
        recorderManager.start({
          duration: 60000,
          sampleRate: 44100,
          numberOfChannels: 1,
          encodeBitRate: 192000,
          format: 'mp3'
        });
      },
      fail: () => {
        wx.showToast({
          title: '请授权录音权限',
          icon: 'none'
        });
      }
    });
  },
  stopRecording() {
    recorderManager.stop();
  },
  logout() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          // 清除登录信息
          wx.removeStorageSync('teacherToken');
          wx.removeStorageSync('teacherClasses');
          // 关闭WebSocket连接
          if (websocket) {
            websocket.close();
          }
          // 跳转到登录页
          wx.reLaunch({
            url: '/pages/login/login'
          });
        }
      }
    });
  },
  // 选择班级
  selectClass(e) {
    const selectedClass = e.currentTarget.dataset.class;
    const selectedClasses = [...this.data.selectedClasses];
    const index = selectedClasses.findIndex(item => item.class_name === selectedClass.class_name);
    
    if (index === -1) {
      // 如果未选中,则添加到选中列表
      selectedClasses.push(selectedClass);
    } else {
      // 如果已选中,则从选中列表中移除
      selectedClasses.splice(index, 1);
    }
    
    // 更新选中状态，同时保留在线状态
    const classList = this.data.classList.map(item => ({
      ...item,
      selected: selectedClasses.some(selected => selected.class_name === item.class_name)
    }));
    
    this.setData({ 
      selectedClasses,
      classList
    });
    
    // 显示已选择的班级数量
    wx.showToast({
      title: `已选择 ${selectedClasses.length} 个班级`,
      icon: 'none',
      duration: 1000
    });
  },
  
  // 处理显示模式变更
  onDisplayModeChange(e) {
    const value = e.detail.value;
    const displayModes = this.data.displayModes.map(item => ({
      ...item,
      checked: item.value === value
    }));
    
    this.setData({
      selectedDisplayMode: value,
      displayModes
    });
    
    wx.showToast({
      title: `已选择${displayModes.find(item => item.value === value).name}`,
      icon: 'none',
      duration: 1000
    });
  },
  
  // 切换定时发送选项
  toggleSchedule(e) {
    const isScheduled = e.detail.value;
    this.setData({
      isScheduled
    });
    
    // 如果启用定时发送但没有设置时间，则设置默认时间
    if (isScheduled) {
      // 默认设置为当前日期和当前时间后5分钟
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');
      const day = now.getDate().toString().padStart(2, '0');
      
      now.setMinutes(now.getMinutes() + 5);
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      
      this.setData({
        scheduledDate: `${year}-${month}-${day}`,
        scheduledTime: `${hours}:${minutes}`
      });
    }
  },
  
  // 日期选择变更
  onDateChange(e) {
    this.setData({
      scheduledDate: e.detail.value
    });
  },
  
  // 时间选择变更
  onTimeChange(e) {
    this.setData({
      scheduledTime: e.detail.value
    });
  },
  
  // 计算定时发送的延迟时间（毫秒）
  calculateScheduleDelay() {
    if (!this.data.isScheduled || !this.data.scheduledTime || !this.data.scheduledDate) {
      return 0; // 不是定时发送或未设置时间和日期
    }
    
    const [year, month, day] = this.data.scheduledDate.split('-').map(Number);
    const [hours, minutes] = this.data.scheduledTime.split(':').map(Number);
    
    const scheduledTime = new Date();
    scheduledTime.setFullYear(year, month - 1, day);
    scheduledTime.setHours(hours, minutes, 0, 0);
    
    const now = new Date();
    const delay = scheduledTime.getTime() - now.getTime();
    
    // 如果时间已过，则返回负值表示无效
    if (delay < 0) {
      return -1;
    }
    
    return delay;
  }
})
