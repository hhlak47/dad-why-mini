// 本地存储：记住用户上一次选择的孩子年龄（PRD 要求“默认记住用户上一次选择”）

const AGE_KEY = 'baba_why_child_age'

function getAge() {
  try {
    const v = wx.getStorageSync(AGE_KEY)
    return typeof v === 'number' ? v : 4
  } catch (e) {
    return 4
  }
}

function setAge(age) {
  try {
    wx.setStorageSync(AGE_KEY, age)
  } catch (e) {
    // 忽略存储异常
  }
}

module.exports = { getAge, setAge }
