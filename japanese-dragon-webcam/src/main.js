import './style.css';
import * as THREE from 'three';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
const statusEl = $('status'), gestureEl = $('gesture'), hintEl = $('hint');
const trackingEl = $('tracking'), dragonStateEl = $('dragon-state');
const chargeEl = $('charge'), meterFill = $('meter-fill'), errorEl = $('error');
const video = $('webcam'), overlay = $('hand-overlay'), overlayCtx = overlay.getContext('2d');
let stream = null, handLandmarker = null, cameraActive = false, lastVideoTime = -1;
let currentGesture = 'NONE', handTarget = new THREE.Vector3(0, 0.4, 0);
let fireCharge = 0, firingUntil = 0, lastFireAt = 0, trackingSeenAt = 0;

// ---------- Three.js scene ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x07131f, 0.028);
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 120);
camera.position.set(0, 2.1, 10.8);
const clock = new THREE.Clock();

scene.add(new THREE.HemisphereLight(0x9bcbdc, 0x09101b, 2.0));
const keyLight = new THREE.DirectionalLight(0xd3f4ff, 3.2); keyLight.position.set(-4, 7, 5); scene.add(keyLight);
const rimLight = new THREE.PointLight(0x32d7d1, 32, 18); rimLight.position.set(4, 2, -2); scene.add(rimLight);
const fireLight = new THREE.PointLight(0xff572d, 0, 9); scene.add(fireLight);

// atmosphere particles
const starCount = 650, starPositions = new Float32Array(starCount * 3);
for (let i=0;i<starCount;i++){ starPositions[i*3]=(Math.random()-.5)*34; starPositions[i*3+1]=(Math.random()-.5)*20; starPositions[i*3+2]=-Math.random()*24; }
const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions,3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({color:0x7cb7c7,size:.035,transparent:true,opacity:.65}));
scene.add(stars);

// soft distant moon
const moon = new THREE.Mesh(new THREE.SphereGeometry(1.05,32,32), new THREE.MeshBasicMaterial({color:0x8dc9cf,transparent:true,opacity:.12}));
moon.position.set(4.6,3.8,-9); scene.add(moon);
const moonGlow = new THREE.Mesh(new THREE.SphereGeometry(1.35,32,32), new THREE.MeshBasicMaterial({color:0x45b7bd,transparent:true,opacity:.035,side:THREE.BackSide}));
moonGlow.position.copy(moon.position); scene.add(moonGlow);

// materials
const scaleMat = new THREE.MeshStandardMaterial({color:0x123f3d,metalness:.48,roughness:.34});
const bellyMat = new THREE.MeshStandardMaterial({color:0xb6a77b,metalness:.22,roughness:.48});
const bellyEdgeMat = new THREE.MeshStandardMaterial({color:0x5f7c67,metalness:.32,roughness:.42});
const darkMat = new THREE.MeshStandardMaterial({color:0x101e27,metalness:.72,roughness:.27});
const hornMat = new THREE.MeshStandardMaterial({color:0xc5b995,metalness:.45,roughness:.3});
const maneMat = new THREE.MeshStandardMaterial({color:0x246b62,metalness:.42,roughness:.32});
const eyeMat = new THREE.MeshStandardMaterial({color:0xffb13c,emissive:0xff5a13,emissiveIntensity:2.8,metalness:.2,roughness:.18});
const blackMat = new THREE.MeshStandardMaterial({color:0x071015,metalness:.2,roughness:.3});
const finMat = new THREE.MeshStandardMaterial({color:0x2b797a,metalness:.35,roughness:.35,side:THREE.DoubleSide,transparent:true,opacity:.88});
const fireCoreMat = new THREE.MeshBasicMaterial({color:0xffe5a1});
const fireOuterMat = new THREE.MeshBasicMaterial({color:0xff5624,transparent:true,opacity:.8,side:THREE.DoubleSide});

