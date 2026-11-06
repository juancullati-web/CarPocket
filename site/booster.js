/* Le booster de la semaine : un sachet à déchirer, trois voitures à découvrir.
   Tout vit dans un arbre isolé (Shadow DOM), pour ne rien changer au reste du site.
   Le relief ne démarre qu'à l'ouverture : la connexion n'en paie jamais le prix.
   Tant que la réserve et la base n'existent pas, tout ceci reste réservé à l'aperçu local. */
(() => {
  if (!["localhost", "127.0.0.1"].includes(location.hostname)) {
    window.CarPocketBooster = { afterEnter() {}, renderTile() {} };
    return;
  }
  const VERSION = document.querySelector('script[src^="booster.js"]')?.getAttribute("src").split("v=")[1] || "";
  const host = document.createElement("div");
  host.id = "booster-host";
  host.hidden = true;
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<link rel="stylesheet" href="booster.css?v=${VERSION}">
<div id="stage">
  <div id="floor"></div>
  <div class="top-bar" id="bar">
    <span></span>
    <button type="button" class="quiet" id="skip">Passer l'animation</button>
  </div>
  <section class="screen" id="reveal" hidden>
    <div id="deck"></div>
    <div id="tray"><i></i><i></i><i></i></div>
    <p class="line" id="cardLine"></p>
  </section>
  <canvas id="gl"></canvas>
  <section class="screen" id="opening">
    <button type="button" id="pack" aria-label="Ouvrir le booster"><span id="hint"></span></button>
    <p class="line" id="packLine"><strong>Ton booster est prêt</strong>Déchire-le en glissant le doigt le long du haut, ou touche-le.
      <br><button type="button" class="quiet" id="laterBtn">Plus tard</button></p>
  </section>
  <section class="screen" id="summary" hidden>
    <div class="sum-inner">
      <h1>Tes 3 découvertes</h1>
      <div class="rows" id="rows"></div>
      <p class="note">Ajoute celles qui te plaisent. Les autres restent de côté, sans conséquence.</p>
      <button type="button" class="done" id="done">Terminer</button>
    </div>
  </section>
  <div id="flash"></div>
  <canvas id="shards"></canvas>
</div>
<dialog id="invite" aria-labelledby="invite-title">
  <div id="invite-art" aria-hidden="true"></div>
  <h2 id="invite-title"></h2>
  <p id="invite-text"></p>
  <button type="button" id="invite-open">Ouvrir</button>
  <button type="button" class="quiet" id="invite-later">Plus tard</button>
</dialog>`;
  document.body.append(host);

  let CARS = [];
  const LOGO_PATHS = [
    ["#7fb2f5", "M32 4 56.2 18 44.1 25 32 18z"],
    ["#1c69d4", "M32 4 7.8 18 19.9 25 32 18z"],
    ["#0653b6", "M7.8 18V46L19.9 39V25z"],
    ["#0a3f8a", "M7.8 46 32 60V46L19.9 39z"],
    ["#1c69d4", "M32 60 56.2 46 44.1 39 32 46z"],
  ];
  const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true">${LOGO_PATHS.map(([fill, d]) => `<path fill="${fill}" d="${d}"/>`).join("")}</svg>`;

  const $ = (id) => root.getElementById(id);
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((done) => setTimeout(done, calm ? Math.min(ms, 40) : ms));
  let touchedOnce = false;
  addEventListener("pointerdown", () => { touchedOnce = true; }, { capture: true });
  const buzz = (pattern) => { if (!touchedOnce) return; try { navigator.vibrate?.(pattern); } catch (_) { /* facultatif */ } };
  const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
  const stageBox = () => $("stage").getBoundingClientRect();

  /* Le film imprimé du sachet : dessiné une fois, puis plaqué sur le relief. */
  function drawArt() {
    const art = document.createElement("canvas");
    art.width = 1024; art.height = 1556;
    const ctx = art.getContext("2d");
    const W = art.width, H = art.height;
    const base = ctx.createLinearGradient(0, 0, W, H);
    base.addColorStop(0, "#26415f"); base.addColorStop(.5, "#101c2a"); base.addColorStop(1, "#1f3550");
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#1c69d4";
    const stripe = W * .135, gap = W * .04, left = W / 2 - gap / 2 - stripe;
    [[0, H * .128], [H * .5, H]].forEach(([top, bottom]) => {
      ctx.fillRect(left, top, stripe, bottom - top);
      ctx.fillRect(W / 2 + gap / 2, top, stripe, bottom - top);
    });
    ctx.save();
    ctx.translate(W / 2 - 145, H * .165);
    ctx.scale(290 / 64, 290 / 64);
    LOGO_PATHS.forEach(([fill, d]) => { ctx.fillStyle = fill; ctx.fill(new Path2D(d)); });
    ctx.restore();
    ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#fff";
    ctx.font = "700 112px Inter, Helvetica, Arial, sans-serif";
    const car = ctx.measureText("Car").width;
    ctx.font = "300 112px Inter, Helvetica, Arial, sans-serif";
    const pocket = ctx.measureText("Pocket").width;
    const start = W / 2 - (car + pocket) / 2;
    ctx.textAlign = "left";
    ctx.font = "700 112px Inter, Helvetica, Arial, sans-serif"; ctx.fillText("Car", start, H * .435);
    ctx.font = "300 112px Inter, Helvetica, Arial, sans-serif"; ctx.fillText("Pocket", start + car, H * .435);
    ctx.textAlign = "center";
    ctx.font = "700 150px Inter, Helvetica, Arial, sans-serif"; ctx.fillText("BOOSTER", W / 2, H * .79);
    ctx.font = "300 52px Inter, Helvetica, Arial, sans-serif"; ctx.fillText("3 voitures à découvrir", W / 2, H * .85);
    return art;
  }

  /* Le relief, la lumière et la déchirure : tout est calculé en direct, sans image de la déchirure. */
  const VERT = `#version 300 es
  precision highp float;
  in vec2 aUV;
  uniform vec2 uSize, uCenter, uStage, uRot;
  uniform float uFront, uDir, uPart, uFly, uDrop;
  out vec2 vUV; out vec3 vP;
  mat3 rx(float a){float c=cos(a),s=sin(a);return mat3(1.,0.,0., 0.,c,s, 0.,-s,c);}
  mat3 ry(float a){float c=cos(a),s=sin(a);return mat3(c,0.,-s, 0.,1.,0., s,0.,c);}
  void main(){
    vec2 uv=aUV;
    float bx=1.-pow(abs(2.*uv.x-1.),3.);
    float by=smoothstep(.0,.13,uv.y)*smoothstep(1.,.87,uv.y);
    float x=(uv.x-.5)*uSize.x*(1.-.022*bx*by), y=(.5-uv.y)*uSize.y;
    float z=bx*by*uSize.x*.085;
    if(uPart>1.5&&uPart<2.5){ z=-z*.6-2.; }
    if(uPart>2.5){ x*=.91; y=(.5-(uv.y*.72+.1-.018*smoothstep(0.,1.,uFront)))*uSize.y; z=-1.; }
    if(uPart>.5&&uPart<1.5){
      float up=uDir>0.?uv.x:1.-uv.x;
      float front=min(uFront,1.);
      float d=max(front-up,0.)*uSize.x;
      float r=uSize.x*.13;
      float a=min(d/r,2.5);
      float e=max(d-a*r,0.);
      float fx=(front-.5)*uSize.x;
      float xu=d>0.?fx-r*sin(a)-e*cos(a):(up-.5)*uSize.x;
      x=uDir>0.?xu:-xu;
      z+=r*(1.-cos(a))+e*sin(a);
      y+=d*.2*smoothstep(0.,uSize.x*.6,d)+(1.-cos(a))*uSize.y*.012;
      if(uFly>0.){
        float t=uFly;
        float ang=uDir*t*1.5;
        float c=cos(ang),s=sin(ang);
        float cy=uSize.y*.43;
        vec2 q=vec2(x,y-cy);
        x=q.x*c-q.y*s+uDir*t*uSize.x*.7;
        y=q.x*s+q.y*c+cy+t*uSize.y*.42-t*t*uSize.y*.05;
        z+=t*120.;
      }
    }
    vec3 p=ry(uRot.y)*rx(uRot.x)*vec3(x,y,z);
    p.xy+=uCenter; p.y-=uDrop;
    vUV=aUV; vP=p;
    float w=(1100.-p.z)/1100.;
    gl_Position=vec4(p.x*2./uStage.x, p.y*2./uStage.y, -p.z/2200.*w, w);
  }`;
  const FRAG = `#version 300 es
  precision highp float;
  in vec2 vUV; in vec3 vP;
  uniform sampler2D uArt;
  uniform float uFront, uDir, uPart;
  uniform vec2 uLight;
  out vec4 color;
  float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
  float ridge(vec2 p){return 1.-abs(2.*noise(p)-1.);}
  float tearV(float u){
    return .116+.018*(noise(vec2(u*4.,3.))-.5)+.012*(noise(vec2(u*13.,7.))-.5)+.007*(noise(vec2(u*41.,1.))-.5)+.004*(noise(vec2(u*130.,5.))-.5);
  }
  float height(vec2 uv){
    vec2 p=uv*vec2(1.,1.52);
    float h=noise(p*2.4)*.75+noise(p*5.3+4.)*.2;
    /* Les plis partent des soudures et meurent vers le centre, comme sur un vrai sachet. */
    float top=smoothstep(.3,.085,uv.y), bot=smoothstep(.7,.915,uv.y);
    h+=(top+bot)*(ridge(vec2(uv.x*9.,uv.y*1.3))*.34+ridge(vec2(uv.x*23.+3.,uv.y*1.8))*.1);
    return h;
  }
  vec3 env(vec3 r){
    vec3 c=mix(vec3(.018,.03,.05),vec3(.2,.27,.36),r.y*.5+.5);
    vec3 a=normalize(vec3(-.42+uLight.x*.5,.62+uLight.y*.4,.68));
    vec3 b=normalize(vec3(.55+uLight.x*.4,.12,.83));
    vec3 d=normalize(vec3(.05,-.72,.7));
    c+=vec3(1.)*1.15*pow(max(dot(r,a),0.),10.);
    c+=vec3(1.,.98,.95)*1.5*pow(max(dot(r,b),0.),70.);
    c+=vec3(.26,.5,.98)*.7*pow(max(dot(r,d),0.),5.);
    return c;
  }
  void main(){
    vec2 uv=vUV;
    float tooth=abs(fract(uv.x*23.)-.5)*2.;
    if(uv.y<.016*tooth||uv.y>1.-.016*tooth)discard;
    float up=uDir>0.?uv.x:1.-uv.x;
    float jitter=(noise(vec2(uv.y*90.,uv.x*9.))-.5)*.012;
    bool torn=up+jitter<uFront;
    float tv=tearV(uv.x);
    float band=0.;
    float bandW=.0045+.008*noise(vec2(uv.x*70.,2.));
    if(uPart<.5){
      if(torn&&uv.y<tv)discard;
      if(torn)band=1.-smoothstep(bandW*.5,bandW,uv.y-tv);
    }else if(uPart<1.5){
      if(!torn||uv.y>tv)discard;
      band=1.-smoothstep(bandW*.5,bandW,tv-uv.y);
    }else if(uPart<2.5){
      if(!torn||uv.y<tv+.006)discard;
    }
    vec3 N=normalize(cross(dFdx(vP),dFdy(vP)));
    if(N.z<0.)N=-N;
    if(uPart>2.5){
      float st=abs(uv.x-.5);
      vec3 c=mix(vec3(.05,.09,.14),vec3(.11,.41,.83),step(st,.14)*step(.02,st));
      color=vec4(c,1.);
      return;
    }
    float e=.005;
    float h0=height(uv);
    vec2 g=vec2(height(uv+vec2(e,0.))-h0,height(uv+vec2(0.,e))-h0)/e;
    /* Les soudures : de fines nervures droites, sans plis. */
    float seal=max(smoothstep(.086,.078,uv.y),smoothstep(.914,.922,uv.y));
    g=mix(g,vec2(sin(uv.x*300.)*7.,0.),seal);
    float k=gl_FrontFacing?.02:.012;
    vec3 n=normalize(N+vec3(-g.x*k,g.y*k,0.));
    vec3 R=reflect(vec3(0.,0.,-1.),n);
    vec3 E=env(R);
    vec3 col;
    if(!gl_FrontFacing||uPart>1.5){
      /* L'intérieur du sachet : aluminium brut. */
      vec3 silver=vec3(.66,.69,.72);
      col=silver*(.22+E*1.15);
      if(uPart>1.5)col*=.55;
    }else{
      vec3 alb=texture(uArt,uv).rgb;
      float white=smoothstep(.62,.9,min(alb.r,min(alb.g,alb.b)));
      vec3 irid=.5+.5*cos(6.283*(vec3(.0,.33,.67)+dot(n.xy,vec2(1.5,1.1))*1.3+uv.y*.5));
      col=alb*(.34+.5*n.z)+alb*E*1.25*(1.-white*.8)+E*.2*(1.-white)+irid*E.g*.09*(1.-white);
    }
    /* Le film arraché blanchit sur sa tranche, comme un vrai plastique déchiré. */
    float fibre=noise(vec2(uv.x*260.,uv.y*700.));
    col=mix(col,mix(vec3(.72,.76,.8),vec3(.99),fibre),band);
    color=vec4(col,1.);
  }`;

  const glCanvas = $("gl");
  let gl = null;
  const scene = { size: [280, 425], center: [0, 34], rot: [0, 0], aim: [0, 0], front: 0, goal: 0, dir: 1, fly: 0, drop: 0, showInside: true, light: [0, 0], running: false, pointer: false, view: [375, 812] };
  let drawGL = () => {};

  function setupGL(artCanvas) {
    gl = glCanvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!gl) return false;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const COLS = 90, ROWS = 110;
    const vertices = [], indices = [];
    for (let row = 0; row <= ROWS; row++) {
      // Plus de finesse en haut, là où le film se plie.
      const raw = row / ROWS;
      const v = raw < .5 ? raw * raw * 2 : raw;
      for (let col = 0; col <= COLS; col++) vertices.push(col / COLS, v);
    }
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      const a = row * (COLS + 1) + col, b = a + 1, c = a + COLS + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aUV");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, artCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    const u = {};
    ["uSize", "uCenter", "uStage", "uRot", "uFront", "uDir", "uPart", "uFly", "uDrop", "uLight"].forEach((name) => { u[name] = gl.getUniformLocation(program, name); });
    drawGL = () => {
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform2f(u.uSize, scene.size[0], scene.size[1]);
      gl.uniform2f(u.uCenter, scene.center[0], scene.center[1]);
      gl.uniform2f(u.uStage, scene.view[0], scene.view[1]);
      gl.uniform2f(u.uRot, scene.rot[0], scene.rot[1]);
      gl.uniform1f(u.uFront, scene.front);
      gl.uniform1f(u.uDir, scene.dir);
      gl.uniform1f(u.uFly, scene.fly);
      gl.uniform1f(u.uDrop, scene.drop);
      gl.uniform2f(u.uLight, scene.light[0], scene.light[1]);
      const part = (id) => {
        gl.uniform1f(u.uPart, id);
        gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
      };
      if (scene.front > 0 && scene.showInside) { part(3); part(2); }
      part(0);
      if (scene.front > 0 && scene.fly < 1) part(1);
    };
    return true;
  }

  function layoutPack() {
    const box = stageBox();
    const width = Math.min(box.width * .68, 300, (box.height - 210) * .63);
    const height = width * 1.52;
    scene.size = [width, height];
    scene.center = [0, 34];
    scene.view = [box.width, box.height];
    const pack = $("pack");
    pack.style.width = `${width}px`;
    pack.style.height = `${height}px`;
    pack.style.left = `${(box.width - width) / 2}px`;
    pack.style.top = `${box.height / 2 - scene.center[1] - height / 2}px`;
    const floor = $("floor");
    floor.style.width = `${width * 1.15}px`;
    floor.style.height = `${width * .24}px`;
    floor.style.top = `${box.height / 2 - scene.center[1] + height / 2 + 6}px`;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    glCanvas.width = Math.round(box.width * ratio);
    glCanvas.height = Math.round(box.height * ratio);
  }

  /* De la vie dans le sachet : il oscille doucement, et la lumière glisse sur les plis. */
  let lastTime = 0;
  function frame(now) {
    if (!scene.running) return;
    const dt = Math.min((now - lastTime) / 16.7, 3) || 1;
    lastTime = now;
    const t = now / 1000;
    const swayX = grip || scene.pointer ? 0 : Math.sin(t * .8) * .07;
    const swayY = grip || scene.pointer ? 0 : Math.sin(t * .55 + 1) * .2;
    scene.rot[0] += (scene.aim[0] + swayX - scene.rot[0]) * .09 * dt;
    scene.rot[1] += (scene.aim[1] + swayY - scene.rot[1]) * .09 * dt;
    scene.light = [scene.rot[1] * 1.2, scene.rot[0] * 1.2];
    const before = scene.front;
    scene.front += (scene.goal - scene.front) * .28 * dt;
    if (Math.abs(scene.goal - scene.front) < .0005) scene.front = scene.goal;
    if (scene.front > before + .002 && Math.random() < .35 && scene.front < 1.02) {
      const box = stageBox();
      const x = box.width / 2 + scene.dir * (scene.front - .5) * scene.size[0];
      const y = box.height / 2 - scene.center[1] - scene.size[1] * .385;
      burst(x, y, 1, 1.6);
      buzz(3);
    }
    drawGL();
    requestAnimationFrame(frame);
  }
  function startScene() {
    if (scene.running) return;
    scene.running = true;
    lastTime = performance.now();
    requestAnimationFrame(frame);
  }
  function stopScene() {
    scene.running = false;
    glCanvas.hidden = true;
    $("floor").hidden = true;
  }

  /* Quelques miettes de film, pas de confettis. */
  const canvas = $("shards");
  const paint = canvas.getContext("2d");
  let shards = [], drawing = false;
  function fitCanvas() {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = $("stage").clientWidth * ratio;
    canvas.height = $("stage").clientHeight * ratio;
    paint.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  function burst(x, y, count, power) {
    if (calm) return;
    const colors = ["#ffffff", "#c9d4de", "#9fb2c4"];
    for (let n = 0; n < count; n++) {
      const angle = -Math.PI / 2 + (Math.random() - .5) * 2.2;
      const speed = power * (.3 + Math.random());
      shards.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, w: 1 + Math.random() * 3, h: 1 + Math.random() * 2,
        turn: Math.random() * 6, spin: (Math.random() - .5) * .3, life: 1, fade: .016 + Math.random() * .02, color: colors[n % colors.length] });
    }
    if (!drawing) { drawing = true; requestAnimationFrame(drawShards); }
  }
  function drawShards() {
    paint.clearRect(0, 0, $("stage").clientWidth, $("stage").clientHeight);
    shards = shards.filter((s) => s.life > 0);
    for (const s of shards) {
      s.x += s.vx; s.y += s.vy; s.vy += .11; s.vx *= .985; s.turn += s.spin; s.life -= s.fade;
      paint.save();
      paint.globalAlpha = Math.max(s.life, 0);
      paint.translate(s.x, s.y);
      paint.rotate(s.turn);
      paint.fillStyle = s.color;
      paint.fillRect(-s.w / 2, -s.h / 2, s.w, s.h);
      paint.restore();
    }
    if (shards.length) requestAnimationFrame(drawShards);
    else { drawing = false; paint.clearRect(0, 0, $("stage").clientWidth, $("stage").clientHeight); }
  }

  /* La déchirure suit le doigt et ne se referme jamais : ce qui est déchiré reste déchiré. */
  const pack = $("pack");
  let opened = false, grip = null, justDragged = false, autoTear = false;
  pack.addEventListener("pointermove", (event) => {
    if (opened) return;
    const box = pack.getBoundingClientRect();
    const x = clamp((event.clientX - box.left) / box.width);
    const y = clamp((event.clientY - box.top) / box.height);
    if (!calm) scene.aim = [(.5 - y) * .32, (x - .5) * .5];
    if (event.pointerType === "mouse") scene.pointer = true;
    if (!grip) return;
    const moved = event.clientX - grip.x;
    if (!grip.dragged && Math.abs(moved) > 8) {
      grip.dragged = true;
      if (scene.goal === 0) scene.dir = moved > 0 ? 1 : -1;
      $("hint").hidden = true;
    }
    if (!grip.dragged) return;
    const along = (scene.dir > 0 ? moved : -moved) / (box.width * .86);
    scene.goal = Math.max(scene.goal, clamp(grip.start + along));
    if (scene.goal >= .98) finishTear();
  });
  pack.addEventListener("pointerdown", (event) => {
    if (opened) return;
    grip = { x: event.clientX, start: scene.goal, dragged: false };
    pack.setPointerCapture?.(event.pointerId);
  });
  function release() {
    if (!grip) return;
    justDragged = grip.dragged;
    grip = null;
  }
  pack.addEventListener("pointerup", release);
  pack.addEventListener("pointercancel", release);
  pack.addEventListener("pointerleave", () => {
    if (grip) return;
    scene.aim = [0, 0];
    scene.pointer = false;
  });
  pack.addEventListener("click", () => {
    if (justDragged) { justDragged = false; return; }
    if (!opened && !autoTear) tearByItself();
  });

  /* Sans le doigt, la déchirure avance par à-coups, comme une vraie main qui tire. */
  async function tearByItself() {
    autoTear = true;
    $("hint").hidden = true;
    if (calm || !gl) return finishTear();
    if (scene.goal === 0) scene.dir = 1;
    for (const step of [.14, .22, .4, .47, .68, .76, 1]) {
      if (opened) return;
      scene.goal = Math.max(scene.goal, step);
      buzz(5);
      await wait(95 + Math.random() * 55);
    }
    finishTear();
  }

  async function finishTear() {
    if (opened) return;
    opened = true;
    grip = null;
    buzz([10, 30, 30]);
    $("packLine").hidden = true;
    $("hint").hidden = true;
    scene.goal = 1.02;
    pack.style.pointerEvents = "none";
    if (calm || !gl) {
      stopScene();
      $("opening").hidden = true;
      dealCards();
      return;
    }
    await wait(160);
    dealCards();
    const flyStart = performance.now();
    const dropAt = 420;
    const animate = (now) => {
      const t = now - flyStart;
      scene.fly = clamp(t / 780);
      const part = clamp((t - dropAt) / 780);
      scene.drop = part * part * ($("stage").clientHeight + scene.size[1]);
      $("floor").style.opacity = 1 - part * 2.5;
      if (t < dropAt + 800 && scene.running) requestAnimationFrame(animate);
      else {
        stopScene();
        $("opening").hidden = true;
      }
    };
    requestAnimationFrame(animate);
  }

  /* Les cartes */
  const cardEls = [];
  let current = 0, busy = false;
  const safeText = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const tile = (label, value) => `<span class="tile"><i>${label}</i><b${value ? "" : ' class="none"'}>${value ? safeText(value) : "Non renseigné"}</b></span>`;
  function buildCards() {
    const deck = $("deck");
    deck.innerHTML = "";
    cardEls.length = 0;
    CARS.forEach((car, index) => {
      const finale = index === CARS.length - 1;
      const card = document.createElement("button");
      card.type = "button";
      card.className = `card${finale ? " finale" : ""}`;
      card.setAttribute("aria-label", "Retourner la carte");
      card.style.zIndex = CARS.length - index;
      card.innerHTML = `<span class="ground"></span><span class="tilt">
        ${finale ? '<span class="halo"></span>' : ""}
        <span class="turn">
          <span class="rim a"></span><span class="rim b"></span><span class="rim c"></span>
          <span class="face back"><span class="back-in"><span class="back-logo">${LOGO}</span><span class="back-mark"><b>Car</b>Pocket</span></span></span>
          <span class="face front">
            ${finale ? '<span class="holo edge"></span>' : ""}
            <span class="front-in">
              <span class="head"><span class="names"><span class="maker">${safeText(car.maker)}</span><span class="model">${safeText(car.model)}</span></span><span class="mini">${LOGO}</span></span>
              <span class="pic"><img src="${car.photo}" alt="${safeText(car.maker + " " + car.model)}" draggable="false"></span>
              <span class="tiles">${tile("Années", car.year)}${tile("Moteur", car.engine)}${tile("Puissance", car.power)}${tile("Poids", car.weight)}</span>
              <span class="credit">Photo : ${safeText(car.author)}, ${safeText(car.license)} (Wikimedia Commons)</span>
              ${finale ? '<span class="holo film"></span>' : ""}
            </span>
            <span class="glare"></span><span class="gloss"></span>
          </span>
        </span></span>`;
      card.addEventListener("click", () => touchCard(index));
      card.addEventListener("pointermove", (event) => {
        if (!card.classList.contains("flipped") || calm) return;
        const box = card.getBoundingClientRect();
        steer(card, clamp((event.clientX - box.left) / box.width), clamp((event.clientY - box.top) / box.height));
        card.touched = performance.now();
      });
      card.addEventListener("pointerleave", () => { card.touched = 0; });
      deck.append(card);
      cardEls.push(card);
    });
  }
  function steer(card, x, y) {
    card.style.setProperty("--ry", `${(x - .5) * 26}deg`);
    card.style.setProperty("--rx", `${(.5 - y) * 22}deg`);
    card.style.setProperty("--gx", `${x * 100}%`);
    card.style.setProperty("--gy", `${y * 100}%`);
  }
  /* Quand personne ne touche la carte, elle bouge seule pour que le reflet vive. */
  let swayOn = false;
  function sway(now) {
    if (!swayOn) return;
    const card = cardEls[current];
    if (card?.classList.contains("flipped") && !card.classList.contains("flipping") && !calm && (!card.touched || now - card.touched > 1200)) {
      const t = now / 1000;
      steer(card, .5 + Math.sin(t * .9) * .3, .45 + Math.cos(t * .7) * .24);
    }
    requestAnimationFrame(sway);
  }
  function arrange() {
    cardEls.forEach((card, index) => {
      card.classList.remove("below-1", "below-2");
      const depth = index - current;
      if (depth === 1) card.classList.add("below-1");
      if (depth === 2) card.classList.add("below-2");
      card.tabIndex = depth === 0 ? 0 : -1;
    });
    const isLast = current === CARS.length - 1;
    cardEls[current]?.classList.toggle("waiting-tap", isLast && !cardEls[current].classList.contains("flipped"));
    $("cardLine").innerHTML = isLast
      ? "<strong>Dernière carte</strong>Touche-la pour la révéler."
      : `<strong>Carte ${current + 1} sur ${CARS.length}</strong>Touche-la pour la retourner.`;
  }
  /* Les cartes sortent vraiment du sachet : elles montent de derrière le film, puis viennent vers toi. */
  function dealCards() {
    $("reveal").hidden = false;
    buildCards();
    current = 0;
    [...$("tray").children].forEach((slot) => { slot.className = ""; slot.style.backgroundImage = ""; });
    arrange();
    if (!swayOn) { swayOn = true; requestAnimationFrame(sway); }
    if (calm || !gl) return;
    const box = stageBox();
    const deck = $("deck").getBoundingClientRect();
    const scale = (scene.size[0] * .9) / deck.width;
    const packTop = box.height / 2 - scene.center[1] - scene.size[1] / 2;
    const deckCenter = deck.top - box.top + deck.height / 2;
    const shrunk = deck.height * scale;
    const inside = packTop + scene.size[1] * .135 + shrunk / 2 - deckCenter;
    const risen = packTop - shrunk * .28 + shrunk / 2 - deckCenter;
    scene.showInside = false;
    cardEls.forEach((card, index) => {
      const rest = index === 0 ? "none" : `translateY(${index * 9}px) scale(${1 - index * .03})`;
      card.animate([
        { transform: `translateY(${inside}px) scale(${scale})`, offset: 0, easing: "cubic-bezier(.3, .05, .3, 1)" },
        { transform: `translateY(${risen}px) scale(${scale})`, offset: .58, easing: "cubic-bezier(.25, .9, .3, 1)" },
        { transform: rest, offset: 1 },
      ], { duration: 1500 + index * 40 });
    });
  }
  async function touchCard(index) {
    if (index !== current || busy) return;
    const card = cardEls[index];
    const finale = index === CARS.length - 1;
    if (!card.classList.contains("flipped")) {
      busy = true;
      const box = card.getBoundingClientRect();
      const stage = stageBox();
      if (finale) {
        card.classList.remove("waiting-tap");
        card.classList.add("charging");
        $("cardLine").innerHTML = "";
        buzz([8, 40, 12, 40, 18]);
        await wait(550);
        card.classList.remove("charging");
        if (!calm) $("flash").animate([{ opacity: .55 }, { opacity: 0 }], { duration: 800, easing: "ease-out" });
        buzz(50);
      } else {
        buzz(12);
      }
      card.classList.add("flipping", "flipped");
      setTimeout(() => card.classList.remove("flipping"), 780);
      if (finale) setTimeout(() => burst(box.left + box.width / 2 - stage.left, box.top - stage.top + box.height * .3, 40, 6), 200);
      card.setAttribute("aria-label", finale ? "Voir mes découvertes" : "Carte suivante");
      const car = CARS[index];
      $("cardLine").innerHTML = finale
        ? "<strong>Quelle découverte</strong>Touche-la pour continuer."
        : `<strong>${safeText(car.maker)} ${safeText(car.model)}</strong>Touche-la pour continuer.`;
      await wait(finale ? 950 : 650);
      busy = false;
      return;
    }
    busy = true;
    const slot = $("tray").children[index];
    const from = card.getBoundingClientRect();
    const to = slot.getBoundingClientRect();
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
    card.style.pointerEvents = "none";
    card.style.transform = `translate(${to.left + to.width / 2 - from.left - from.width / 2}px, ${to.top + to.height / 2 - from.top - from.height / 2}px) scale(${to.width / from.width})`;
    card.style.opacity = 0;
    const finished = current;
    current = -1;
    await wait(380);
    slot.className = "filled";
    slot.style.backgroundImage = `url("${CARS[index].photo}")`;
    current = finished + 1;
    await wait(80);
    busy = false;
    if (current >= CARS.length) showSummary();
    else arrange();
  }

  /* Le bilan : rien n'est ajouté tant que la personne ne le demande pas. */
  const choices = {};
  function showSummary() {
    markOpened();
    swayOn = false;
    stopScene();
    $("opening").hidden = true;
    $("reveal").hidden = true;
    $("skip").hidden = true;
    $("summary").hidden = false;
    $("rows").innerHTML = CARS.map((car, index) => `<div class="row">
        <img src="${car.photo}" alt="" draggable="false">
        <div><div class="row-name">${safeText(car.maker)} ${safeText(car.model)}</div><div class="row-year">${safeText(car.year)}</div></div>
        <div class="choice">
          <button type="button" class="add" data-pick="${index}" data-value="add" aria-pressed="false">Ajouter à mon deck</button>
          <button type="button" data-pick="${index}" data-value="pass" aria-pressed="false">Passer</button>
        </div>
      </div>`).join("");
  }
  $("rows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-pick]");
    if (!button) return;
    const index = button.dataset.pick;
    choices[index] = choices[index] === button.dataset.value ? null : button.dataset.value;
    button.parentElement.querySelectorAll("button").forEach((other) => {
      const on = choices[index] === other.dataset.value;
      other.setAttribute("aria-pressed", String(on));
      other.textContent = other.dataset.value === "add" ? (on ? "Dans mon deck" : "Ajouter à mon deck") : (on ? "Passée" : "Passer");
    });
    if (choices[index] === "add") buzz(12);
    saveChoice(Number(index), choices[index] === "add", button.parentElement);
  });

  function resetPack() {
    opened = false;
    grip = null;
    autoTear = false;
    justDragged = false;
    Object.assign(scene, { front: 0, goal: 0, dir: 1, fly: 0, drop: 0, showInside: true, aim: [0, 0], pointer: false });
    Object.keys(choices).forEach((key) => delete choices[key]);
    pack.style.pointerEvents = "";
    $("hint").hidden = false;
    $("packLine").hidden = false;
    $("opening").hidden = false;
    $("reveal").hidden = true;
    $("summary").hidden = true;
    $("skip").hidden = false;
    glCanvas.hidden = false;
    $("floor").hidden = false;
    $("floor").style.opacity = 1;
    layoutPack();
    if (gl) startScene();
  }
  $("done").addEventListener("click", closeStage);
  $("skip").addEventListener("click", () => { opened = true; showSummary(); });
  $("laterBtn").addEventListener("click", closeStage);
  addEventListener("resize", () => { if (host.hidden) return; fitCanvas(); if (!opened) layoutPack(); });

  /* Le booster en cours. En attendant la réserve côté serveur, il est tiré dans le catalogue et gardé dans ce navigateur. */
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const storeKey = () => `booster.${state.user.id}`;
  const stored = () => load(storeKey(), null) || { titles: null, invited: false, openedAt: 0, everInvited: false };
  const store = (value) => save(storeKey(), value);

  const first = (value) => {
    if (!value) return null;
    const parts = String(value).split(" · ").map((part) => part.trim()).filter((part) => part && !part.endsWith(":"));
    return parts.length ? parts[0] + (parts.length > 1 ? " …" : "") : null;
  };
  /* Le même calcul que pour le lot test : rareté, carrosserie, âge. Rien n'est inventé. */
  function score(car) {
    const production = car.specs.production?.value || "";
    const built = production.match(/(\d[\d,. ]*)\s*(?:units?\s+)?(built|made|produced|manufactured|exemplaires|units|cars)\b/i);
    const count = built ? Number(built[1].replace(/\D/g, "")) : 0;
    const body = (car.specs.body?.value || "").split(" · ")[0];
    return (count && count < 5000 ? 2 : 0)
      + (/coup[eé]|cabriolet|convertible|roadster|spider|spyder|targa/i.test(body) && !/utility|pick-?up/i.test(body) ? 1 : 0)
      + (car.year && car.year < 1970 ? 1 : 0)
      + (car.specs.power ? 1 : 0);
  }
  function draw() {
    const own = new Set(state.items.map((item) => item.title));
    const pool = state.catalog.filter((car) => car.photos?.length && car.specs.production && (car.specs.power || car.specs.engine) && !own.has(titleOf(car)));
    if (pool.length < 3) return null;
    const mixed = [...pool].sort(() => Math.random() - .5).slice(0, 12);
    const best = [...mixed].sort((a, b) => score(b) - score(a))[0];
    return [...mixed.filter((car) => car !== best).slice(0, 2), best].map(titleOf);
  }
  function asCard(car) {
    const photo = car.photos[0];
    const name = car.name.toLowerCase().startsWith(car.brand.toLowerCase()) ? car.name.slice(car.brand.length).trim() : car.name;
    return { title: titleOf(car), slug: car.slug, maker: car.brand, model: name || car.name, year: first(car.specs.production?.value),
      engine: first(car.specs.engine?.value), power: first(car.specs.power?.value), weight: first(car.specs.weight?.value),
      photo: photo.file, author: photo.author, license: photo.license };
  }
  function currentBooster() {
    if (!state.user || state.viewing || isAdmin()) return null;
    const data = stored();
    if (data.openedAt && Date.now() - data.openedAt < WEEK_MS) return null;
    if (data.openedAt) { data.titles = null; data.openedAt = 0; data.invited = false; }
    if (!data.titles) {
      data.titles = draw();
      if (!data.titles) return null;
      store(data);
    }
    const byTitle = new Map(state.catalog.map((car) => [titleOf(car), car]));
    const cars = data.titles.map((title) => byTitle.get(title)).filter(Boolean);
    return cars.length === 3 ? cars : null;
  }
  function markOpened() {
    const data = stored();
    if (data.openedAt) return;
    data.openedAt = Date.now();
    store(data);
  }

  async function saveChoice(index, add, group) {
    const car = CARS[index];
    const wanted = choices[index];
    const inDeck = state.items.some((item) => item.title === car.title);
    if (add === inDeck) return;
    group.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    const result = add
      ? await db.from("deck_items").insert({ user_id: state.user.id, title: car.title }).select(ITEM_FIELDS).single()
      : await db.from("deck_items").delete().eq("user_id", state.user.id).eq("title", car.title);
    group.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    if (result.error) {
      choices[index] = add ? null : "add";
      group.querySelectorAll("button").forEach((button) => {
        const on = choices[index] === button.dataset.value;
        button.setAttribute("aria-pressed", String(on));
        button.textContent = button.dataset.value === "add" ? (on ? "Dans mon deck" : "Ajouter à mon deck") : (on ? "Passée" : "Passer");
      });
      showToast("Ce choix n'a pas pu être enregistré. Réessaie.");
      return;
    }
    state.items = add
      ? [result.data, ...state.items]
      : state.items.filter((item) => item.title !== car.title);
    if (!add) releaseSheet(car.title);
    void wanted;
  }

  let prepared = false, glReady = false, previousOverflow = "";
  async function prepare() {
    if (prepared) return;
    prepared = true;
    try { await Promise.all([document.fonts.load("700 112px Inter"), document.fonts.load("300 112px Inter")]); } catch (_) { /* police de secours */ }
    const art = drawArt();
    try { glReady = setupGL(art); } catch (error) { console.error(error); glReady = false; gl = null; }
    if (!glReady) {
      glCanvas.hidden = true;
      art.id = "fallback";
      pack.append(art);
    }
  }
  async function openStage() {
    const cars = currentBooster();
    if (!cars) return;
    CARS = cars.map(asCard);
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    host.hidden = false;
    fitCanvas();
    await prepare();
    resetPack();
    if (!glReady) { $("hint").hidden = true; scene.running = false; }
    else if (calm) { scene.running = false; drawGL(); }
    pack.focus({ preventScroll: true });
  }
  function closeStage() {
    swayOn = false;
    scene.running = false;
    host.hidden = true;
    document.documentElement.style.overflow = previousOverflow;
    $("reveal").hidden = true;
    renderAll();
  }

  /* La proposition à la connexion : une seule fois par booster, et jamais par-dessus une fiche ouverte. */
  const invite = $("invite");
  async function showInvite(data) {
    const firstTime = !data.everInvited;
    $("invite-title").textContent = firstTime ? "Ton premier booster est arrivé" : "Ton booster de la semaine est prêt";
    $("invite-text").textContent = firstTime
      ? "Chaque semaine, 3 voitures à découvrir. Tu choisis celles qui rejoignent ton deck, les autres restent de côté."
      : "3 nouvelles voitures à découvrir.";
    data.invited = true;
    data.everInvited = true;
    store(data);
    try { await document.fonts.load("700 112px Inter"); } catch (_) { /* police de secours */ }
    $("stage").hidden = true;
    host.hidden = false;
    invite.showModal();
    await prepare();
    if (!invite.open || !glReady) return;
    /* Le même canevas sert à la pop-up et à l'ouverture : le relief ne se recharge pas entre les deux. */
    const art = $("invite-art");
    const box = art.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 2);
    art.append(glCanvas);
    glCanvas.hidden = false;
    glCanvas.width = Math.round(box.width * ratio);
    glCanvas.height = Math.round(box.height * ratio);
    scene.view = [box.width, box.height];
    const width = Math.min(box.width * .86, box.height * .6);
    scene.size = [width, width * 1.52];
    scene.center = [0, 0];
    Object.assign(scene, { front: 0, goal: 0, fly: 0, drop: 0, showInside: true, aim: [0, 0], pointer: false });
    art.classList.add("live");
    if (calm) drawGL();
    else startScene();
  }
  function leaveInvite() {
    scene.running = false;
    $("invite-art").classList.remove("live");
    $("stage").insertBefore(glCanvas, $("opening"));
    $("stage").hidden = false;
  }
  function hideInvite() {
    if (invite.open) invite.close();
    leaveInvite();
    host.hidden = true;
  }
  $("invite-art").addEventListener("pointermove", (event) => {
    if (calm) return;
    const box = $("invite-art").getBoundingClientRect();
    scene.aim = [(.5 - clamp((event.clientY - box.top) / box.height)) * .32, (clamp((event.clientX - box.left) / box.width) - .5) * .5];
    scene.pointer = event.pointerType === "mouse";
  });
  $("invite-art").addEventListener("pointerleave", () => {
    scene.aim = [0, 0];
    scene.pointer = false;
  });
  $("invite-later").addEventListener("click", hideInvite);
  invite.addEventListener("cancel", () => {
    leaveInvite();
    host.hidden = true;
  });
  $("invite-open").addEventListener("click", () => {
    invite.close();
    leaveInvite();
    openStage();
  });

  let entered = false;
  function afterEnter() {
    renderTile();
    if (entered || !state.user || state.viewing) return;
    entered = true;
    if (location.hash || document.querySelector("dialog[open]")) return;
    const cars = currentBooster();
    const data = stored();
    if (cars && !data.invited) showInvite(data);
  }

  /* S'il n'est pas ouvert, le booster attend dans le deck, sans limite de temps. */
  function renderTile() {
    const slot = document.getElementById("booster-slot");
    if (!slot) return;
    const waiting = canEdit() && !state.folder && currentBooster();
    slot.hidden = !waiting;
    slot.innerHTML = waiting ? `<button type="button" class="booster-tile" id="booster-tile">
        <img class="booster-tile-pack" src="booster-pack.webp?v=${VERSION}" alt="" width="360" height="520">
        <span class="booster-tile-text"><strong>Un booster t'attend</strong><small>3 voitures à découvrir. Il reste ici, sans limite de temps.</small></span>
        <span class="booster-tile-open">Ouvrir</span>
      </button>` : "";
    if (waiting) document.getElementById("booster-tile").addEventListener("click", openStage);
  }

  window.CarPocketBooster = {
    afterEnter,
    renderTile,
    reset() {
      if (!state.user) return;
      save(storeKey(), null);
      entered = false;
      afterEnter();
    },
  };
  if (state.user) afterEnter();
})();
