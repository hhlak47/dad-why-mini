// 「我的声音」录制页：父母录音 -> 云端训练专属音色 -> 存到云数据库
const voice = require('../../utils/voice.js')

// 录制引导文本（让父母朗读，提升克隆音质；10~30 秒为宜）
const GUIDE_TEXT = '宝贝，我是你的爸爸。今天你想知道什么呢？天上的星星为什么会眨眼睛，小鱼为什么在水里游，我们一起去找答案吧。'

Page({
  data: {
    role: 'dad',
    roleName: '爸爸',
    recording: false,
    cloning: false,
    statusText: '',
    dadCloned: false,
    momCloned: false
  },

  onLoad() {
    this.loadVoices()
  },

  selectRole(e) {
    const role = e.currentTarget.dataset.role
    this.setData({ role, roleName: role === 'dad' ? '爸爸' : '妈妈' })
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
    this.setData({ recording: true, statusText: '请朗读上方文字，读完后点「停止并克隆」' })
    voice.startRecord().catch(() => {
      this.setData({ recording: false, statusText: '' })
      wx.showToast({ title: '录音启动失败', icon: 'none' })
    })
  },

  stopRecord() {
    if (!this.data.recording) return
    this.setData({ recording: false, cloning: true, statusText: '正在训练你的声音，约需十几秒，请稍候…' })
    const role = this.data.role
    const roleName = this.data.roleName
    voice.stopRecord()
      .then((b64) => {
        const voiceName = 'bw_' + role + '_' + Date.now().toString(36)
        return voice.cloneVoice(b64, voiceName, role, GUIDE_TEXT)
      })
      .then((voiceId) => this.saveVoice(voiceId, role, roleName))
      .then(() => {
        this.setData({ cloning: false, statusText: '声音已克隆成功！回到回答页点「念给孩子听」即可用' + roleName + '的声音' })
        wx.showToast({ title: '克隆成功', icon: 'success' })
        this.loadVoices()
      })
      .catch((err) => {
        this.setData({ cloning: false, statusText: '克隆失败，请重试' })
        console.error('[clone] 失败:', err)
        const msg = (err && err.message) || '克隆失败'
        wx.showToast({ title: '克隆失败：' + (msg.length > 20 ? msg.slice(0, 20) + '…' : msg), icon: 'none' })
      })
  },

  saveVoice(voiceId, role, name) {
    const db = wx.cloud.database()
    return db.collection('voices').add({
      data: { role, voiceId, name, createdAt: Date.now() }
    })
  }
})