// root is animated in the render loop
const dragon = new THREE.Group(); scene.add(dragon);
const bodyGroup = new THREE.Group(); dragon.add(bodyGroup);
const detailGroup = new THREE.Group(); dragon.add(detailGroup);
// Larger hero framing: keep the creature visually dominant rather than insect-sized.
dragon.scale.setScalar(1.28);
const wingPivots = [];
const bodyNodes = [];
const bellyPlates = [];
const dorsalSpines = [];
const sphereGeo = new THREE.SphereGeometry(1,16,12);
function ellipsoid(parent, mat, pos, scale, segments=18) {
  const mesh = new THREE.Mesh(segments===16?sphereGeo:new THREE.SphereGeometry(1,segments,Math.max(8,segments-4)),mat);
  mesh.position.set(...pos); mesh.scale.set(...scale); parent.add(mesh); return mesh;
}
function rod(parent, start, end, radius, material, radial=8) {
  const a=new THREE.Vector3(...start), b=new THREE.Vector3(...end), d=b.clone().sub(a);
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius*.6,radius,d.length(),radial),material);
  mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()); parent.add(mesh); return mesh;
}
function curveTube(parent, points, radius, material, tubular=18, radial=7) {
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
  const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,tubular,radius,radial,false),material); parent.add(mesh); return mesh;
}
// Main long coiling body: layered rounded segments follow an animated spine.
const segmentCount=39;
for(let i=0;i<segmentCount;i++){
  const t=i/(segmentCount-1);
  const s=1-t;
  const radius=(.43*Math.pow(s,.58)+.045);
  const seg=ellipsoid(bodyGroup, i%3===0?bellyMat:scaleMat,[0,0,0],[radius*1.2,radius*.98,radius*1.5],14);
  bodyNodes.push({mesh:seg,t,radius});
  // little dorsal scutes on alternating segments
  if(i%2===0 && i<segmentCount-4){
    const spike=new THREE.Mesh(new THREE.ConeGeometry(Math.max(.055,radius*.29),Math.max(.16,radius*.82),6),maneMat);
    bodyGroup.add(spike); seg.userData.spike=spike; dorsalSpines.push(spike);
  }
  if(i>1 && i<segmentCount-3 && i%1===0){
    const plate=ellipsoid(bodyGroup, i%2===0?bellyMat:bellyEdgeMat,[0,0,0],[radius*.72,.075,radius*.58],10);
    bellyPlates.push({mesh:plate,t,radius,index:i});
  }
}
// neck and head
const neck=ellipsoid(detailGroup,scaleMat,[0,0,0],[.53,.49,.9],24);
const head=new THREE.Group(); detailGroup.add(head);
ellipsoid(head,scaleMat,[0,0,0],[.66,.49,.75],28);
ellipsoid(head,scaleMat,[0,-.16,.43],[.51,.25,.68],22);
ellipsoid(head,darkMat,[0,-.25,.65],[.44,.14,.51],20);
ellipsoid(head,bellyMat,[0,-.30,.59],[.34,.085,.42],18);
for(const side of [-1,1]){
  ellipsoid(head,scaleMat,[side*.44,.12,.05],[.2,.25,.24],18);
  ellipsoid(head,eyeMat,[side*.53,.17,.22],[.115,.12,.08],16);
  ellipsoid(head,blackMat,[side*.54,.17,.28],[.028,.085,.026],12);
  // horns sweep back
  curveTube(head,[[side*.25,.34,-.18],[side*.34,.64,-.29],[side*.48,.93,-.48],[side*.42,1.02,-.78]],.095,hornMat,16,8);
  // whiskers
  curveTube(head,[[side*.30,-.08,.52],[side*.62,-.12,.65],[side*.94,-.03,.90],[side*1.25,.18,1.02]],.023,hornMat,18,6);
  // brow
  curveTube(head,[[side*.28,.27,.12],[side*.43,.30,.23],[side*.59,.23,.18]],.055,maneMat,10,7);
  // small cheek mane spikes
  for(let j=0;j<3;j++){
    const y=.03-j*.13;
    const m=new THREE.Mesh(new THREE.ConeGeometry(.105,.32,7),maneMat);
    m.position.set(side*(.43+j*.025),y,-.08-j*.12);m.rotation.z=side*-0.8;head.add(m);
  }
}
// snout nostrils and ears
for(const side of [-1,1]){
  ellipsoid(head,blackMat,[side*.18,-.08,.78],[.055,.035,.05],10);
  curveTube(head,[[side*.35,.17,-.12],[side*.55,.38,-.18],[side*.66,.31,-.36]],.045,hornMat,10,6);
}
// Four little limbs with claws
const limbs=[];
for(const side of [-1,1]) for(const z of [-.36,.45]){
  const limb=new THREE.Group(); detailGroup.add(limb); limb.userData={side,z};
  rod(limb,[0,0,0],[side*.15,-.26,.02],.11,scaleMat);
  rod(limb,[side*.15,-.26,.02],[side*.28,-.34,.16],.075,scaleMat);
  for(let c=0;c<3;c++){
    const dx=(c-1)*.075;
    rod(limb,[side*.28+dx,-.34,.16],[side*.30+dx,-.39,.24],.022,hornMat,6);
  }
  limbs.push(limb);
}
// Broad, bat-like dragon wings with a full membrane and strong finger bones.
for(const side of [-1,1]){
  const pivot=new THREE.Group(); pivot.position.set(side*.34,.25,-.28); detailGroup.add(pivot); wingPivots.push({pivot,side});
  const wingShape=new THREE.Shape();
  wingShape.moveTo(0,0);
  wingShape.quadraticCurveTo(side*.52,.62,side*1.25,.88);
  wingShape.lineTo(side*1.88,.72);
  wingShape.quadraticCurveTo(side*1.75,.43,side*1.70,.28);
  wingShape.lineTo(side*2.12,.02);
  wingShape.quadraticCurveTo(side*1.73,.00,side*1.48,-.12);
  wingShape.lineTo(side*1.62,-.42);
  wingShape.quadraticCurveTo(side*1.15,-.30,side*.98,-.68);
  wingShape.lineTo(side*.63,-.38);
  wingShape.lineTo(side*.32,-.16);
  wingShape.quadraticCurveTo(side*.14,-.05,0,0);
  const membraneMat=new THREE.MeshStandardMaterial({color:0x255e5b,metalness:.18,roughness:.52,side:THREE.DoubleSide,transparent:true,opacity:.91,emissive:0x071c1b,emissiveIntensity:.45});
  const membrane=new THREE.Mesh(new THREE.ShapeGeometry(wingShape,20),membraneMat); pivot.add(membrane);
  // Thick leading edge and individual curved finger bones create a dragon-wing silhouette.
  curveTube(pivot,[[0,0,0],[side*.42,.42,0],[side*1.25,.88,0],[side*1.88,.72,0]],.055,hornMat,20,7);
  const fingers=[
    [[0,0,0],[side*.70,.12,0],[side*1.70,.28,0]],
    [[0,0,0],[side*.66,-.08,0],[side*2.12,.02,0]],
    [[0,0,0],[side*.58,-.12,0],[side*1.62,-.42,0]],
    [[0,0,0],[side*.38,-.10,0],[side*.98,-.68,0]],
    [[0,0,0],[side*.24,-.04,0],[side*.63,-.38,0]]
  ];
  for(const path of fingers) curveTube(pivot,path,.027,hornMat,12,6);
  // Fine membrane ribs between the bones.
  curveTube(pivot,[[side*.40,.08,.005],[side*.70,.35,.005],[side*1.22,.60,.005]],.012,maneMat,10,5);
  curveTube(pivot,[[side*.34,-.03,.005],[side*.72,-.02,.005],[side*1.40,.12,.005]],.012,maneMat,10,5);
}
// tail tuft
for(let i=0;i<5;i++){
  const side=(i-2)*.11;
  curveTube(detailGroup,[[0,0,0],[side*.5,.1,-.25],[side,.15,-.50]],.045,maneMat,10,6);
}

