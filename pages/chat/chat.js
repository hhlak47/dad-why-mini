const ai = require('../../utils/ai.js')
const voice = require('../../utils/voice.js')

// Loading 文案轮换（PRD 建议避免“AI 正在生成……”）
const LOADING_TEXTS = [
  '我想想，怎么跟小朋友讲……',
  '找一个孩子听得懂的说法……',
  '换个孩子熟悉的比喻……'
]

// 最多连续追问轮数（PRD：MVP 可限制最多连续 5 轮）
const MAX_FOLLOW_ROUNDS = 5

Page({
  data: {
    question: '',
    age: 4,
    messages: [],          // 展示列表：child / answer / game
    context: [],           // 喂给模型的上下文：{ role, content }
    loading: false,
    loadingText: '',
    error: false,
    showFollow: false,
    followText: '',
    followRounds: 0,
    followDisabled: false,
    lastAction: null,      // 用于失败重试
    scrollAnchor: 'anchor-0',
    _mid: 0,
    _aid: 0,
    _timer: null
  },

  onLoad(options) {
    const question = decodeURIComponent(options.q || '')
    const age = parseInt(options.age || '4', 10)
    this.setData({ question, age })
    // 进入即触发第一次“讲给孩子听”
    this.runAction('answer', {})
  },

  onUnload() {
    this._clearTimer()
  },

  _clearTimer() {
    if (this.data._timer) {
      clearInterval(this.data._timer)
      this.setData({ _timer: null })
    }
  },

  _startLoading() {
    let i = 0
    this.setData({ loading: true, loadingText: LOADING_TEXTS[0], error: false })
    const timer = setInterval(() => {
      i = (i + 1) % LOADING_TEXTS.length
      this.setData({ loadingText: LOADING_TEXTS[i] })
    }, 1800)
    this.setData({ _timer: timer })
  },

  _stopLoading() {
    this._clearTimer()
    this.setData({ loading: false })
  },

  _nextId() {
    const id = this.data._mid
    this.setData({ _mid: id + 1 })
    return id
  },

  _scrollBottom() {
    const aid = this.data._aid + 1
    this.setData({ _aid: aid, scrollAnchor: 'anchor-' + aid })
  },

  _lastAnswer() {
    const list = this.data.context
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === 'assistant') return list[i].content
    }
    return ''
  },

  // 统一调用入口
  runAction(action, extra) {
    if (this.data.loading) return
    this._startLoading()

    const payload = {
      action,
      childAge: this.data.age,
      originalQuestion: this.data.question,
      messages: this.data.context,
      followUpQuestion: extra.followUpQuestion || '',
      lastAnswer: extra.lastAnswer || this._lastAnswer()
    }
    this.setData({ lastAction: { action, extra } })

    ai.askAI(payload)
      .then((res) => this._handleResult(res))
      .catch(() => this._handleFail())
  },

  _handleResult(res) {
    this._stopLoading()
    if (!res || res.ok === false) {
      this._handleFail()
      return
    }
    let data = res.data
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch (e) {
        data = { type: 'answer', content: data }
      }
    }
    if (!data || !data.type) {
      data = { type: 'answer', content: String(data) }
    }
    this._appendResult(data)
  },

  _appendResult(data) {
    const id = this._nextId()
    if (data.type === 'game') {
      const gameMsg = {
        id,
        kind: 'game',
        title: data.title || '亲子小游戏',
        duration: data.duration || '3分钟',
        materials: data.materials || '什么都不用',
        steps: data.steps || [],
        question: data.question || ''
      }
      this.setData({ messages: this.data.messages.concat([gameMsg]) })
    } else {
      const content = data.content || ''
      const answerMsg = { id, kind: 'answer', type: data.type, content }
      this.setData({ messages: this.data.messages.concat([answerMsg]) })
      this.setData({ context: this.data.context.concat([{ role: 'assistant', content }]) })
    }
    this._scrollBottom()
  },

  _handleFail() {
    this._stopLoading()
    this.setData({ error: true })
  },

  retry() {
    const last = this.data.lastAction
    if (last) {
      this.runAction(last.action, last.extra)
    }
  },

  onSimpler() {
    this.runAction('simpler', {})
  },

  onFollowTap() {
    if (this.data.followDisabled) return
    this.setData({ showFollow: true })
  },

  onFollowInput(e) {
    this.setData({ followText: e.detail.value })
  },

  cancelFollow() {
    this.setData({ showFollow: false, followText: '' })
  },

  onSubmitFollow() {
    const text = (this.data.followText || '').trim()
    if (!text) {
      wx.showToast({ title: '她又问了什么呀？', icon: 'none' })
      return
    }
    const rounds = this.data.followRounds + 1
    const id = this._nextId()
    this.setData({
      showFollow: false,
      followText: '',
      messages: this.data.messages.concat([{ id, kind: 'child', content: text }]),
      context: this.data.context.concat([{ role: 'child', content: text }]),
      followRounds: rounds,
      followDisabled: rounds >= MAX_FOLLOW_ROUNDS
    })
    this.runAction('followup', { followUpQuestion: text })
  },

  onGame() {
    this.runAction('game', {})
  },

  // 念给孩子听：语音合成并播放
  onSpeak(e) {
    const content = e.currentTarget.dataset.content
    if (!content) return
    wx.showToast({ title: '正在合成语音…', icon: 'none' })
    voice.textToSpeech(content)
      .then(() => {})
      .catch((err) => {
        console.error('[语音播放] 失败：', err)
        const msg = (err && err.message) || '播放失败'
        if (msg.indexOf('正在播放') !== -1) {
          wx.showToast({ title: '正在播放中', icon: 'none' })
        } else if (msg.indexOf('未配置腾讯云') !== -1) {
          wx.showToast({ title: '语音功能未配置', icon: 'none' })
        } else {
          const detail = msg.length > 30 ? msg.slice(0, 30) + '…' : msg
          wx.showToast({ title: '播放失败：' + detail, icon: 'none' })
        }
      })
  },

  copyAnswer(e) {
    const content = e.currentTarget.dataset.content
    wx.setClipboardData({
      data: content,
      success: () => wx.showToast({ title: '已复制', icon: 'none' })
    })
  },

  onNewQuestion() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pages/index/index' })
    })
  }
})
