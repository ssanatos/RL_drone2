# 3D Drone AI Lab (v2)

Three.js 3D 드론 터널 시뮬레이터 + 신경진화(유전 알고리즘) 강화학습. 빌드 과정 없이 GitHub Pages 에서 동작합니다.

## 실행
ES 모듈을 쓰므로 `file://` 로 열면 안 됩니다.
```bash
python -m http.server 8000     # 이 폴더에서 실행 후 http://localhost:8000
```
GitHub Pages: Settings → Pages → `main` / `(root)`. Three.js 는 jsDelivr CDN 에서 불러옵니다.

## 구조
| 파일 | 역할 |
|---|---|
| `js/sim.js` | **순수 JS 환경**(Three.js 무관): `Track`, `DroneEnv(reset/step)`, 보상, 관측 16차원 |
| `js/ai.js` | MLP 정책(16→16→4) + GA(엘리트·토너먼트·균등교차·가우시안 변이) |
| `js/view.js` | 렌더링 전용(InstancedMesh 로 개체군 전체를 한 번에 그림) |
| `js/main.js` | UI, 고정 타임스텝 루프, 세대 관리, 저장/불러오기 |
| `tools/train.mjs` | **헤드리스 학습**(렌더링 없이 Node 에서 빠르게) |

## 강화학습 환경 규약 (`DroneEnv`)
- 행동 4개 `[pitch, roll, yaw, throttle]`, 각 `[-1, 1]` / 관측 16개(트랙 기준 위치·속도·자세, 전방 8m·20m 지점 방향)
- 보상: 중심선 전진 거리(m) + 중앙 유지 소량 + 완주 보너스(빠를수록 ↑) − 충돌 페널티
- 종료: 충돌 / 완주 / 시간초과(45s) / 정지
- 물리는 항상 고정 `DT = 1/60` → 프레임 속도나 시뮬 배속과 무관하게 결정적
```js
const env = new DroneEnv(new Track());
env.reset();
while (!env.done) { const reward = env.step([0, 0, 0, 0.5]); /* env.obs, env.ret */ }
```
PPO/DQN 같은 다른 알고리즘은 `DroneEnv` 를 그대로 붙이면 됩니다(`ai.js` 의 GA 만 교체).

## 헤드리스 학습
```bash
node tools/train.mjs --gens 100 --pop 120 --seed 1 --out champion.json
```
생성된 `champion.json` 은 화면의 **📂 Load** 로 불러와 이어서 학습하거나 **CHAMPION** 모드로 재생할 수 있습니다. (**💾 Save best** 로 브라우저 학습 결과도 저장 가능)

## 조작
- Start / Pause / Reset, SIM SPEED(최대 32×), POPULATION(40–160)
- AI AUTO(진화) · CHAMPION(최고 개체 1대 반복 재생) · MANUAL(↑↓ 기수, ←→ 기울기, W/S 추력, A/D 회전)
- CHASE / FPV 카메라
