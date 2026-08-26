// AI 请求层：根据 config.BACKEND_MODE 调用不同后端。
// 前端永远只发送「结构化请求」，模型调用与 System Prompt 都在云端完成。
//
// 三种模式：
//   'cloud'  走微信云函数（推荐，需真实 AppID + 云环境 + API Key）
//   'http'   走自建服务器（server/index.js，需 Node + API Key）
//   'mock'   本地假数据，无需任何账号/Key，用于先看界面与交互流程

const config = require('../config.js')

// ---------------------- Mock 模式：无需 Key，直接返回示例回答 ----------------------
function mockReply(payload) {
  const { action, childAge, originalQuestion, followUpQuestion } = payload
  const q = originalQuestion || '这个问题'
  if (action === 'simpler') {
    return {
      ok: true,
      data: {
        type: 'simpler_answer',
        content: `（示例·未接真实 AI）关于「${q}」，换一个更简单的说法：你每天都能看到的小树离我们很近，我们走几步它就跑掉了；但月亮离我们特别特别远，走很多步它好像还在那儿。所以我们会觉得它一直跟着自己～`
      }
    }
  }
  if (action === 'followup') {
    return {
      ok: true,
      data: {
        type: 'follow_up',
        content: `（示例·未接真实 AI）关于「${followUpQuestion || '她的新问题'}」，我们可以接着跟小朋友说：刚才我们讲过的那个“远和近”的小秘密，在这里也管用哦——你还记得路灯和月亮谁跑得快吗？`
      }
    }
  }
  if (action === 'game') {
    return {
      ok: true,
      data: {
        type: 'game',
        title: '月亮追踪小游戏',
        duration: '3分钟',
        materials: '什么都不用',
        steps: [
          '今晚出门时，找一盏离你很近的路灯',
          '再抬头看看远处的月亮',
          '和孩子一起往前走几步',
          '问孩子：路灯和月亮，谁跑得更快？'
        ],
        question: '为什么月亮好像一直没跑掉呢？'
      }
    }
  }
  // answer
  return {
    ok: true,
    data: {
      type: 'answer',
      content: `（示例·未接真实 AI）关于「${q}」，可以这样讲给 ${childAge} 岁的小朋友听：……（在 config.js 把 BACKEND_MODE 改成 cloud 或 http，并填入 DeepSeek Key，就能得到真正适龄、可直接念的回答）`
    }
  }
}

// 调用微信云函数
function callCloud(payload) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: config.CLOUD_FUNCTION,
      data: payload,
      success: (res) => resolve(res.result),
      fail: (err) => reject(err)
    })
  })
}

// 调用自建 HTTP 服务
function callHttp(payload) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.HTTP_BASE_URL + '/ask',
      method: 'POST',
      data: payload,
      timeout: 30000,
      header: { 'content-type': 'application/json' },
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          resolve(res.data)
        } else {
          reject(new Error('HTTP ' + res.statusCode))
        }
      },
      fail: (err) => reject(err)
    })
  })
}

// 统一入口
function askAI(payload) {
  if (config.BACKEND_MODE === 'mock') {
    // 模拟一点网络延迟，体验更真实
    return new Promise((resolve) => setTimeout(() => resolve(mockReply(payload)), 600))
  }
  if (config.BACKEND_MODE === 'cloud') {
    return callCloud(payload)
  }
  return callHttp(payload)
}

module.exports = { askAI }
