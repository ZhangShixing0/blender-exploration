import { HarborAudio, TRACKS, PRESETS, cleanMix } from './ambient-audio.js?v=harbor334';

const $ = selector => document.querySelector(selector);
const KEY = 'blender-harbor-sounds-v1';
let stored = {};
try { const parsed = JSON.parse(localStorage.getItem(KEY) || '{}'); if (parsed && typeof parsed === 'object') stored = parsed; } catch { /* A fresh, quiet start when storage is unavailable. */ }
let favourite = stored.favourite ? cleanMix(stored.favourite) : null;
let preset = Object.hasOwn(PRESETS, stored.preset) ? stored.preset : 'shore';
let custom = stored.custom === true;
let deadline = null;
let timerStarting = false;
let timerRevision = 0;
let openPanel = null, panelTrigger = null;
const lastLevels = Object.fromEntries(TRACKS.map(({ id }) => [id, 30]));
const audio = new HarborAudio(stored.last || { ...PRESETS.shore, master: 45 }, renderAudio);
window.addEventListener('harbor-effect', event => audio.effect(event.detail.kind, event.detail.enabled));

$('#track-list').innerHTML = TRACKS.map(track => `<div class="track-row"><button class="track-toggle" data-track="${track.id}" aria-label="开关${track.name}" aria-pressed="false"><svg><use href="#i-${track.icon}"/></svg></button><label class="track-name" for="volume-${track.id}">${track.name}<span class="track-error" id="error-${track.id}"></span></label><output id="value-${track.id}" for="volume-${track.id}">0%</output><input id="volume-${track.id}" data-volume="${track.id}" type="range" min="0" max="100" value="0" aria-label="${track.name}音量"></div>`).join('');

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify({ last: cleanMix(audio), favourite, preset, custom })); return true; }
  catch { return false; }
}
function rangeValue(input, value) {
  input.value = value;
  input.style.setProperty('--range', `${value}%`);
}
function renderAudio(state) {
  document.body.classList.toggle('is-playing', !!state.playing);
  const running = state.desired && (state.context === 'running' || state.loading.length > 0);
  $('#play-sound').setAttribute('aria-label', running ? '暂停环境音' : '播放环境音');
  $('#play-sound').setAttribute('aria-pressed', String(running));
  $('#play-sound use').setAttribute('href', running ? '#i-pause' : '#i-play');
  $('#mix-name').textContent = custom ? '我的海港' : PRESETS[preset].name;
  let status = '已暂停 · 点一下继续听';
  if (state.context === 'uninitialized') status = '点一下，让海风进来';
  if (state.desired && state.loading.length) status = '正在迎来海风…';
  else if (state.playing) status = '海浪起伏，慢慢呼吸';
  else if (state.desired && state.master === 0) status = '已静音 · 调高总音量继续听';
  else if (state.desired && state.context !== 'running') status = '播放已被浏览器暂停，点击重试';
  if (Object.keys(state.errors).length) status = state.playing ? '部分声音未加载，可暂停后重试' : '声音未加载，点击播放重试';
  if (!Object.values(state.levels).some(Boolean)) status = '声音已关闭 · 选一组喜欢的声音';
  $('#sound-status').textContent = status;
  rangeValue($('#master-volume'), state.master);
  $('#master-value').textContent = `${state.master}%`;
  for (const { id } of TRACKS) {
    const value = state.levels[id];
    rangeValue($(`#volume-${id}`), value);
    $(`#value-${id}`).textContent = `${value}%`;
    $(`[data-track="${id}"]`).setAttribute('aria-pressed', String(value > 0));
    $(`#error-${id}`).textContent = state.errors[id] ? '暂未加载' : '';
    if (value) lastLevels[id] = value;
  }
  document.querySelectorAll('[data-preset]').forEach(button => button.setAttribute('aria-pressed', String(!custom && button.dataset.preset === preset)));
  $('#restore-mix').disabled = !favourite;
}

function closePanel(returnFocus = false) {
  if (!openPanel) return;
  $(`#${openPanel}-panel`).hidden = true;
  document.querySelectorAll('[data-panel]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  openPanel = null;
  if (returnFocus) panelTrigger?.focus();
}
function showPanel(name, trigger) {
  if (openPanel === name) { closePanel(true); return; }
  closePanel();
  openPanel = name;
  panelTrigger = trigger;
  const panel = $(`#${name}-panel`);
  panel.hidden = false;
  document.querySelectorAll(`[data-panel="${name}"]`).forEach(button => button.setAttribute('aria-expanded', 'true'));
  panel.querySelector('[data-close]').focus({ preventScroll: true });
}
document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => showPanel(button.dataset.panel, button)));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closePanel(true)));
window.addEventListener('harbor-close-panel', () => closePanel(true));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closePanel(true); });
document.addEventListener('pointerdown', event => {
  if (openPanel && !event.target.closest('.floating-panel, [data-panel], .sound-dock')) closePanel();
});

