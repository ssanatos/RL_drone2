import * as THREE from 'three';
import { Track, DroneEnv, DT, OBS_DIM, ACT_DIM, MAX_TIME, mulberry32 } from './sim.js';
import { Genome, evolve, seedPopulation, N_WEIGHTS, HIDDEN } from './ai.js';
import { TrackView, FleetView, HeroDrone } from './view.js';

const $ = id => document.getElementById(id);
const showError = msg => (window.__showError ? window.__showError(msg) : console.error(msg));
const viewport = $('viewport');
const MAX_VISIBLE = 160;

// ───────── 렌더러 / 씬 (조명 개수는 고정: 헤미스피어 1 + 방향광 1 + 헤드라이트 1) ─────────
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) { showError('WebGL 을 사용할 수 없습니다: ' + e.message); throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
viewport.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050914); scene.fog = new THREE.FogExp2(0x050914, 0.005);
scene.add(new THREE.HemisphereLight(0x8bbdff, 0x1a1a30, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(30, 60, 20); scene.add(sun);
const headlight = new THREE.PointLight(0x7fe9ff, 40, 60, 2); scene.add(headlight);
const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 700);
camera.position.set(0, 5, 10);

const track = new Track();
new TrackView(scene, track);
const fleet = new FleetView(scene, MAX_VISIBLE);
const hero = new HeroDrone(scene);

// ───────── 상태 ─────────
const rng = mulberry32((Date.now() & 0xffffffff) >>> 0);
let population = [], envs = [], generation = 1;
let running = false, paused = false, simSpeed = 1, mode = 'ai', cameraMode = 'chase';
let bestEver = null, bestFit = -Infinity, bestGen = 0, history = [], lastInfo = null;
let leader = null, alive = 0, statsTimer = 0, chartDirty = true;
const soloEnv = new DroneEnv(track, rng); let soloGenome = null, soloDeadT = 0;
const act = new Array(ACT_DIM).fill(0), keys = {};

function makePopulation(n) { population = Array.from({ length: n }, () => new Genome(null, rng)); spawn(); }
function spawn() {
  if (envs.length !== population.length) envs = population.map(() => new DroneEnv(track, rng));
  envs.forEach(e => e.reset());
  alive = envs.length; leader = envs[0];
}

// ───────── 학습 루프 ─────────
function generationDone() {
  population.forEach((g, i) => { const e = envs[i]; g.fitness = e.ret; g.dist = Math.max(0, e.s); g.maxSpeed = e.maxSpeed; g.finished = e.finished; });
  const ranked = [...population].sort((a, b) => b.fitness - a.fitness), champ = ranked[0];
  const mean = population.reduce((s, g) => s + g.fitness, 0) / population.length;
  const fin = population.filter(g => g.finished).length;
  if (champ.fitness > bestFit) { bestFit = champ.fitness; bestEver = champ.clone(); bestEver.fitness = champ.fitness; bestGen = generation; }
  history.push({ best: champ.fitness, mean }); if (history.length > 80) history.shift();
  lastInfo = { gen: generation, fin, n: population.length, mean, dist: champ.dist };
  population = evolve(population, { rng }); generation++; spawn();
  chartDirty = true;
}
function stepAll() {
  let a = 0;
  for (let i = 0; i < envs.length; i++) {
    const e = envs[i]; if (e.done) continue;
    e.step(population[i].act(e.obs, act));
    if (!e.done) a++;
  }
  alive = a;
  if (a === 0) generationDone();
}
function manualAction() {
  const e = soloEnv, lvl = v => Math.max(-1, Math.min(1, v));
  const axis = (pos, neg, auto) => (keys[pos] || keys[neg]) ? (keys[pos] ? 1 : 0) - (keys[neg] ? 1 : 0) : auto;
  act[0] = axis('ArrowUp', 'ArrowDown', lvl(-e.pitch * 2.5));   // ↑ 기수 위 (키를 떼면 자동 수평)
  act[1] = axis('ArrowLeft', 'ArrowRight', lvl(-e.roll * 2.5));  // ← 왼쪽으로 기울임
  act[2] = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);            // A 좌회전 / D 우회전
  act[3] = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + 0.46;     // 기본값 = 호버링 추력
  return act;
}
function stepSolo() {
  if (soloEnv.done) { soloDeadT += DT; if (soloDeadT > 1) { soloEnv.reset(); soloDeadT = 0; } return; }
  soloEnv.step(mode === 'manual' ? manualAction() : soloGenome.act(soloEnv.obs, act));
}