// Dynamic fire particles
const MAX_FIRE=420, particles=[];
const particleGeo=new THREE.BufferGeometry(), particlePositions=new Float32Array(MAX_FIRE*3), particleColors=new Float32Array(MAX_FIRE*3), particleSizes=new Float32Array(MAX_FIRE);
for(let i=0;i<MAX_FIRE;i++){particles.push({life:0,vel:new THREE.Vector3(),pos:new THREE.Vector3(),size:0});}
particleGeo.setAttribute('position',new THREE.BufferAttribute(particlePositions,3));
particleGeo.setAttribute('color',new THREE.BufferAttribute(particleColors,3));
particleGeo.setAttribute('size',new THREE.BufferAttribute(particleSizes,1));
const particleMat=new THREE.PointsMaterial({size:.18,vertexColors:true,transparent:true,opacity:.95,depthWrite:false,blending:THREE.AdditiveBlending,sizeAttenuation:true});
const firePoints=new THREE.Points(particleGeo,particleMat);scene.add(firePoints);
function spawnFire(origin, direction, amount=7){
  for(let n=0;n<amount;n++){
    let p=particles.find(p=>p.life<=0); if(!p) p=particles[Math.floor(Math.random()*MAX_FIRE)];
    p.life=.45+Math.random()*.55;p.pos.copy(origin);
    p.pos.x+=(Math.random()-.5)*.16;p.pos.y+=(Math.random()-.5)*.16;p.pos.z+=(Math.random()-.5)*.16;
    p.vel.copy(direction).multiplyScalar(3.0+Math.random()*4.5);
    p.vel.x+=(Math.random()-.5)*1.4;p.vel.y+=(Math.random()-.5)*1.4;p.vel.z+=(Math.random()-.5)*1.4;
    p.size=.08+Math.random()*.20;
  }
}
function updateFire(dt,time){
  const active=performance.now()<firingUntil;
  const mouth=head.localToWorld(new THREE.Vector3(0,-.16,.98));
  const direction=new THREE.Vector3(.05,0,1).applyQuaternion(dragon.quaternion).normalize();
  if(active){for(let i=0;i<12;i++)spawnFire(mouth,direction,1);fireLight.position.copy(mouth);fireLight.intensity=18+Math.random()*12;}
  else fireLight.intensity=Math.max(0,fireLight.intensity-dt*40);
  for(let i=0;i<MAX_FIRE;i++){
    const p=particles[i];
    if(p.life>0){p.life-=dt;p.pos.addScaledVector(p.vel,dt);p.vel.multiplyScalar(1-dt*.65);p.vel.y+=dt*.8;
      const idx=i*3;particlePositions[idx]=p.pos.x;particlePositions[idx+1]=p.pos.y;particlePositions[idx+2]=p.pos.z;
      const hot=Math.min(1,p.life*2.5);particleColors[idx]=1;particleColors[idx+1]=.18+hot*.62;particleColors[idx+2]=.035+hot*.10;particleSizes[i]=p.size*Math.max(.1,p.life);}
    else{particleSizes[i]=0;particlePositions[i*3+1]=-1000;}
  }
  particleGeo.attributes.position.needsUpdate=true;particleGeo.attributes.color.needsUpdate=true;particleGeo.attributes.size.needsUpdate=true;
}

