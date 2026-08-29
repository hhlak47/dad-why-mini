var ai = require('../../utils/ai.js');
var voice = require('../../utils/voice.js');
var config = require('../../config.js');
var favorites = require('../../utils/favorites.js');

// Loading 文案轮换
var LOADING_TEXTS = [
  '我想想，怎么跟小朋友讲……',
  '找一个孩子听得懂的说法……',
  '换个孩子熟悉的比喻……'
];

var MAX_FOLLOW_ROUNDS = 5;

Page({
  data: {
    question: '',
    age: 4,
    messages: [],
    context: [],
    loading: false,
    loadingText: '',
    error: false,
    showFollow: false,
    followText: '',
    followRounds: 0,
    followDisabled: false,
    lastAction: null,
    scrollAnchor: 'anchor-0',
    _mid: 0,
    _aid: 0,
    _timer: null,
    voiceOptions: [],
    currentVoiceId: '',
    followRecording: false,
    followRecognizing: false
  },

  onLoad: function (options) {
    var question = decodeURIComponent(options.q || '');
    var age = parseInt(options.age || '4', 10);
    this.setData({ question: question, age: age });
    this.loadVoices();
    this.runAction('answer', {});
  },

  loadVoices: function () {
    var that = this;
    var db = wx.cloud.database();
    db.collection('voices').get().then(function (res) {
      var list = res.data || [];
      var options = [{ id: config.DEFAULT_VOICE_ID, name: '默认女声' }];
      list.forEach(function (v) {
        if (v.role === 'dad') options.push({ id: v.voiceId, name: '爸爸' });
        if (v.role === 'mom') options.push({ id: v.voiceId, name: '妈妈' });
      });
      that.setData({ voiceOptions: options, currentVoiceId: config.DEFAULT_VOICE_ID });
    }).catch(function () {
      that.setData({ voiceOptions: [{ id: config.DEFAULT_VOICE_ID, name: '默认女声' }], currentVoiceId: config.DEFAULT_VOICE_ID });
    });
  },

  selectVoice: function (e) {
    var voiceId = e.currentTarget.dataset.voiceId;
    this.setData({ currentVoiceId: voiceId });
  },

  onUnload: function () {
    this._clearTimer();
  },

  _clearTimer: function () {
    if (this.data._timer) {
      clearInterval(this.data._timer);
      this.setData({ _timer: null });
    }
  },

  _startLoading: function () {
    var that = this;
    var i = 0;
    this.setData({ loading: true, loadingText: LOADING_TEXTS[0], error: false });
    var timer = setInterval(function () {
      i = (i + 1) % LOADING_TEXTS.length;
      that.setData({ loadingText: LOADING_TEXTS[i] });
    }, 1800);
    this.setData({ _timer: timer });
  },

  _stopLoading: function () {
    this._clearTimer();
    this.setData({ loading: false });
  },

  _nextId: function () {
    var id = this.data._mid;
    this.setData({ _mid: id + 1 });
    return id;
  },

  _scrollBottom: function () {
    var aid = this.data._aid + 1;
    this.setData({ _aid: aid, scrollAnchor: 'anchor-' + aid });
  },

  _lastAnswer: function () {
    var list = this.data.context;
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].role === 'assistant') return list[i].content;
    }
    return '';
  },

  runAction: function (action, extra) {
    if (this.data.loading) return;
    this._startLoading();

    var payload = {
      action: action,
      childAge: this.data.age,
      originalQuestion: this.data.question,
      messages: this.data.context,
      followUpQuestion: extra.followUpQuestion || '',
      lastAnswer: extra.lastAnswer || this._lastAnswer()
    };
    this.setData({ lastAction: { action: action, extra: extra } });

    var that = this;
    ai.askAI(payload).then(function (res) {
      that._handleResult(res);
    }).catch(function (err) {
      console.error('[chat] askAI 失败：', err);
      var msg = (err && err.errMsg) || (err && err.message) || '';
      var code = (err && err.errCode) || '';
      that._handleFail(code, msg);
    });
  },

  _handleResult: function (res) {
    this._stopLoading();
    if (!res || res.ok === false) {
      this._handleFail();
      return;
    }
    var data = res.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (e) {
        data = { type: 'answer', content: data };
      }
    }
    if (!data || !data.type) {
      data = { type: 'answer', content: String(data) };
    }
    this._appendResult(data);
  },

  _appendResult: function (data) {
    var id = this._nextId();
    var that = this;
    if (data.type === 'game') {
      var gameMsg = {
        id: id,
        kind: 'game',
        title: data.title || '亲子小游戏',
        duration: data.duration || '3分钟',
        materials: data.materials || '什么都不用',
        steps: data.steps || [],
        question: data.question || ''
      };
      this.setData({ messages: this.data.messages.concat([gameMsg]) });
    } else {
      var content = data.content || '';
      var answerMsg = {
        id: id,
        kind: 'answer',
        type: data.type,
        content: content,
        favorited: false
      };
      this.setData({ messages: this.data.messages.concat([answerMsg]) });
      this.setData({ context: this.data.context.concat([{ role: 'assistant', content: content }]) });

      // 检查是否已收藏
      var q = this.data.question;
      var faved = favorites.isFavorited(q, content);
      var msgs = this.data.messages;
      msgs[msgs.length - 1].favorited = faved;
      this.setData({ messages: msgs });
    }
    this._scrollBottom();
  },

  _handleFail: function (code, msg) {
    this._stopLoading();
    if (code === -504003 || code === '-504003' || String(msg).indexOf('504003') !== -1 || String(msg).indexOf('timed out') !== -1) {
      wx.showToast({ title: '云函数超时，请到控制台把 ask 超时改 20 秒', icon: 'none' });
    }
    this.setData({ error: true });
  },

  retry: function () {
    var last = this.data.lastAction;
    if (last) {
      this.runAction(last.action, last.extra);
    }
  },

  onSimpler: function () {
    this.runAction('simpler', {});
  },

  onFollowTap: function () {
    if (this.data.followDisabled) return;
    this.setData({ showFollow: true });
  },

  onFollowInput: function (e) {
    this.setData({ followText: e.detail.value });
  },

  cancelFollow: function () {
    this.setData({ showFollow: false, followText: '' });
  },

  onSubmitFollow: function () {
    var text = (this.data.followText || '').trim();
    if (!text) {
      wx.showToast({ title: '她又问了什么呀？', icon: 'none' });
      return;
    }
    this._submitFollowText(text);
  },

  _submitFollowText: function (text) {
    var rounds = this.data.followRounds + 1;
    var id = this._nextId();
    this.setData({
      showFollow: false,
      followText: '',
      followRecording: false,
      followRecognizing: false,
      messages: this.data.messages.concat([{ id: id, kind: 'child', content: text }]),
      context: this.data.context.concat([{ role: 'child', content: text }]),
      followRounds: rounds,
      followDisabled: rounds >= MAX_FOLLOW_ROUNDS
    });
    this.runAction('followup', { followUpQuestion: text });
  },

  // 追问语音输入
  startFollowVoice: function () {
    if (this.data.followRecording || this.data.followRecognizing) return;
    var that = this;
    this.setData({ followRecording: true });
    voice.startRecord().catch(function () {
      that.setData({ followRecording: false });
      wx.showToast({ title: '录音启动失败，请检查麦克风权限', icon: 'none' });
    });
  },

  stopFollowVoice: function () {
    if (!this.data.followRecording) return;
    var that = this;
    this.setData({ followRecording: false, followRecognizing: true });
    voice.stopRecord().then(function (b64) {
      return voice.asr(b64);
    }).then(function (text) {
      that.setData({ followRecognizing: false });
      if (!text) {
        wx.showToast({ title: '没听清，再说一次～', icon: 'none' });
        return;
      }
      // 将识别结果填入输入框，让用户可以确认或编辑后再提交
      var current = that.data.followText;
      that.setData({ followText: current ? current + text : text });
    }).catch(function (err) {
      that.setData({ followRecognizing: false });
      console.error('[追问语音识别] 失败：', err);
      var msg = (err && err.message) || '识别失败';
      wx.showToast({ title: msg.length > 20 ? msg.slice(0, 20) + '…' : msg, icon: 'none' });
    });
  },

  onGame: function () {
    this.runAction('game', {});
  },

  onSpeak: function (e) {
    var content = e.currentTarget.dataset.content;
    if (!content) return;
    var voiceId = this.data.currentVoiceId || config.DEFAULT_VOICE_ID;
    wx.showToast({ title: '正在合成语音…', icon: 'none' });
    voice.textToSpeech(content, voiceId).then(function () {}).catch(function (err) {
      console.error('[语音播放] 失败：', err);
      var msg = (err && err.message) || '播放失败';
      if (msg.indexOf('正在播放') !== -1) {
        wx.showToast({ title: '正在播放中', icon: 'none' });
      } else if (msg.indexOf('未配置腾讯云') !== -1) {
        wx.showToast({ title: '语音功能未配置', icon: 'none' });
      } else {
        var detail = msg.length > 30 ? msg.slice(0, 30) + '…' : msg;
        wx.showToast({ title: '播放失败：' + detail, icon: 'none' });
      }
    });
  },

  copyAnswer: function (e) {
    var content = e.currentTarget.dataset.content;
    wx.setClipboardData({
      data: content,
      success: function () { wx.showToast({ title: '已复制', icon: 'none' }); }
    });
  },

  // 收藏/取消收藏
  toggleFavorite: function (e) {
    var content = e.currentTarget.dataset.content;
    var id = e.currentTarget.dataset.id;
    var question = this.data.question;
    var age = this.data.age;
    var msgs = this.data.messages;
    var idx = -1;
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return;

    if (msgs[idx].favorited) {
      // 取消收藏
      var all = favorites.getAll();
      var target = all.find(function (item) {
        return item.question === question && item.answer === content;
      });
      if (target) favorites.remove(target.id);
      msgs[idx].favorited = false;
      this.setData({ messages: msgs });
      wx.showToast({ title: '已取消收藏', icon: 'none' });
    } else {
      var ok = favorites.add(question, content, age);
      if (ok) {
        msgs[idx].favorited = true;
        this.setData({ messages: msgs });
        wx.showToast({ title: '已收藏 ⭐', icon: 'none' });
      } else {
        wx.showToast({ title: '收藏失败', icon: 'none' });
      }
    }
  },

  // 问下一个问题：回到首页并清空
  onNewQuestion: function () {
    wx.reLaunch({ url: '/pages/index/index?clear=1' });
  },

  goFavorites: function () {
    wx.navigateTo({ url: '/pages/favorites/favorites' });
  },

  goVoice: function () {
    wx.navigateTo({ url: '/pages/voice/voice' });
  }
});