// ───────── UI 갱신(초당 ~8회) ─────────
function renderStats() {
  $('generation').textContent = $('hudGen').textContent = generation;
  $('alive').textContent = $('hudAlive').textContent = mode === 'ai' ? alive : '—';
  let bd = 0, bs = 0;
  for (const e of envs) { if (e.s > bd) bd = e.s; if (e.maxSpeed > bs) bs = e.maxSpeed; }
  const cur = mode === 'ai' ? bd : Math.max(0, soloEnv.s);
  $('distance').innerHTML = cur.toFixed(1) + '<span>m</span>';
  $('bestSpeed').innerHTML = (mode === 'ai' ? bs : soloEnv.maxSpeed).toFixed(1) + '<span>m/s</span>';
  $('lapLabel').textContent = `PROGRESS ${(Math.min(1, cur / track.length) * 100).toFixed(1)}%  ·  ${cur.toFixed(0)} / ${track.length.toFixed(0)} m`;
  $('champName').textContent = bestEver ? `Gen ${bestGen} champion` : 'Awaiting flight data';
  $('champDetail').textContent = lastInfo ? `last gen: ${lastInfo.fin}/${lastInfo.n} finished · mean ${Math.round(lastInfo.mean)}` : 'Start evolution to train';
  $('champFitness').textContent = bestEver ? Math.round(bestFit) : '—';
  if (chartDirty) { drawChart(); chartDirty = false; }
}
function drawChart() {
  const c = $('fitnessChart'), ctx = c.getContext('2d'), w = c.width, h = c.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#20314b'; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, h * i / 4); ctx.lineTo(w, h * i / 4); ctx.stroke(); }
  if (!history.length) return;
  const all = history.flatMap(p => [p.best, p.mean]), max = Math.max(50, ...all), min = Math.min(0, ...all);
  const X = i => history.length > 1 ? i / (history.length - 1) * w : w / 2, Y = v => h - ((v - min) / (max - min || 1)) * (h - 14) - 7;
  const line = (key, color, lw) => { ctx.beginPath(); history.forEach((p, i) => i ? ctx.lineTo(X(i), Y(p[key])) : ctx.moveTo(X(i), Y(p[key]))); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke(); };
  line('mean', '#6688ff', 2); line('best', '#38e5ef', 3);
  ctx.fillStyle = '#38e5ef'; ctx.font = '12px monospace'; ctx.fillText('best', 6, 14);
  ctx.fillStyle = '#6688ff'; ctx.fillText('mean', 46, 14);
}

// ───────── 카메라 ─────────
const _f = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function pickTarget() {
  if (mode !== 'ai') return soloEnv;
  // 카메라 대상: 살아있는 개체 중 가장 앞선 개체 (3m 이상 앞서는 개체가 생길 때만 교체 → 화면 떨림 방지)
  let best = null;
  for (const e of envs) if (!e.done && (!best || e.s > best.s)) best = e;
  if (best && (!leader || leader.done || best.s > leader.s + 3)) leader = best;
  return leader;
}
function updateCamera(t, dt) {
  if (!t) return;
  _f.set(t.fx, t.fy, t.fz);
  if (cameraMode === 'chase') {
    camera.up.copy(_up);
    _d.set(t.x, t.y, t.z).addScaledVector(_f, -9).add(new THREE.Vector3(0, 4.2, 0));
    camera.position.lerp(_d, 1 - Math.exp(-Math.max(3.5, simSpeed * 6) * dt));
    camera.lookAt(t.x + _f.x * 5, t.y + _f.y * 5, t.z + _f.z * 5);
  } else {
    camera.up.set(t.ux, t.uy, t.uz);
    camera.position.set(t.x + _f.x * 0.8 + t.ux * 0.15, t.y + _f.y * 0.8 + t.uy * 0.15, t.z + _f.z * 0.8 + t.uz * 0.15);
    camera.lookAt(t.x + _f.x * 20, t.y + _f.y * 20, t.z + _f.z * 20);
  }
  headlight.position.copy(camera.position);
}

// ───────── 메인 루프: 물리는 항상 고정 DT, 배속은 '스텝 횟수'로 구현 ─────────
const clock = new THREE.Clock(); let acc = 0, firstFrame = true;
function animate() {
  requestAnimationFrame(animate);
  const realDt = Math.min(clock.getDelta(), 0.1);
  const active = mode === 'ai' ? running && !paused : !paused;
  if (active) {
    acc += realDt * simSpeed;
    const t0 = performance.now();
    while (acc >= DT) {
      mode === 'ai' ? stepAll() : stepSolo();
      acc -= DT;
      if (performance.now() - t0 > 12) { acc = 0; break; }   // 프레임 예산 초과 시 밀린 스텝은 버림
    }
  }
  if ((statsTimer -= realDt) <= 0) { renderStats(); statsTimer = 0.12; }
  const target = pickTarget();
  fleet.visible = mode === 'ai'; if (mode === 'ai') fleet.update(envs);
  hero.update(target, realDt); hero.group.visible = cameraMode === 'chase';
  updateCamera(target, realDt);
  renderer.render(scene, camera);
  if (firstFrame) { firstFrame = false; window.__droneReady = true; const l = $('loading'); l.style.opacity = '0'; setTimeout(() => l.remove(), 550); }
}