// ---------- Hand tracking ----------
async function startCamera(){
  errorEl.classList.remove('show');
  $('start').disabled=true; $('start').textContent='INITIALIZING…';
  try{
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is unavailable. Open this site on localhost in Chrome or another modern browser.');
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false});
    video.srcObject=stream;
    await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject;});
    await video.play();
    $('camera-placeholder').style.display='none';$('camera-state').textContent='ACTIVE';$('camera-state').style.color='#82d9bb';
    statusEl.textContent='CAMERA CONNECTED';$('stop').disabled=false;cameraActive=true;
    $('intro').classList.add('hidden');
    trackingEl.textContent='LOADING MODEL';
    const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
    handLandmarker=await HandLandmarker.createFromOptions(vision,{
      baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',delegate:'GPU'},
      runningMode:'VIDEO',numHands:1,
      minHandDetectionConfidence:.55,minHandPresenceConfidence:.5,minTrackingConfidence:.5
    });
    trackingEl.textContent='SEARCHING';
    gestureEl.textContent='SHOW YOUR HAND';hintEl.textContent='Keep your hand visible in the camera preview';
    $('start').textContent='CAMERA ACTIVE';
  }catch(err){
    console.error(err); stopCamera();
    const msg=err?.name==='NotAllowedError'?'Camera permission was blocked. Allow camera access in your browser and try again.':`Could not start camera/hand tracking: ${err.message || err}. Check your internet connection because the hand-tracking model loads from Google’s CDN.`;
    errorEl.textContent=msg;errorEl.classList.add('show');$('start').disabled=false;$('start').innerHTML='TRY AGAIN <span>↗</span>';
  }
}
function stopCamera(){
  cameraActive=false;
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  video.srcObject=null;
  if(handLandmarker){handLandmarker.close();handLandmarker=null;}
  $('camera-placeholder').style.display='grid';$('camera-state').textContent='OFF';$('camera-state').style.color='#d5a86a';
  $('stop').disabled=true;statusEl.textContent='CAMERA OFFLINE';trackingEl.textContent='STANDBY';
  $('intro').classList.remove('hidden');$('start').disabled=false;$('start').innerHTML='ACTIVATE CAMERA <span>↗</span>';
  overlayCtx.clearRect(0,0,overlay.width,overlay.height);
  currentGesture='NONE';fireCharge=0;firingUntil=0;
}
$('start').addEventListener('click',startCamera);$('stop').addEventListener('click',stopCamera);
window.addEventListener('beforeunload',()=>{if(stream)stream.getTracks().forEach(t=>t.stop());});

