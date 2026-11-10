import * as THREE from 'three';

export class TunnelTrack {
  constructor(scene) {
    this.scene=scene;
    this.half=5.0;
    this.curve=new THREE.CatmullRomCurve3([
      new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-24),
      new THREE.Vector3(5,2,-48), new THREE.Vector3(13,5,-70),
      new THREE.Vector3(15,10,-94), new THREE.Vector3(5,13,-118),
      new THREE.Vector3(-8,9,-143), new THREE.Vector3(-13,2,-168),
      new THREE.Vector3(-5,-3,-193), new THREE.Vector3(8,-1,-218),
      new THREE.Vector3(13,5,-242), new THREE.Vector3(0,8,-270)
    ],false,'catmullrom',0.45);
    this.samples= this.curve.getPoints(1000);
    this.frames=[];
    const up=new THREE.Vector3(0,1,0);
    for(let i=0;i<this.samples.length;i++){
      const t=i/(this.samples.length-1);
      const tangent=this.curve.getTangent(t).normalize();
      let right=new THREE.Vector3().crossVectors(tangent,up).normalize();
      if(right.lengthSq()<0.01) right.set(1,0,0);
      const normal=new THREE.Vector3().crossVectors(right,tangent).normalize();
      this.frames.push({p:this.samples[i],tangent,right,normal,t});
    }
    this.group=new THREE.Group(); scene.add(this.group);
    this.buildTunnel(); this.buildGates();
  }
  frameAt(t){const i=Math.max(0,Math.min(this.frames.length-1,Math.round(t*(this.frames.length-1))));return this.frames[i];}
  nearest(pos){
    let best=0,bd=Infinity;
    // Coarse-to-fine search around last-independent global nearest. 1001 points is inexpensive at this scale.
    for(let i=0;i<this.samples.length;i+=3){const d=this.samples[i].distanceToSquared(pos);if(d<bd){bd=d;best=i;}}
    for(let i=Math.max(0,best-4);i<=Math.min(this.samples.length-1,best+4);i++){const d=this.samples[i].distanceToSquared(pos);if(d<bd){bd=d;best=i;}}
    return {index:best,t:best/(this.samples.length-1),frame:this.frames[best],distance:Math.sqrt(bd)};
  }
  local(pos,frame){const d=pos.clone().sub(frame.p);return {x:d.dot(frame.right),y:d.dot(frame.normal),z:d.dot(frame.tangent)};}
  buildTunnel(){
    const verts=[],normals=[],uv=[],indices=[];const n=this.samples.length, sides=4;
    for(let i=0;i<n;i++){
      const f=this.frames[i];
      const corners=[
        f.right.clone().multiplyScalar(-this.half).addScaledVector(f.normal,-this.half),
        f.right.clone().multiplyScalar(this.half).addScaledVector(f.normal,-this.half),
        f.right.clone().multiplyScalar(this.half).addScaledVector(f.normal,this.half),
        f.right.clone().multiplyScalar(-this.half).addScaledVector(f.normal,this.half)
      ];
      for(let s=0;s<4;s++){const p=f.p.clone().add(corners[s]);verts.push(p.x,p.y,p.z);uv.push(s/4,i/40);}
    }
    for(let i=0;i<n-1;i++)for(let s=0;s<4;s++){const a=i*4+s,b=i*4+(s+1)%4,c=(i+1)*4+(s+1)%4,d=(i+1)*4+s;indices.push(a,b,d,b,c,d);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
    const mat=new THREE.MeshStandardMaterial({color:0x101e35,metalness:.35,roughness:.48,side:THREE.DoubleSide,transparent:true,opacity:.32});
    this.group.add(new THREE.Mesh(g,mat));
    // bright longitudinal edge rails
    for(let s=0;s<4;s++){
      const pts=this.frames.map(f=>{const r=s===0||s===3?-this.half:this.half;const u=s<2?-this.half:this.half;return f.p.clone().addScaledVector(f.right,r).addScaledVector(f.normal,u);});
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:s%2?0x1f8fff:0x28e9f3,transparent:true,opacity:.9}));
      this.group.add(line);
    }
    // segmented cross-section ribs
    for(let i=0;i<n;i+=25){
      const f=this.frames[i];const c=[
        f.p.clone().addScaledVector(f.right,-this.half).addScaledVector(f.normal,-this.half),
        f.p.clone().addScaledVector(f.right,this.half).addScaledVector(f.normal,-this.half),
        f.p.clone().addScaledVector(f.right,this.half).addScaledVector(f.normal,this.half),
        f.p.clone().addScaledVector(f.right,-this.half).addScaledVector(f.normal,this.half)
      ];c.push(c[0]);this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(c),new THREE.LineBasicMaterial({color:0x426c9e,transparent:true,opacity:.35})));
    }
    this.addGate(0,0x45f4d0,'START');this.addGate(1,0xffb454,'FINISH');
  }
  addGate(t,color,label){
    const f=this.frameAt(t),h=this.half-.12;
    const c=[f.p.clone().addScaledVector(f.right,-h).addScaledVector(f.normal,-h),f.p.clone().addScaledVector(f.right,h).addScaledVector(f.normal,-h),f.p.clone().addScaledVector(f.right,h).addScaledVector(f.normal,h),f.p.clone().addScaledVector(f.right,-h).addScaledVector(f.normal,h)];
    c.push(c[0]);const gate=new THREE.Line(new THREE.BufferGeometry().setFromPoints(c),new THREE.LineBasicMaterial({color,linewidth:2}));this.group.add(gate);
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:this.makeLabel(label,color),transparent:true}));sprite.position.copy(f.p).addScaledVector(f.normal,6.5);sprite.scale.set(10,2.2,1);this.group.add(sprite);
  }
  makeLabel(text,color){const c=document.createElement('canvas');c.width=512;c.height=128;const x=c.getContext('2d');x.fillStyle='#'+color.toString(16).padStart(6,'0');x.font='bold 54px monospace';x.textAlign='center';x.fillText(text,256,80);const t=new THREE.CanvasTexture(c);return t;}
  collision(pos){
    const n=this.nearest(pos),l=this.local(pos,n.frame);
    return {hit:Math.abs(l.x)>this.half-.38||Math.abs(l.y)>this.half-.38||n.t>=1,progress:n.t,local:l,frame:n.frame};
  }
}
