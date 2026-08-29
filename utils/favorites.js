// 收藏功能：把好的问答保存到本地，方便父母日后翻阅
// 数据结构: [{ id, question, answer, age, createdAt }]

var FAV_KEY = 'baba_why_favorites';
var MAX_ITEMS = 200;

function getAll() {
  try {
    var list = wx.getStorageSync(FAV_KEY);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function add(question, answer, age) {
  var list = getAll();
  // 避免重复收藏相同问答
  var exists = list.some(function (item) {
    return item.question === question && item.answer === answer;
  });
  if (exists) return false;
  var item = {
    id: 'fav_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    question: question || '',
    answer: answer || '',
    age: age || 0,
    createdAt: Date.now()
  };
  list.unshift(item);
  if (list.length > MAX_ITEMS) list = list.slice(0, MAX_ITEMS);
  try {
    wx.setStorageSync(FAV_KEY, list);
  } catch (e) {
    return false;
  }
  return true;
}

function remove(id) {
  var list = getAll();
  var next = list.filter(function (item) { return item.id !== id; });
  try {
    wx.setStorageSync(FAV_KEY, next);
    return true;
  } catch (e) {
    return false;
  }
}

function isFavorited(question, answer) {
  var list = getAll();
  return list.some(function (item) {
    return item.question === question && item.answer === answer;
  });
}

module.exports = { getAll: getAll, add: add, remove: remove, isFavorited: isFavorited };