function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function classifyGesture(lm){
  // Landmark indices: fingertips 8/12/16/20, PIP joints 6/10/14/18; wrist 0.
  const extended=[];
  for(const [tip,pip] of [[8,6],[12,10],[16,14],[20,18]]) extended.push(lm[tip].y < lm[pip].y - .015);
  const index=extended[0], middle=extended[1], ring=extended[2], pinky=extended[3];
  const thumbOut=distance(lm[4],lm[5])>distance(lm[3],lm[5])*1.12;
  if(index&&middle&&!ring&&!pinky) return 'V_SIGN';
  if(!index&&!middle&&!ring&&!pinky) return 'FIST';
  if(index&&middle&&ring&&pinky) return 'OPEN_PALM';
  if(index&&!middle&&!ring&&!pinky) return 'POINT';
  if(thumbOut&&index&&middle&&ring&&pinky) return 'OPEN_PALM';
  return 'OTHER';
}
function drawHand(lm){
  const w=overlay.width=video.videoWidth||640,h=overlay.height=video.videoHeight||480;
  overlayCtx.clearRect(0,0,w,h);if(!lm)return;
  const chains=[[0,1,2,3,4],[0,5,6,7,8],[5,9,10,11,12],[9,13,14,15,16],[13,17,18,19,20],[0,17]];
  overlayCtx.lineWidth=Math.max(2,w/260);overlayCtx.strokeStyle='#9cebd8';overlayCtx.fillStyle='#fff0b3';
  for(const chain of chains){overlayCtx.beginPath();chain.forEach((idx,j)=>{const p=lm[idx];if(j===0)overlayCtx.moveTo(p.x*w,p.y*h);else overlayCtx.lineTo(p.x*w,p.y*h);});overlayCtx.stroke();}
  for(const p of lm){overlayCtx.beginPath();overlayCtx.arc(p.x*w,p.y*h,Math.max(2,w/170),0,Math.PI*2);overlayCtx.fill();}
}
function processHand(){
  if(!cameraActive||!handLandmarker||video.readyState<2)return;
  if(video.currentTime===lastVideoTime)return;
  lastVideoTime=video.currentTime;
  const result=handLandmarker.detectForVideo(video,performance.now());
  if(result.landmarks?.length){
    const lm=result.landmarks[0];trackingSeenAt=performance.now();trackingEl.textContent='TRACKING';drawHand(lm);
    const gesture=classifyGesture(lm);currentGesture=gesture;
    // Map normalized camera position into scene coordinates. Mirrored preview matches user control.
    handTarget.x=(.5-lm[9].x)*9;
    handTarget.y=(.5-lm[9].y)*5.2;
    const labels={OPEN_PALM:['OPEN PALM','Fly and steer by moving your hand'],FIST:['FIST · CHARGING','Hold your fist to charge the flame'],V_SIGN:['V SIGN · FIRE','Release the dragon’s fire breath'],POINT:['POINT · STEER','Point to guide the dragon'],OTHER:['HAND DETECTED','Try an open palm, fist, or V sign']};
    const info=labels[gesture]||['HAND DETECTED','Try an open palm, fist, or V sign'];
    gestureEl.textContent=info[0];hintEl.textContent=info[1];
    if(gesture==='FIST')fireCharge=Math.min(100,fireCharge+1.6);
    else if(gesture!=='V_SIGN')fireCharge=Math.max(0,fireCharge-.75);
    if(gesture==='V_SIGN'&&performance.now()-lastFireAt>900){firingUntil=performance.now()+1150;lastFireAt=performance.now();fireCharge=0;}
    dragonStateEl.textContent=gesture==='FIST'?'CHARGING':gesture==='V_SIGN'?'FIRE BREATH':gesture==='OPEN_PALM'||gesture==='POINT'?'IN FLIGHT':'AWAKE';
  }else{
    drawHand(null);
    if(performance.now()-trackingSeenAt>650){trackingEl.textContent='SEARCHING';gestureEl.textContent='SHOW YOUR HAND';hintEl.textContent='Keep your hand visible in the camera preview';currentGesture='NONE';fireCharge=Math.max(0,fireCharge-1);}
  }
  chargeEl.textContent=`${Math.round(fireCharge).toString().padStart(2,'0')}%`;meterFill.style.width=`${fireCharge}%`;
}

