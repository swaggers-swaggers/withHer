const object = properties => ({ type: 'object', properties, additionalProperties: false });
const string = description => ({ type: 'string', description });
const integer = (description, maximum = 30) => ({ type: 'integer', minimum: 0, maximum, description });
const scope = { type: 'string', enum: ['facts', 'messages', 'study'] };
const tool = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { ...object(properties), required } } });
const TOOLS = [
  tool('life_read', '查阅自己的模拟生活日记、正在做的事、兴趣与已完成活动。不是用户事实。支持分页，默认3条。', {
    offset: integer('分页偏移', Number.MAX_SAFE_INTEGER), limit: { type: 'integer', minimum: 1, maximum: 20 },
  }),
  tool('life_plan', '给自己的模拟生活安排一件小事，成功回复后保存计划，时间到由生活模块模拟完成并记录。可以是独立于用户的小兴趣，不要每轮安排新活动。', {
    title: string('活动标题，最多80字'), description: string('打算做什么及具体念头，最多500字'),
    duration_minutes: { type: 'integer', minimum: 1, maximum: 180 }, replace_current: { type: 'boolean' },
    search_query: string('可选：需要真实资料时的公开搜索词，最多128字符'),
  }, ['title', 'description']),
  tool('life_mark_shared', '仅当本次最终回复确实分享了某条已完成生活记录时标记，成功发送后才保存，避免反复分享同一件事。', {
    ids: { type: 'array', minItems: 1, maxItems: 4, items: string('已完成生活记录的ID') },
  }, ['ids']),
  tool('web_search', '主动联网搜索最新信息、资料和不确定的事实。需要查证时直接调用；不受后台新闻刷新间隔限制。仅发送必要关键词，不附带个人聊天和记忆。', {
    query: string('1至128个字符的搜索词；可用site:、after:等语法'), count: { type: 'integer', minimum: 1, maximum: 8 },
  }, ['query']),
  tool('web_fetch', '读取网页原文：可读取搜索结果或用户给出的HTTP/HTTPS链接。长网页用next_offset继续读取；返回来源地址、标题和抓取时间。', {
    url: string('完整HTTP或HTTPS网页地址'), offset: integer('从第几个Unicode字符继续读取', Number.MAX_SAFE_INTEGER),
    max_chars: { type: 'integer', minimum: 500, maximum: 8000 },
  }, ['url']),
  tool('short_term_update', '基于当下总结记录重要内容、临时安排、待回应事项或当前交流边界；可更新或移除，自动过期。独立于长期事实和感情。', {
    operations: { type: 'array', minItems: 1, maxItems: 6, items: { ...object({
      action: { type: 'string', enum: ['upsert', 'remove'] }, key: string('稳定主题标识，同一主题复用key'), text: string('简洁客观的当下要点，最多600字'),
      expires_hours: { type: 'integer', minimum: 1, maximum: 72 },
      evidence: { type: 'array', minItems: 1, maxItems: 12, items: { ...object({ message_id: string('真实用户消息ID'), quote: string('该消息的连续原文') }), required: ['message_id', 'quote'] } },
    }), required: ['action', 'key'] } },
  }, ['operations']),
  tool('memory_search', '有目的查询任意时期的事实、原始聊天或学习桌原文。关键词检索，空query可按时间浏览；next_offset可翻页，中文也支持短词。',
    { query: string('关键词，以空格分隔可做OR查询'), scope, offset: integer('分页偏移', 10000000), limit: { type: 'integer', minimum: 1, maximum: 30 }, include_inactive: { type: 'boolean' }, after: { type: 'number', description: '可选起始Unix毫秒时间' }, before: { type: 'number', description: '可选截止Unix毫秒时间' } }),
  tool('memory_read', '读取任意事实、历史消息或学习桌记录的完整原文及来源。', { id: string('查询返回的记录ID'), scope }, ['id']),
  tool('memory_wander', '不带目的随机获取一些历史事实作为闲聊或幻想素材。', { limit: { type: 'integer', minimum: 1, maximum: 5 } }),
  tool('study_read', '读取当前StudyDesk学习桌资料，支持全部待办与随手记分页；记录是原文，不等于内容已核实。',
    { area: { type: 'string', enum: ['overview', 'todos', 'notes', 'timer', 'learning'] }, offset: integer('分页偏移', 10000000), limit: { type: 'integer', minimum: 1, maximum: 30 } }),
  tool('imagine', '自主选择是否进入幻想模块，生成临时动机。会同时返回幻想正文和动机，均不得当作事实保存。', { seed: string('本轮希望展开的联想，可空') }),
  tool('relationship_reconsider', '仅当本次用户行为足以巨大影响过往认知时申请作家重写感情与看法；普通变化等记忆整理。', {
    reason: string('本次行为为什么足以巨大改变既有认知'), evidence: { type: 'array', minItems: 1, maxItems: 5,
      items: { ...object({ message_id: string('真实用户消息ID'), quote: string('用户原文中的连续片段') }), required: ['message_id', 'quote'] } },
  }, ['reason', 'evidence']),
];
module.exports = { TOOLS };
