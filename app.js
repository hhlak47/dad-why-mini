const config = require('./config.js')

App({
  globalData: {
    config: config
  },
  onLaunch() {
    if (config.BACKEND_MODE === 'cloud') {
      if (!wx.cloud) {
        console.error('当前基础库版本过低，请使用 2.2.3 或以上基础库以使用云能力')
        return
      }
      wx.cloud.init({
        env: config.CLOUD_ENV,
        traceUser: true
      })
    }
  }
})