// ---------- Flight animation ----------
const targetPos=new THREE.Vector3();
function updateDragon(time,dt){
  processHand();
  const active=performance.now()<firingUntil;
  // Automatic graceful flight when no hand is detected; hand tracking overrides target.
  const hasHand=performance.now()-trackingSeenAt<650&&currentGesture!=='NONE';
  if(!hasHand){
    targetPos.set(Math.sin(time*.34)*1.35,Math.sin(time*.62)*.52+.25,Math.cos(time*.27)*.45);
  }else targetPos.copy(handTarget);
  dragon.position.lerp(targetPos,1-Math.exp(-dt*2.6));
  dragon.position.y+=Math.sin(time*2.1)*dt*.09;
  dragon.rotation.z=THREE.MathUtils.lerp(dragon.rotation.z,hasHand?THREE.MathUtils.clamp(-handTarget.y*.09,-.42,.42):Math.sin(time*.55)*.08,dt*2);
  dragon.rotation.y=THREE.MathUtils.lerp(dragon.rotation.y,hasHand?THREE.MathUtils.clamp(-handTarget.x*.10,-.5,.5):Math.sin(time*.28)*.18,dt*1.5);
  dragon.rotation.x=Math.sin(time*.75)*.035;
  const wingBeat= Math.sin(time*(active?15:5.4));
  wingPivots.forEach(({pivot,side})=>{pivot.rotation.z=side*(.2+wingBeat*.36);pivot.rotation.x=.08+Math.cos(time*5.4)*.12;});
  // Curving, serpentine spine with subtle travelling wave.
  const points=[];
  for(let i=0;i<segmentCount;i++){
    const t=i/(segmentCount-1);
    const x=Math.sin(t*4.7-time*1.25)*(.13+t*.45);
    const y=Math.sin(t*5.8-time*1.7)*(.10+t*.28);
    const z=.68-t*5.15;
    points.push(new THREE.Vector3(x,y,z));
  }
  bodyNodes.forEach(({mesh,t,radius},i)=>{
    const p=points[i];mesh.position.copy(p);
    mesh.scale.set(radius*1.2,radius*.98,radius*1.5);
    mesh.rotation.y=Math.cos(t*4.7-time*1.25)*.25;
    mesh.rotation.x=Math.sin(t*5.8-time*1.7)*.16;
    if(mesh.userData.spike){mesh.userData.spike.position.set(p.x,p.y+radius*.78,p.z);mesh.userData.spike.rotation.z=Math.sin(time+t*6)*.08;}
  });
  bellyPlates.forEach(({mesh,t,radius,index})=>{const p=points[index];mesh.position.set(p.x,p.y-radius*.72,p.z);mesh.rotation.x=Math.sin(t*5.8-time*1.7)*.16;mesh.rotation.y=Math.cos(t*4.7-time*1.25)*.2;});
  const neckPoint=points[0];neck.position.set(neckPoint.x,neckPoint.y,neckPoint.z+.25);
  head.position.set(neckPoint.x,neckPoint.y+.02,neckPoint.z+.82);
  head.rotation.y=Math.sin(time*.8)*.07+(hasHand?handTarget.x*.035:0);
  head.rotation.x=Math.sin(time*1.4)*.025;
  limbs.forEach((limb,i)=>{const {side,z}=limb.userData;const p=points[z<0?7:4];limb.position.set(p.x+side*.2,p.y-.04,p.z);limb.rotation.z=side*(.15+Math.sin(time*4+i)*.08);});
  updateFire(dt,time);
  stars.rotation.y=time*.003;
}
function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.05),time=clock.elapsedTime;
  updateDragon(time,dt);
  renderer.render(scene,camera);
}
animate();
window.addEventListener('resize',()=>{
  camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth,window.innerHeight);renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));
});
