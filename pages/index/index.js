const storage = require('../../utils/storage.js')
const voice = require('../../utils/voice.js')

Page({
  data: {
    question: '',
    ages: [3, 4, 5, 6],
    age: 4,
    recording: false,
    recognizing: false
  },

  onLoad() {
    // 默认记住上一次选择的孩子年龄
    this.setData({ age: storage.getAge() })
  },

  onInput(e) {
    this.setData({ question: e.detail.value })
  },

  selectAge(e) {
    const age = e.currentTarget.dataset.age
    this.setData({ age })
    storage.setAge(age)
  },

  // 按住说话：开始录音
  startVoice() {
    if (this.data.recording || this.data.recognizing) return
    this.setData({ recording: true })
    voice.startRecord().catch(() => {
      this.setData({ recording: false })
      wx.showToast({ title: '录音启动失败', icon: 'none' })
    })
  },

  // 松手：停止录音并识别文字
  stopVoice() {
    if (!this.data.recording || this.data.recognizing) return
    this.setData({ recording: false, recognizing: true })
    voice.stopRecord()
      .then((b64) => voice.asr(b64))
      .then((text) => {
        this.setData({ recognizing: false })
        if (!text) {
          wx.showToast({ title: '没听清，再说一次～', icon: 'none' })
          return
        }
        const merged = (this.data.question ? this.data.question + ' ' : '') + text
        this.setData({ question: merged })
      })
      .catch((err) => {
        this.setData({ recognizing: false })
        console.error('[语音识别] 失败：', err)
        // 优先使用微信返回的 errMsg/errCode，比 err.message 更具体
        const msg = (err && err.errMsg) || (err && err.message) || '识别失败'
        const code = (err && err.errCode) || ''
        // -504003 = 云函数执行超时（默认 3s 不够 ASR/TTS/AI 用）
        if (code === -504003 || code === '-504003' || msg.indexOf('504003') !== -1 || msg.indexOf('timed out') !== -1) {
          wx.showToast({ title: '云函数超时，请到控制台把 voice 超时改 20 秒', icon: 'none' })
        } else if (msg.indexOf('未配置腾讯云') !== -1) {
          wx.showToast({ title: '语音功能未配置', icon: 'none' })
        } else {
          // 把真实错误前 30 字也带出来，方便排查（复制给开发者即可）
          const detail = (code ? code + ' ' : '') + (msg.length > 30 ? msg.slice(0, 30) + '…' : msg)
          wx.showToast({ title: '识别失败：' + detail, icon: 'none' })
        }
      })
  },

  onSubmit() {
    const q = (this.data.question || '').trim()
    if (!q) {
      wx.showToast({ title: '先告诉我，孩子刚刚问了什么～', icon: 'none' })
      return
    }
    const age = this.data.age
    wx.navigateTo({
      url: `/pages/chat/chat?q=${encodeURIComponent(q)}&age=${age}`
    })
  },

  goVoice() {
    wx.navigateTo({ url: '/pages/voice/voice' })
  }
})
