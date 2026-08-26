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
        const msg = (err && err.message) || '识别失败'
        if (msg.indexOf('未配置腾讯云') !== -1) {
          wx.showToast({ title: '语音功能未配置', icon: 'none' })
        } else {
          wx.showToast({ title: '识别失败，请重试', icon: 'none' })
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
  }
})
