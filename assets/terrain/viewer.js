// 3D view of the paper's terrain figure (Fig. 3): heightmap, reference path, LEAP rollouts, spawn and goal.
// Data: window.LEAP_TERRAINS from terrains.js (export_terrains_web.py). Needs THREE + THREE.OrbitControls.
(function () {
  var root = document.getElementById('terrain3d');
  if (!root) return;
  var fallback = document.getElementById('terrain-fallback');
  if (!window.THREE || !THREE.OrbitControls || !window.LEAP_TERRAINS || !webglOK()) {
    root.style.display = 'none';
    if (fallback) fallback.style.display = 'block';
    return;
  }

  var HUES = { islands: '#2a78d6', crests: '#6C3483', pillars: '#1baf7a', bridges: '#c97b12', decoys: '#c0392b' };
  var PIT = new THREE.Color(0.21, 0.21, 0.22).convertSRGBToLinear();
  var tiles = window.LEAP_TERRAINS;

  var canvasWrap = root.querySelector('.t3d-canvas');
  var tabs = root.querySelector('.t3d-tabs');
  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  canvasWrap.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 200);
  var controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 4;
  controls.maxDistance = 45;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 0.55));
  var sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(-8, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  var sc = sun.shadow.camera; sc.left = -11; sc.right = 11; sc.top = 11; sc.bottom = -11; sc.near = 1; sc.far = 50;
  sun.shadow.bias = -0.0008;
  scene.add(sun);

  var current = null, cache = {};

  function webglOK() {
    try { var c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); }
    catch (e) { return false; }
  }

  function mix(a, b, w) { return a.clone().lerp(b, w); }

  // the paper figure's fall marker (matplotlib "X", red with a white edge), same path as the page's .xm icon
  var fallMat = null;
  function fallMaterial() {
    if (fallMat) return fallMat;
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var ctx = c.getContext('2d');
    ctx.translate(64, 64); ctx.scale(10, 10);
    var v = [-4.6, -2.6, -2.6, -4.6, 0, -2, 2.6, -4.6, 4.6, -2.6, 2, 0, 4.6, 2.6, 2.6, 4.6, 0, 2, -2.6, 4.6, -4.6, 2.6, -2, 0];
    ctx.beginPath(); ctx.moveTo(v[0], v[1]);
    for (var k = 2; k < v.length; k += 2) ctx.lineTo(v[k], v[k + 1]);
    ctx.closePath();
    ctx.lineJoin = 'miter'; ctx.lineWidth = 1.2; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#e34948'; ctx.fill();
    var tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    fallMat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    return fallMat;
  }

  function decode(t) {
    var bin = atob(t.h), n = bin.length / 2, q = new Uint16Array(n), out = new Float32Array(n);
    for (var k = 0; k < n; k++) q[k] = bin.charCodeAt(2 * k) | (bin.charCodeAt(2 * k + 1) << 8);
    for (k = 0; k < n; k++) out[k] = t.hmin + q[k] / 65535 * (t.hmax - t.hmin);
    return out;
  }

  // tile coords: x along the tile's long axis, y across, z up; the group turns z-up into three's y-up
  function build(t) {
    var g = new THREE.Group();
    var h = decode(t), nx = t.nx, ny = t.ny, res = t.res;
    var pos = new Float32Array(nx * ny * 3), col = new Float32Array(nx * ny * 3);
    var hue = new THREE.Color(HUES[t.name]), white = new THREE.Color(1, 1, 1), black = new THREE.Color(0, 0, 0);
    // ramp mixed in sRGB like the paper figure, then linearised for the sRGB output
    var lo = mix(hue, white, 0.45).convertSRGBToLinear(), mid = mix(hue, white, 0.22).convertSRGBToLinear(),
        hi = mix(hue, black, 0.35).convertSRGBToLinear();
    var span = Math.max(t.walk_max - t.walk_min, 0.5);
    for (var i = 0; i < nx; i++) for (var j = 0; j < ny; j++) {
      var k = i * ny + j, z = h[k], c;
      pos[3 * k] = i * res; pos[3 * k + 1] = j * res; pos[3 * k + 2] = z;
      if (z < t.walk_min - 0.3) c = PIT;
      else {
        var u = Math.min(Math.max((z - t.walk_min) / span, 0), 1);
        c = u < 0.5 ? mix(lo, mid, u * 2) : mix(mid, hi, (u - 0.5) * 2);
      }
      col[3 * k] = c.r; col[3 * k + 1] = c.g; col[3 * k + 2] = c.b;
    }
    var idx = new Uint32Array((nx - 1) * (ny - 1) * 6), m = 0;
    for (i = 0; i < nx - 1; i++) for (j = 0; j < ny - 1; j++) {
      var a = i * ny + j, b = a + 1, d = a + ny, e = d + 1;
      idx[m++] = a; idx[m++] = d; idx[m++] = b; idx[m++] = b; idx[m++] = d; idx[m++] = e;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    var mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);

    function tube(pts, radius, color, lift) {
      var v = pts.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2] + lift); });
      var curve = new THREE.CatmullRomCurve3(v, false, 'centripetal');
      var tg = new THREE.TubeGeometry(curve, Math.min(v.length * 3, 600), radius, 6, false);
      var tm = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: color, roughness: 0.6 }));
      tm.castShadow = true;
      return tm;
    }
    t.traces.forEach(function (tr) {
      g.add(tube(tr.p, 0.035, 0xffffff, 0.08));
      if (tr.outcome === 'fell') {
        var p = tr.p[tr.p.length - 1], x = new THREE.Sprite(fallMaterial());
        x.position.set(p[0], p[1], p[2] + 0.35); x.scale.set(0.7, 0.7, 1); g.add(x);
      }
    });
    g.add(tube(t.ref, 0.06, 0xf5b301, 0.1));

    var s = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), new THREE.MeshStandardMaterial({ color: 0x22d3ee }));
    s.position.set(t.spawn[0], t.spawn[1], t.spawn[2] + 0.22); s.castShadow = true; g.add(s);
    var goal = new THREE.Mesh(new THREE.SphereGeometry(0.25, 32, 20),
      new THREE.MeshStandardMaterial({ color: 0x2ecc40, emissive: 0x1a7f25, emissiveIntensity: 0.4 }));
    goal.position.set(t.goal[0], t.goal[1], t.goal[2]); goal.castShadow = true; g.add(goal);

    var holder = new THREE.Group();
    g.rotation.x = -Math.PI / 2;
    g.position.set(-nx * res / 2, 0, ny * res / 2);
    holder.add(g);
    // the long axis runs away from the default camera, like the paper's portrait panels
    holder.rotation.y = Math.PI / 2;
    return holder;
  }

  function resetView() {
    camera.position.set(0, 14.5, 18);
    controls.target.set(0, 0, 0.8);
    controls.update();
  }

  function show(i) {
    if (current) scene.remove(current);
    current = cache[i] || (cache[i] = build(tiles[i]));
    scene.add(current);
    Array.prototype.forEach.call(tabs.children, function (b, k) { b.classList.toggle('on', k === i); });
    resetView();
  }

  tiles.forEach(function (t, i) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = t.name;
    b.addEventListener('click', function () { show(i); });
    tabs.appendChild(b);
  });
  var reset = root.querySelector('.t3d-reset');
  if (reset) reset.addEventListener('click', resetView);
  // straight down, long axis vertical: the paper figure's framing
  var top = root.querySelector('.t3d-top');
  if (top) top.addEventListener('click', function () {
    camera.position.set(0, 30, 0.01);
    controls.target.set(0, 0, 0);
    controls.update();
  });

  function resize() {
    var w = canvasWrap.clientWidth, hgt = Math.round(w * 9 / 16);
    renderer.setSize(w, hgt, false);
    renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = hgt + 'px';
    camera.aspect = w / hgt; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  var visible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }).observe(root);
  }
  (function loop() {
    requestAnimationFrame(loop);
    if (!visible) return;
    controls.update();
    renderer.render(scene, camera);
  })();

  resize();
  show(0);
})();