// ───────── 입력 / 버튼 ─────────
window.addEventListener('keydown', e => {
  if (mode === 'manual') { keys[e.code] = true; if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault(); }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
function resize() { const w = viewport.clientWidth, h = viewport.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(viewport); resize();

function updateButtons() {
  $('startBtn').textContent = !running ? '▶ Start evolution' : paused ? '▶ Resume' : '● Running';
  $('pauseBtn').textContent = 'Ⅱ Pause';
  $('pauseBtn').classList.toggle('selected', paused);
  $('runStatus').textContent = mode !== 'ai' ? (paused ? 'PAUSED' : mode === 'manual' ? 'MANUAL FLIGHT' : 'CHAMPION REPLAY') : !running ? 'SIMULATION READY' : paused ? 'PAUSED' : 'EVOLUTION RUNNING';
}
$('startBtn').onclick = () => { running = true; paused = false; updateButtons(); };
$('pauseBtn').onclick = () => { paused = !paused; updateButtons(); };
function reset() {
  running = false; paused = false; generation = 1; bestEver = null; bestFit = -Infinity; bestGen = 0; history = []; lastInfo = null; chartDirty = true;
  envs = []; makePopulation(+$('population').value); soloEnv.reset(); acc = 0; updateButtons(); renderStats();
}
$('resetBtn').onclick = reset;
$('population').onchange = reset;
$('speed').oninput = e => { simSpeed = +e.target.value; $('speedVal').textContent = $('hudSpeed').textContent = simSpeed.toFixed(1) + '×'; };

const HELP = {
  ai: 'AI Auto: 신경망이 개체군 전체를 조종하며 세대마다 진화합니다.',
  manual: 'Manual: ↑/↓ 기수 · ←/→ 기울기 · W/S 추력 · A/D 요(회전). 키를 떼면 자동 수평. (학습은 일시 정지)',
  champion: 'Champion: 지금까지 최고 개체를 1대만 반복 재생합니다. (학습은 일시 정지)',
};
function setMode(m) {
  if (m === 'champion') {
    const g = bestEver || [...population].sort((a, b) => b.fitness - a.fitness)[0];
    if (!bestEver && !(g && g.fitness)) { $('manualHelp').textContent = '아직 챔피언이 없습니다. 먼저 Start evolution 으로 학습하거나 Load 로 불러오세요.'; return; }
    soloGenome = g;
  }
  mode = m; soloEnv.reset(); soloDeadT = 0; acc = 0;
  $('aiMode').classList.toggle('selected', m === 'ai'); $('manualMode').classList.toggle('selected', m === 'manual'); $('championMode').classList.toggle('selected', m === 'champion');
  $('manualHelp').textContent = HELP[m]; leader = envs[0]; updateButtons();
}
$('aiMode').onclick = () => setMode('ai'); $('manualMode').onclick = () => setMode('manual'); $('championMode').onclick = () => setMode('champion');
$('chaseBtn').onclick = () => { cameraMode = 'chase'; $('chaseBtn').classList.add('selected'); $('cockpitBtn').classList.remove('selected'); $('cameraLabel').textContent = 'CHASE CAMERA'; };
$('cockpitBtn').onclick = () => { cameraMode = 'fpv'; $('cockpitBtn').classList.add('selected'); $('chaseBtn').classList.remove('selected'); $('cameraLabel').textContent = 'FPV CAMERA'; };

// 챔피언 저장/불러오기 (Python 등 다른 도구와 주고받을 수 있는 JSON)
$('saveBtn').onclick = () => {
  if (!bestEver) { alert('저장할 챔피언이 없습니다. 먼저 학습을 진행하세요.'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ ...bestEver.toJSON(), generation: bestGen })], { type: 'application/json' }));
  a.download = `drone_champion_gen${bestGen}.json`; a.click(); URL.revokeObjectURL(a.href);
};
$('loadBtn').onclick = () => $('loadFile').click();
$('loadFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const g = Genome.fromJSON(JSON.parse(await f.text()));
    population = seedPopulation(g, +$('population').value, rng); envs = []; spawn();
    bestEver = g.clone(); bestEver.fitness = g.fitness; bestFit = g.fitness || -Infinity; bestGen = 0; chartDirty = true; updateButtons();
    $('manualHelp').textContent = '챔피언을 불러왔습니다. Start evolution 으로 이어서 학습하거나 CHAMPION 모드로 재생하세요.';
  } catch (err) { alert('불러오기 실패: ' + err.message); }
};

// ───────── 시작 ─────────
try {
  makePopulation(+$('population').value); updateButtons(); renderStats(); animate();
} catch (err) { showError(err.stack || err.message); throw err; }
