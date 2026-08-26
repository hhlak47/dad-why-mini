const config = require('./config.js')

App({
  globalData: {
    config: config
  },
  onLaunch() {
    if (config.BACKEND_MODE === 'cloud') {
      if (!wx.cloud) {
        console.error('当前基础库版本过低，请使用 2.2.3 或以上基础库以使用云能力')
        wx.showModal({
          title: '基础库版本过低',
          content: '请使用 2.2.3 或以上基础库以使用云能力',
          showCancel: false
        })
        return
      }
      const env = config.CLOUD_ENV
      // 若仍是占位符或为空，则不指定 env，使用云控制台中设为“默认环境”的那个
      // （新创建的免费云环境默认即为默认环境，这样即使不填具体 ID 也能跑）
      if (env && env !== 'your-cloud-env-id') {
        wx.cloud.init({ env, traceUser: true })
        console.log('[云开发] 已初始化，环境 ID：', env)
      } else {
        console.warn('[云开发] CLOUD_ENV 未配置，将使用云控制台的“默认环境”。如有多套环境，请在 config.js 填具体环境 ID。')
        wx.cloud.init({ traceUser: true })
        // 在开发版弹出提示，避免用户忘记填环境 ID
        if (wx.getAccountInfoSync && wx.getAccountInfoSync().miniProgram.envVersion === 'develop') {
          wx.showModal({
            title: '请配置云环境 ID',
            content: 'config.js 中的 CLOUD_ENV 仍是占位符，建议填写真实云环境 ID 以避免调用失败。',
            showCancel: false
          })
        }
      }
    }
  }
})
