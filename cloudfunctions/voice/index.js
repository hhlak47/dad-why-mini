// ============================================================
// 《爸爸，我为什么？》语音云函数 voice
// 负责：语音识别(ASR) + 语音合成(TTS)，转发到腾讯云。
// 密钥只存在于云函数环境变量，不进前端。
//
// 环境变量（云开发控制台 -> 云函数 -> voice -> 配置 -> 环境变量）：
//   TENCENT_SECRET_ID   必填，腾讯云 SecretId
//   TENCENT_SECRET_KEY  必填，腾讯云 SecretKey
//
// 入参（前端 wx.cloud.callFunction 的 data）：
//   { voiceAction: 'asr', audio: '<base64 mp3>' }  -> { ok:true, data:{ text } }
//   { voiceAction: 'tts', text: '要念的文字' }      -> { ok:true, data:{ audio:'<base64 mp3>' } }
// 未配置腾讯云密钥时返回 ok:false，前端会优雅提示“语音功能未配置”，不影响文字问答。
// ============================================================

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// ---------------------- 腾讯云客户端（v4 写法，懒加载）----------------------
let asrClient = null
let ttsClient = null

function getAsrClient() {
  if (asrClient) return asrClient
  const secretId = process.env.TENCENT_SECRET_ID
  const secretKey = process.env.TENCENT_SECRET_KEY
  if (!secretId || !secretKey) return null
  try {
    const tencentcloud = require('tencentcloud-sdk-nodejs')
    // 腾讯云 SDK v4：各服务挂在 tencentcloud.<service>.v<version>.Client
    asrClient = new tencentcloud.asr.v20190614.Client({
      credential: { secretId, secretKey },
      region: 'ap-guangzhou',
      profile: { httpProfile: { endpoint: 'asr.tencentcloudapi.com' } }
    })
    return asrClient
  } catch (e) {
    console.error('[ASR] 腾讯云客户端初始化失败:', e && e.message)
    return null
  }
}

function getTtsClient() {
  if (ttsClient) return ttsClient
  const secretId = process.env.TENCENT_SECRET_ID
  const secretKey = process.env.TENCENT_SECRET_KEY
  if (!secretId || !secretKey) return null
  try {
    const tencentcloud = require('tencentcloud-sdk-nodejs')
    // 腾讯云 SDK v4：各服务挂在 tencentcloud.<service>.v<version>.Client
    ttsClient = new tencentcloud.tts.v20190823.Client({
      credential: { secretId, secretKey },
      region: 'ap-guangzhou',
      profile: { httpProfile: { endpoint: 'tts.tencentcloudapi.com' } }
    })
    return ttsClient
  } catch (e) {
    console.error('[TTS] 腾讯云客户端初始化失败:', e && e.message)
    return null
  }
}

// ---------------------- 一句话识别 ASR ----------------------
function doAsr(audio) {
  const client = getAsrClient()
  if (!client) return Promise.reject(new Error('未配置腾讯云密钥（TENCENT_SECRET_ID/KEY），无法使用语音识别'))
  if (!audio) return Promise.reject(new Error('缺少音频数据'))
  return client
    .request('SentenceRecognition', {
      ProjectId: 0,
      SubServiceType: 2, // 一句话识别
      EngSerViceType: '16k_zh',
      SourceType: 1, // 1=语音数据（base64）
      VoiceFormat: 'mp3', // 与前端录音格式一致
      UsrAudioKey: 'baba_why_' + Date.now(),
      Data: audio,
      DataLen: Math.ceil(Buffer.from(audio, 'base64').length)
    })
    .then((resp) => resp.Result || '')
    .catch((err) => Promise.reject(new Error('语音识别失败: ' + (err && err.message ? err.message : err))))
}

// ---------------------- 语音合成 TTS ----------------------
function doTts(text) {
  const client = getTtsClient()
  if (!client) return Promise.reject(new Error('未配置腾讯云密钥（TENCENT_SECRET_ID/KEY），无法使用语音合成'))
  if (!text) return Promise.reject(new Error('缺少文本'))
  return client
    .request('TextToVoice', {
      Text: text,
      SessionId: 'baba_why_' + Date.now(),
      Volume: 5,
      Speed: 0,
      VoiceType: 101001, // 智瑜，温柔女声
      Codec: 'mp3'
    })
    .then((resp) => resp.Audio || '')
    .catch((err) => Promise.reject(new Error('语音合成失败: ' + (err && err.message ? err.message : err))))
}

// ---------------------- 入口 ----------------------
exports.main = async (event) => {
  try {
    const action = event.voiceAction
    if (action === 'asr') {
      const text = await doAsr(event.audio)
      return { ok: true, data: { text } }
    }
    if (action === 'tts') {
      const audio = await doTts(event.text)
      return { ok: true, data: { audio } }
    }
    return { ok: false, error: '未知的语音动作: ' + action }
  } catch (err) {
    return { ok: false, error: String((err && err.message) ? err.message : err) }
  }
}
