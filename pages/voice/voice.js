// 「我的声音」录制页：父母录音 -> 云端训练专属音色 -> 存到云数据库
const voice = require('../../utils/voice.js')

// 录制引导文本（让父母朗读，提升克隆音质；10~30 秒为宜，约60字，正常语速15-20秒）
const GUIDE_TEXT = '宝贝，我是你的爸爸。今天你想知道什么呢？天上的星星为什么会眨眼睛，小鱼为什么在水里游，我们一起去找答案吧。'

Page({
  data: {
    role: 'dad',
    roleName: '爸爸',
    recording: false,
    cloning: false,
    statusText: '',
    guideText: GUIDE_TEXT,
    dadCloned: false,
    momCloned: false,
    recordSeconds: 0
  },

  onLoad() {
    this.loadVoices()
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer)
  },

  selectRole(e) {
    const role = e.currentTarget.dataset.role
    this.setData({
      role,
      roleName: role === 'dad' ? '爸爸' : '妈妈',
      // 切换角色时同步更新引导文本中的称呼
      guideText: role === 'dad'
        ? GUIDE_TEXT
        : GUIDE_TEXT.replace(/爸爸/g, '妈妈')
    })
  },

  loadVoices() {
    const db = wx.cloud.database()
    db.collection('voices').get()
      .then((res) => {
        const list = res.data || []
        this.setData({
          dadCloned: list.some((v) => v.role === 'dad'),
          momCloned: list.some((v) => v.role === 'mom')
        })
      })
      .catch(() => {})
  },

  toggleRecord() {
    if (this.data.recording) this.stopRecord()
    else this.startRecord()
  },

  startRecord() {
    if (this.data.recording || this.data.cloning) return
    this.setData({ recording: true, statusText: '请朗读上方文字，建议录制15-30秒，读完后点「停止并克隆」', recordSeconds: 0 })
    // 录音计时器，让用户看到已录制时长
    this._timer = setInterval(() => {
      this.setData({ recordSeconds: this.data.recordSeconds + 1 })
    }, 1000)
    voice.startRecord().catch(() => {
      if (this._timer) { clearInterval(this._timer); this._timer = null }
      this.setData({ recording: false, statusText: '', recordSeconds: 0 })
      wx.showToast({ title: '录音启动失败，请检查麦克风权限', icon: 'none' })
    })
  },

  stopRecord() {
    if (!this.data.recording) return
    const seconds = this.data.recordSeconds
    if (this._timer) { clearInterval(this._timer); this._timer = null }

    // 前端先做时长校验，避免不足6秒的音频送到云端必然失败
    if (seconds < 6) {
      this.setData({ recording: false, recordSeconds: 0, statusText: '录音时间太短啦，请至少朗读10秒以上（建议15-30秒）' })
      wx.showToast({ title: '录音至少需要10秒', icon: 'none' })
      // 丢弃这次录音
      voice.stopRecord().catch(() => {})
      return
    }

    this.setData({ recording: false, cloning: true, statusText: '正在训练你的声音，约需十几秒，请稍候…' })
    const role = this.data.role
    const roleName = this.data.roleName
    voice.stopRecord()
      .then((b64) => {
        const voiceName = 'bw_' + role + '_' + Date.now().toString(36)
        return voice.cloneVoice(b64, voiceName, role, this.data.guideText)
      })
      .then((voiceId) => this.saveVoice(voiceId, role, roleName))
      .then(() => {
        this.setData({ cloning: false, statusText: '声音已克隆成功！回到回答页点「念给孩子听」即可用' + roleName + '的声音', recordSeconds: 0 })
        wx.showToast({ title: '克隆成功', icon: 'success' })
        this.loadVoices()
      })
      .catch((err) => {
        this.setData({ cloning: false, statusText: '克隆失败，请重试', recordSeconds: 0 })
        console.error('[clone] 失败:', err)
        const msg = (err && err.message) || '克隆失败'
        wx.showToast({ title: '克隆失败：' + (msg.length > 20 ? msg.slice(0, 20) + '…' : msg), icon: 'none', duration: 4000 })
      })
  },

  saveVoice(voiceId, role, name) {
    const db = wx.cloud.database()
    return db.collection('voices').add({
      data: { role, voiceId, name, createdAt: Date.now() }
    })
  }
})
