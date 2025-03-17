Page({
  data: {
    token: ''
  },

  onLoad() {
    // 检查是否已登录
    const token = wx.getStorageSync('teacherToken');
    if (token) {
      // 已登录，跳转到首页
      wx.reLaunch({
        url: '/pages/index/index'
      });
    }
  },

  // 输入框内容变化
  onInput(e) {
    this.setData({
      token: e.detail.value
    });
  },

  // 提交登录
  onSubmit() {
    if (!this.data.token.trim()) {
      wx.showToast({
        title: '请输入口令',
        icon: 'none'
      });
      return;
    }

    wx.showLoading({
      title: '登录中...',
    });

    console.log('正在发送登录请求，口令:', this.data.token);

    wx.request({
      url: 'http://192.168.1.3:3000/api/teacher/login',
      method: 'POST',
      header: {
        'content-type': 'application/json'
      },
      data: {
        token: this.data.token
      },
      success: (res) => {
        console.log('登录响应:', res);
        
        if (res.statusCode === 200 && res.data) {
          // 保存token和班级列表
          wx.setStorageSync('teacherToken', res.data.token);
          wx.setStorageSync('teacherClasses', res.data.classes || []);
          
          wx.showToast({
            title: '登录成功',
            icon: 'success',
            duration: 1500,
            complete: () => {
              setTimeout(() => {
                wx.reLaunch({
                  url: '/pages/index/index'
                });
              }, 1500);
            }
          });
        } else {
          wx.showToast({
            title: res.data?.error || '登录失败',
            icon: 'none'
          });
        }
      },
      fail: (error) => {
        console.error('登录请求失败:', error);
        wx.showToast({
          title: '网络错误，请检查服务器连接',
          icon: 'none'
        });
      },
      complete: () => {
        wx.hideLoading();
      }
    });
  }
}); 