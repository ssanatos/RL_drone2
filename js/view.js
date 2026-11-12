// view.js — Three.js 렌더링 전용 (시뮬레이션 상태를 읽어 그리기만 한다).
// 핵심: 드론마다 PointLight/Mesh 를 만들지 않는다 → InstancedMesh 1개로 전체 개체군을 그린다.
import * as THREE from 'three';

export class TrackView {
  constructor(scene, track) {
    const { n, P, R, U, half: h } = track;
    this.group = new THREE.Group(); scene.add(this.group);
    const corner = (i, sr, sn, hh = h) => new THREE.Vector3(
      P[i * 3] + R[i * 3] * sr * hh + U[i * 3] * sn * hh,
      P[i * 3 + 1] + R[i * 3 + 1] * sr * hh + U[i * 3 + 1] * sn * hh,
      P[i * 3 + 2] + R[i * 3 + 2] * sr * hh + U[i * 3 + 2] * sn * hh);
    const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

    // 반투명 사각 터널 벽
    const verts = [], idx = [];
    for (let i = 0; i < n; i++) for (const [a, b] of CORNERS) { const p = corner(i, a, b); verts.push(p.x, p.y, p.z); }
    for (let i = 0; i < n - 1; i++) for (let s = 0; s < 4; s++) {
      const a = i * 4 + s, b = i * 4 + (s + 1) % 4, c = (i + 1) * 4 + (s + 1) % 4, d = (i + 1) * 4 + s;
      idx.push(a, b, d, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setIndex(idx); g.computeVertexNormals();
    this.group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x16284a, metalness: 0.2, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.3, depthWrite: false })));

    // 모서리 레일 4줄 + 일정 간격 단면 리브
    const railColors = [0x28e9f3, 0x1f8fff, 0x28e9f3, 0x1f8fff];
    CORNERS.forEach(([a, b], s) => {
      const pts = []; for (let i = 0; i < n; i++) pts.push(corner(i, a, b));
      this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: railColors[s] })));
    });
    const ribMat = new THREE.LineBasicMaterial({ color: 0x5b8fc8, transparent: true, opacity: 0.45 });
    for (let i = 0; i < n; i += Math.round(6 / track.ds)) {
      const c = CORNERS.map(([a, b]) => corner(i, a, b)); c.push(c[0]);
      this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(c), ribMat));
    }
    this.addGate(track, 0, 0x45f4d0, 'START');
    this.addGate(track, n - 1, 0xffb454, 'FINISH');
  }
  addGate(track, i, color, label) {
    const { P, R, U } = track, hh = track.half - 0.12;
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(
      P[i * 3] + R[i * 3] * a * hh + U[i * 3] * b * hh, P[i * 3 + 1] + R[i * 3 + 1] * a * hh + U[i * 3 + 1] * b * hh, P[i * 3 + 2] + R[i * 3 + 2] * a * hh + U[i * 3 + 2] * b * hh));
    c.push(c[0]);
    this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(c), new THREE.LineBasicMaterial({ color })));
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    const x = cv.getContext('2d'); x.fillStyle = '#' + color.toString(16).padStart(6, '0'); x.font = 'bold 54px monospace'; x.textAlign = 'center'; x.fillText(label, 256, 80);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.position.set(P[i * 3] + U[i * 3] * 6.5, P[i * 3 + 1] + U[i * 3 + 1] * 6.5, P[i * 3 + 2] + U[i * 3 + 2] * 6.5);
    sp.scale.set(10, 2.2, 1); this.group.add(sp);
  }
}

// 개체군 전체를 draw call 2번(몸통+기수)으로 그린다.
export class FleetView {
  constructor(scene, maxN = 160) {
    this.maxN = maxN;
    this.body = new THREE.InstancedMesh(new THREE.BoxGeometry(0.72, 0.22, 0.95), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.4, roughness: 0.35, emissive: 0x0a2a35 }), maxN);
    const noseGeo = new THREE.ConeGeometry(0.16, 0.36, 8); noseGeo.rotateX(-Math.PI / 2);   // 뾰족한 끝이 전방(-Z)
    this.nose = new THREE.InstancedMesh(noseGeo, new THREE.MeshBasicMaterial({ color: 0xefffff }), maxN);
    const col = new THREE.Color();
    for (let i = 0; i < maxN; i++) this.body.setColorAt(i, col.setHSL((i * 0.137) % 1, 0.8, 0.58));
    for (const m of [this.body, this.nose]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = 0; scene.add(m); }
    this._o = new THREE.Object3D(); this._o.rotation.order = 'YXZ';
    this._noseLocal = new THREE.Matrix4().makeTranslation(0, 0, -0.58);
    this._m = new THREE.Matrix4();
  }
  set visible(v) { this.body.visible = this.nose.visible = v; }
  update(envs) {
    const o = this._o, n = Math.min(envs.length, this.maxN);
    for (let i = 0; i < n; i++) {
      const e = envs[i];
      o.position.set(e.x, e.y, e.z); o.rotation.set(e.pitch, e.yaw, e.roll);
      o.scale.setScalar(e.done ? 0.0001 : 1);           // 끝난 개체는 숨김
      o.updateMatrix();
      this.body.setMatrixAt(i, o.matrix);
      this.nose.setMatrixAt(i, this._m.multiplyMatrices(o.matrix, this._noseLocal));
    }
    this.body.count = this.nose.count = n;
    this.body.instanceMatrix.needsUpdate = this.nose.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
}

// 카메라가 따라가는 1대만 프로펠러/팔이 있는 상세 모델로 그린다.
export class HeroDrone {
  constructor(scene) {
    this.group = new THREE.Group(); scene.add(this.group);
    this.group.add(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.22, 0.95), new THREE.MeshStandardMaterial({ color: 0x43e7f5, metalness: 0.55, roughness: 0.28, emissive: 0x06303a })));
    const armMat = new THREE.MeshStandardMaterial({ color: 0x9db5ce, metalness: 0.7, roughness: 0.25 });
    const armGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.72, 8), propGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.025, 16);
    const propMat = new THREE.MeshBasicMaterial({ color: 0x43e7f5, transparent: true, opacity: 0.7 });
    this.props = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, armMat); arm.rotation.z = Math.PI / 2; arm.position.set(sx * 0.46, 0.03, sz * 0.34); this.group.add(arm);
      const prop = new THREE.Mesh(propGeo, propMat); prop.position.set(sx * 0.72, 0.12, sz * 0.52); this.group.add(prop); this.props.push(prop);
    }
    const noseGeo = new THREE.ConeGeometry(0.16, 0.36, 8); noseGeo.rotateX(-Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, new THREE.MeshBasicMaterial({ color: 0xefffff })); nose.position.z = -0.58; this.group.add(nose);
    this.group.rotation.order = 'YXZ'; this.group.visible = false;
  }
  update(env, dt) {
    if (!env) { this.group.visible = false; return; }
    this.group.position.set(env.x, env.y, env.z); this.group.rotation.set(env.pitch, env.yaw, env.roll);
    for (const p of this.props) p.rotation.y += 40 * dt;
  }
}
