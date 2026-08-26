// 语音工具：录音（微信小程序原生） + 语音识别(ASR) + 语音合成(TTS) 播放
// 语音识别与合成都通过自建 HTTP 服务转发到腾讯云，密钥只存在于服务器端。
// 若服务未配置语音密钥，ASR / TTS 会优雅失败（返回 ok:false），不影响文字问答。

const config = require('../config.js')

function voiceBase() {
  return config.VOICE_BASE_URL || config.HTTP_BASE_URL || ''
}

// 通用 POST
function postJSON(url, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'POST',
      data,
      timeout: 30000,
      header: { 'content-type': 'application/json' },
      success: (res) => {
        if (res.statusCode === 200 && res.data) resolve(res.data)
        else reject(new Error('HTTP ' + res.statusCode))
      },
      fail: reject
    })
  })
}

// ---------------------- 录音 ----------------------
// 返回 RecorderManager 单例（仅在首次创建时注册 onStop/onError 监听）
let recorder = null
let stopResolver = null

function getRecorder() {
  if (!recorder) {
    recorder = wx.getRecorderManager()
    recorder.onStop((res) => {
      const r = stopResolver
      stopResolver = null
      if (!r) return
      const fs = wx.getFileSystemManager()
      try {
        const b64 = fs.readFileSync(res.tempFilePath, 'base64')
        r(b64)
      } catch (e) {
        r(null)
      }
    })
    recorder.onError(() => {
      const r = stopResolver
      stopResolver = null
      if (r) r(null)
    })
  }
  return recorder
}

// 开始录音（按住说话时调用）
function startRecord() {
  return new Promise((resolve, reject) => {
    const rm = getRecorder()
    try {
      // mp3 + 16k + 48k 是微信 RecorderManager 稳定支持的组合；腾讯云 ASR 也支持 mp3
      rm.start({ format: 'mp3', sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000 })
      resolve()
    } catch (e) {
      reject(new Error('录音启动失败：' + (e && e.message ? e.message : '请检查麦克风权限')))
    }
  })
}

// 停止录音，返回 base64 音频（松手时调用）
function stopRecord() {
  return new Promise((resolve) => {
    const rm = getRecorder()
    stopResolver = resolve
    rm.stop()
  }).then((b64) => {
    if (!b64) throw new Error('录音读取失败')
    return b64
  })
}

// ---------------------- 识别 ----------------------
// 录音 -> 识别 -> 返回识别文本（一体化，适合非按住按钮场景）
function speechToText() {
  return startRecord()
    .then(() => stopRecord())
    .then((b64) => asr(b64))
    .then((text) => text)
}

// 调用语音云函数（cloud 模式）
function callCloudVoice(voiceAction, payload) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: config.CLOUD_VOICE_FUNCTION || 'voice',
      data: Object.assign({ voiceAction }, payload),
      success: (res) => resolve(res.result),
      fail: (err) => {
        console.error('[voice] callFunction fail:', err)
        reject(err)
      }
    })
  })
}

// 把 base64 音频送到 /asr 识别，返回文本
function asr(b64) {
  if (config.BACKEND_MODE === 'cloud') {
    return callCloudVoice('asr', { audio: b64 })
      .then((res) => {
        if (!res || res.ok === false) throw new Error((res && res.error) || '识别失败')
        return (res.data && res.data.text) || ''
      })
  }
  return postJSON(voiceBase() + '/asr', { audio: b64 })
    .then((res) => {
      if (!res || res.ok === false) throw new Error((res && res.error) || '识别失败')
      return (res.data && res.data.text) || ''
    })
}

// ---------------------- 合成并播放 ----------------------
let playing = false
function textToSpeech(text) {
  if (!text) return Promise.reject(new Error('没有可播放的内容'))
  if (playing) return Promise.reject(new Error('正在播放'))
  if (config.BACKEND_MODE === 'cloud') {
    return callCloudVoice('tts', { text })
      .then((res) => {
        if (!res || res.ok === false) throw new Error((res && res.error) || '合成失败')
        const audio = (res.data && res.data.audio) || ''
        if (!audio) throw new Error('合成结果为空')
        return playBase64Mp3(audio)
      })
  }
  return postJSON(voiceBase() + '/tts', { text })
    .then((res) => {
      if (!res || res.ok === false) throw new Error((res && res.error) || '合成失败')
      const audio = (res.data && res.data.audio) || ''
      if (!audio) throw new Error('合成结果为空')
      return playBase64Mp3(audio)
    })
}

// 把 base64 mp3 写入临时文件并用微信音频播放
function playBase64Mp3(b64) {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager()
    const path = `${wx.env.USER_DATA_PATH}/tts_${Date.now()}.mp3`
    fs.writeFile({
      filePath: path,
      data: b64,
      encoding: 'base64',
      success: () => {
        const audio = wx.createInnerAudioContext()
        audio.obeyMuteSwitch = false // 关键：iPhone 静音键开启时也能出声（默认 true 会被静音）
        audio.volume = 1
        audio.src = path
        audio.onPlay(() => { playing = true })
        audio.onEnded(() => { playing = false; audio.destroy(); resolve() })
        audio.onStop(() => { playing = false; audio.destroy(); resolve() })
        audio.onError((e) => { playing = false; audio.destroy(); reject(new Error('播放失败：' + (e && e.errMsg ? e.errMsg : '未知的音频错误'))) })
        audio.play()
      },
      fail: () => reject(new Error('写入音频失败'))
    })
  })
}

module.exports = { speechToText, textToSpeech, startRecord, stopRecord, asr, _postJSON: postJSON, voiceBase }
