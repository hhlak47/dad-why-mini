var favorites = require('../../utils/favorites.js');
var voice = require('../../utils/voice.js');
var config = require('../../config.js');

Page({
  data: {
    list: [],
    currentVoiceId: '',
    playingId: ''
  },

  onLoad: function () {
    this.loadFavorites();
    this.loadVoice();
  },

  onShow: function () {
    this.loadFavorites();
  },

  onPullDownRefresh: function () {
    this.loadFavorites();
    wx.stopPullDownRefresh();
  },

  loadVoice: function () {
    var db = wx.cloud.database();
    db.collection('voices').get().then(function (res) {
      var list = res.data || [];
      var dad = list.find(function (v) { return v.role === 'dad'; });
      if (dad) {
        this.setData({ currentVoiceId: dad.voiceId });
      } else {
        this.setData({ currentVoiceId: config.DEFAULT_VOICE_ID });
      }
    }.bind(this)).catch(function () {
      this.setData({ currentVoiceId: config.DEFAULT_VOICE_ID });
    }.bind(this));
  },

  loadFavorites: function () {
    var list = favorites.getAll();
    this.setData({ list: list });
  },

  onSpeak: function (e) {
    var content = e.currentTarget.dataset.content;
    var id = e.currentTarget.dataset.id;
    if (!content) return;
    var voiceId = this.data.currentVoiceId || config.DEFAULT_VOICE_ID;
    this.setData({ playingId: id });
    wx.showToast({ title: '正在合成语音…', icon: 'none' });
    voice.textToSpeech(content, voiceId).then(function () {
      this.setData({ playingId: '' });
    }.bind(this)).catch(function (err) {
      this.setData({ playingId: '' });
      var msg = (err && err.message) || '播放失败';
      wx.showToast({ title: msg.length > 20 ? msg.slice(0, 20) + '…' : msg, icon: 'none' });
    }.bind(this));
  },

  onCopy: function (e) {
    var content = e.currentTarget.dataset.content;
    wx.setClipboardData({
      data: content,
      success: function () { wx.showToast({ title: '已复制', icon: 'none' }); }
    });
  },

  onRemove: function (e) {
    var id = e.currentTarget.dataset.id;
    var that = this;
    wx.showModal({
      title: '取消收藏',
      content: '确定要移除这条收藏吗？',
      confirmColor: '#F2783C',
      success: function (res) {
        if (res.confirm) {
          favorites.remove(id);
          that.loadFavorites();
          wx.showToast({ title: '已移除', icon: 'none' });
        }
      }
    });
  }
});