function cancelTimer(message = '不设闹铃，不打扰你。') {
  deadline = null; timerStarting = false; timerRevision++;
  $('#timer-status').textContent = message;
  $('#timer-label').textContent = '小憩';
  $('#cancel-timer').hidden = true;
  document.querySelectorAll('[data-minutes]').forEach(button => { button.disabled = false; button.removeAttribute('aria-pressed'); });
}
function tickTimer() {
  if (!deadline) return;
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    audio.stop();
    cancelTimer('这段小憩结束了。愿你带走一点海风。');
    $('#sound-status').textContent = '小憩结束 · 声音已淡出';
    return;
  }
  const seconds = Math.ceil(remaining / 1000);
  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  $('#timer-label').textContent = label;
  // Only the small visual clock ticks each second; avoid a repeating live announcement.
  if (seconds % 60 === 0) $('#timer-status').textContent = `还剩约 ${Math.ceil(seconds / 60)} 分钟，到时声音会淡出。`;
}
document.querySelectorAll('[data-minutes]').forEach(button => button.addEventListener('click', async () => {
  const revision = ++timerRevision;
  timerStarting = true;
  const minutes = Number(button.dataset.minutes);
  $('#timer-status').textContent = '正在准备声音…';
  document.querySelectorAll('[data-minutes]').forEach(item => { item.disabled = true; });
  if (!Object.values(audio.levels).some(Boolean)) {
    preset = 'shore'; custom = false; audio.setLevels(PRESETS.shore.levels);
  }
  const success = await audio.start();
  if (revision !== timerRevision) return;
  timerStarting = false;
  document.querySelectorAll('[data-minutes]').forEach(item => { item.disabled = false; });
  if (!success) { cancelTimer('声音还没准备好，请点播放重试。'); return; }
  deadline = Date.now() + minutes * 60000;
  $('#timer-status').textContent = `${minutes} 分钟留给自己，到时声音会淡出。`;
  $('#cancel-timer').hidden = false;
  button.setAttribute('aria-pressed', 'true');
  tickTimer(); persist();
}));
$('#cancel-timer').addEventListener('click', () => cancelTimer('已取消定时，可以继续听海。'));
setInterval(tickTimer, 1000);
document.addEventListener('visibilitychange', tickTimer);

$('#play-sound').addEventListener('click', () => {
  if (audio.desired && audio.context?.state !== 'running' && !audio.pending.size) audio.start();
  else if (audio.desired) { audio.stop(); cancelTimer('已暂停声音，小憩计时也已取消。'); }
  else {
    if (!Object.values(audio.levels).some(Boolean)) { showPanel('sounds', $('#play-sound')); return; }
    audio.start();
  }
});
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
  preset = button.dataset.preset; custom = false;
  audio.setLevels(PRESETS[preset].levels); persist();
}));
document.querySelectorAll('[data-volume]').forEach(input => input.addEventListener('input', () => {
  custom = true;
  audio.setLevels({ ...audio.levels, [input.dataset.volume]: Number(input.value) });
  if (!audio.desired && deadline) cancelTimer('声音已关闭，小憩计时也已取消。');
  persist();
}));
document.querySelectorAll('[data-track]').forEach(button => button.addEventListener('click', () => {
  const id = button.dataset.track;
  custom = true;
  audio.setLevels({ ...audio.levels, [id]: audio.levels[id] ? 0 : lastLevels[id] });
  if (!audio.desired && deadline) cancelTimer('声音已关闭，小憩计时也已取消。');
  persist();
}));
$('#master-volume').addEventListener('input', event => { audio.setMaster(Number(event.target.value)); persist(); });
$('#save-mix').addEventListener('click', () => {
  favourite = cleanMix(audio);
  const saved = persist();
  $('#save-feedback').textContent = saved ? '记住了。下次点「我的收藏」就能找回来。' : '本次已记住；浏览器禁止存储，关闭页面后不会保留。';
  renderAudio(audio.snapshot());
});
$('#restore-mix').addEventListener('click', () => {
  if (!favourite) return;
  custom = true;
  audio.setLevels(favourite.levels); audio.setMaster(favourite.master);
  persist();
  $('#save-feedback').textContent = '已找回你收藏的声音组合。';
});
$('#retry-scene').addEventListener('click', () => location.reload());
renderAudio(audio.snapshot());

if (new URLSearchParams(location.search).has('qa')) {
  window.__harborExperienceQA = () => ({ audio: audio.inspect(), preset, custom, favourite, deadline, timerStarting, openPanel });
}
