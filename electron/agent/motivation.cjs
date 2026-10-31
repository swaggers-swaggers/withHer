const BASE = Object.freeze([
  { id: 'cheer', text: '逗用户开心', weight: 1 },
  { id: 'curious', text: '关心好奇用户生活', weight: 1 },
  { id: 'playful', text: '撒撒娇闹一闹博取用户关注', weight: 1 },
]);
function validateMotives(value) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length > 12) throw new Error('动机预设格式无效');
  const seen = new Set(BASE.map(x => x.id));
  return value.filter(m => !BASE.some(b => b.id === m?.id)).map(m => {
    if (!m || !/^[a-zA-Z0-9_-]{1,60}$/.test(m.id) || seen.has(m.id) || typeof m.text !== 'string' || !m.text.trim() || m.text.length > 300 || !Number.isFinite(m.weight) || m.weight < 1 || m.weight > 5) throw new Error('动机预设格式无效');
    seen.add(m.id); return { id: m.id, text: m.text.trim(), weight: m.weight };
  });
}
class Motivation {
  constructor(store, provider, rng = Math.random) { this.store = store; this.provider = provider; this.rng = rng; }
  presets() { return [...BASE, ...this.store.meta('custom_motives', [])]; }
  choose() {
    const presets = this.presets(); let at = this.rng() * presets.reduce((n, m) => n + m.weight, 0);
    return presets.find(m => (at -= m.weight) < 0) || presets[0];
  }
}
module.exports = { Motivation, BASE, validateMotives };
