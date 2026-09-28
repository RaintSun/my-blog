/*!
 * particle-title.js — 发光粒子标题
 * ---------------------------------------------------------------------------
 * 把首页横幅（Butterfly 的 #page-header > #site-info > #site-title）渲染成
 * 数千个发光粒子：
 *   · 鼠标滑过把粒子推开，移开后缓慢回位（弹簧阻尼）
 *   · 每次刷新都会随机换一种「流动重组」方式，粒子与字模的对应关系也重新洗牌
 *   · 5 套配色可切换，选择会被记住
 *   · 「炸开」按钮把粒子轰散，再让它们慢慢聚拢回来
 *
 * 纯 Canvas 2D 实现，无任何第三方依赖；只在首页生效，其它页面自动跳过。
 * 对外接口：window.__particleTitle.{ setPalette, explode, reform, destroy }
 */
(function () {
  'use strict';

  /* ======================================================== 可调参数 / 常量 */

  var CFG = window.__PARTICLE_TITLE__ || {};
  var TITLE_FALLBACK = '谭云阳的学习笔记';

  var FONT_STACK =
    '"Noto Sans SC","Source Han Sans SC","PingFang SC","Hiragino Sans GB",' +
    '"Microsoft YaHei",system-ui,-apple-system,"Segoe UI",sans-serif';
  var FONT_WEIGHT = 700;

  /* 配色方案：每套 3 个渐变停靠色，横向铺满标题 */
  var PALETTES = [
    { name: '极光', colors: ['#2BE7FF', '#4CFFB0', '#8A6BFF'] },
    { name: '霓虹', colors: ['#FF2E88', '#C04BFF', '#28D7FF'] },
    { name: '熔金', colors: ['#FFE066', '#FF9838', '#FF4D4D'] },
    { name: '翡翠', colors: ['#2FF3B2', '#C6F7DC', '#FFD98A'] },
    { name: '冰川', colors: ['#FFFFFF', '#C9EBFF', '#7FB2FF'] }
  ];
  var DEFAULT_PALETTE = typeof CFG.palette === 'number' ? CFG.palette : 0;

  var BUCKETS = 14;               /* 渐变色分桶数（同时是光晕贴图数量） */
  var SPRITE_CSS = 7;             /* 单个粒子光晕的 CSS 直径：必须小于笔画缝隙，字才认得出来 */
  var QUALITY_SCALE = [0.6, 0.78, 1];  /* 卡顿时逐级缩小光晕，降低填充率 */

  var SPRING = 0.0062;            /* 回位弹簧劲度：越小回位越慢 */
  var DAMP = 0.944;               /* 每帧阻尼：越大回位越慢、越飘 */
  var MOUSE_R = 122;              /* 鼠标推开半径 */
  var MOUSE_FORCE = 7.6;          /* 鼠标推开力度 */
  var STEP_MAX = 3;               /* 单帧 dt 上限（防止切回标签页时炸开） */
  var LS_KEY = 'pt-palette';

  var SPAWN_MODES = ['noise', 'rain', 'ring', 'sides', 'burst'];

  var REDUCED = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* 正弦查表：省掉每帧上万次 Math.sin */
  var SIN_N = 1024;
  var SIN = new Float32Array(SIN_N);
  for (var si = 0; si < SIN_N; si++) SIN[si] = Math.sin(si / SIN_N * Math.PI * 2);

  /* ================================================================ 小工具 */

  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mixRgb(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function rgba(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* 在多停靠色渐变上取色，t ∈ [0,1] */
  function gradientAt(stops, t) {
    var n = stops.length;
    if (n === 1) return stops[0].slice();
    var p = clamp(t, 0, 1) * (n - 1);
    var i = Math.floor(p);
    if (i >= n - 1) return stops[n - 1].slice();
    return mixRgb(stops[i], stops[i + 1], p - i);
  }

  /* 预渲染一张「热核 + 彩色光晕」的粒子贴图（加色混合下会自然发光） */
  function makeSprite(rgb, box) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = box;
    var g = cv.getContext('2d');
    var r = box / 2;
    var hot = mixRgb(rgb, [255, 255, 255], 0.5);
    var grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0.00, rgba(hot, 0.95));     /* 热核 */
    grd.addColorStop(0.35, rgba(rgb, 0.75));     /* 亮芯：让笔画内部连成实心 */
    grd.addColorStop(0.62, rgba(rgb, 0.22));
    grd.addColorStop(0.85, rgba(rgb, 0.04));     /* 光晕够不到笔画缝隙，字才立得住 */
    grd.addColorStop(1.00, rgba(rgb, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, box, box);
    return cv;
  }

  /* ============================================================ 应用实例 */

  var current = null;

  function boot() {
    var titleEl = document.querySelector('#site-info #site-title');
    if (!titleEl) { teardown(); return; }          /* 非首页：什么都不做 */
    if (current && current.titleEl === titleEl) return;
    teardown();
    current = createApp(titleEl);
    current.init();
  }

  function teardown() {
    if (current) { current.destroy(); current = null; }
  }

  function createApp(titleEl) {
    var host = titleEl.closest('#page-header') || titleEl.parentNode;
    var subtitleEl = host.querySelector('#site-subtitle');
    var text = String(CFG.title || titleEl.textContent || TITLE_FALLBACK)
      .replace(/\s+/g, ' ').trim() || TITLE_FALLBACK;

    /* ---------------------------------------------------------- 运行状态 */
    var canvas = null, ctx = null, scrimEl = null, ui = null, backdrop = null;
    var dpr = 1, W = 0, H = 0;
    var band = { left: 0, top: 0, width: 0, height: 0, centerY: 0, textLeft: 0, textWidth: 1 };
    var pts = [];                 /* 扁平数组 [x0,y0,x1,y1,...]，画布 CSS 坐标 */
    var particles = [];
    var sprites = [];
    var spriteDpr = 0;            /* 当前贴图是按哪个 dpr 渲染的 */
    var stops = [];
    var paletteIndex = DEFAULT_PALETTE;
    var mouse = { x: -1e5, y: -1e5, active: false };
    var hostRect = { left: 0, top: 0, width: 0, height: 0 };
    var raf = 0, lastT = 0, running = false;
    var chaos = 0, flash = 0, fadeIn = 0, waves = [];
    var quality = 2, frameAcc = 0, frameN = 0, calmStreak = 0;
    var resizeTimer = 0;
    var disposed = false;
    var forcedPosition = false;

    var probe = document.createElement('canvas');
    var probeCtx = probe.getContext('2d');

    /* ---------------------------------------------------------- 画质档位 */

    /* 粒子数量按「字模面积」推算，保证不同字号 / 屏幕下疏密一致：
       太稀笔画会断成小点，太密又会把笔画之间的空隙糊住 */
    function targetCount(inkCss) {
      var cores = navigator.hardwareConcurrency || 4;
      var per = cores <= 4 ? 6 : 4.2;     /* 每个粒子负责的字模面积（CSS px²） */
      if (REDUCED) per *= 2;
      return clamp(Math.round(inkCss / per), 1400, 9000);
    }

    /* ------------------------------------------------------------ 贴图集 */

    function buildSprites() {
      var box = Math.max(8, Math.round(SPRITE_CSS * dpr));
      spriteDpr = dpr;
      var out = [];
      for (var i = 0; i < BUCKETS; i++) {
        var t = BUCKETS === 1 ? 0 : i / (BUCKETS - 1);
        out.push(makeSprite(gradientAt(stops, t), box));
      }
      return out;
    }

    /* ---------------------------------------------------------- 尺寸测量 */

    function measureHost() {
      var r = host.getBoundingClientRect();
      hostRect.left = r.left;
      hostRect.top = r.top;
      hostRect.width = r.width;
      hostRect.height = r.height;
    }

    /* 让字号同时塞进「宽度」和「可用高度」 */
    function fitFontSize(txt, maxW, maxH) {
      var REF = 100;
      probeCtx.font = FONT_WEIGHT + ' ' + REF + 'px ' + FONT_STACK;
      var m = probeCtx.measureText(txt);
      var w = m.width || txt.length * REF;
      var asc = m.actualBoundingBoxAscent || REF * 0.86;
      var desc = m.actualBoundingBoxDescent || REF * 0.14;
      var glyphH = asc + desc || REF;
      /* 宽度留 2% 余量，避免栅格化时把左右边缘裁掉 */
      return Math.max(16, Math.min(REF * maxW * 0.98 / w, REF * maxH / glyphH));
    }

    /* 预渲染一层「字形深色底」：背景图细节多，需要这层暗底把字托出来 */
    function buildBackdrop(fontSize) {
      if (CFG.backdrop === false) { backdrop = null; return; }
      backdrop = document.createElement('canvas');
      backdrop.width = Math.max(1, Math.round(W * dpr));
      backdrop.height = Math.max(1, Math.round(H * dpr));
      var g = backdrop.getContext('2d');
      g.font = FONT_WEIGHT + ' ' + (fontSize * dpr) + 'px ' + FONT_STACK;
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      var m = g.measureText(text);
      var asc = m.actualBoundingBoxAscent || fontSize * dpr * 0.86;
      var desc = m.actualBoundingBoxDescent || fontSize * dpr * 0.14;
      var baseline = band.centerY * dpr + (asc - desc) / 2;
      var cx = (band.textLeft + band.textWidth / 2) * dpr;
      /* 做得柔和一点：粒子炸开时它只会变成一团淡淡的暗影，而不是清晰的「幽灵字」 */
      g.fillStyle = 'rgba(3,8,20,0.42)';
      g.shadowColor = 'rgba(3,8,20,0.6)';
      g.shadowBlur = fontSize * dpr * 0.18;
      g.fillText(text, cx, baseline);
    }

    /* 把文字栅格化后采样成粒子目标点 */
    function samplePoints(fontSize) {
      var ss = clamp(dpr, 1, 2);
      var w = Math.max(1, Math.round(band.width * ss));
      var h = Math.max(1, Math.round(band.height * ss));
      var off = document.createElement('canvas');
      off.width = w; off.height = h;
      var g = off.getContext('2d', { willReadFrequently: true });
      g.font = FONT_WEIGHT + ' ' + (fontSize * ss) + 'px ' + FONT_STACK;
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      g.fillStyle = '#fff';
      var m = g.measureText(text);
      var asc = m.actualBoundingBoxAscent || fontSize * ss * 0.86;
      var desc = m.actualBoundingBoxDescent || fontSize * ss * 0.14;
      g.fillText(text, w / 2, h / 2 + (asc - desc) / 2);   /* 视觉竖直居中 */

      var data = g.getImageData(0, 0, w, h).data;

      /* 第一遍：粗采样估算字模覆盖面积（换算回 CSS px²），
         据此同时决定粒子数量与正式采样的步长 */
      var hits = 0, S0 = 6, x, y;
      for (y = 0; y < h; y += S0) {
        for (x = 0; x < w; x += S0) {
          if (data[(y * w + x) * 4 + 3] > 128) hits++;
        }
      }
      var estDev = hits * S0 * S0 + 1;                 /* device px² */
      var desired = targetCount(estDev / (ss * ss));   /* CSS px² */
      var stride = clamp(Math.round(Math.sqrt(estDev / desired)), 1, 10);

      var arr = [];
      for (var attempt = 0; attempt < 2; attempt++) {
        arr.length = 0;
        for (y = 0; y < h; y += stride) {
          for (x = 0; x < w; x += stride) {
            if (data[(y * w + x) * 4 + 3] > 128) {
              arr.push(band.left + (x + 0.5) / ss, band.top + (y + 0.5) / ss);
            }
          }
        }
        /* 点太少就加密一档再采一次 */
        if (arr.length / 2 >= desired * 0.55 || stride <= 1) break;
        stride -= 1;
      }
      /* 太多则随机抽稀；顺带把顺序打乱 → 粒子与字模的对应关系每次刷新都不同 */
      var total = arr.length / 2;
      if (total > desired) {
        for (var i = total - 1; i > 0; i--) {
          var j = (Math.random() * (i + 1)) | 0;
          if (j === i) continue;
          var a = i * 2, b = j * 2, t0 = arr[a], t1 = arr[a + 1];
          arr[a] = arr[b]; arr[a + 1] = arr[b + 1];
          arr[b] = t0; arr[b + 1] = t1;
        }
        arr.length = desired * 2;
      }
      return arr;
    }

    /* ------------------------------------------------------- 开机散点方式 */

    function pickSpawnMode() {
      return SPAWN_MODES[(Math.random() * SPAWN_MODES.length) | 0];
    }

    function spawn(mode, tx, ty) {
      var a, r, left;
      switch (mode) {
        case 'rain':
          return { x: Math.random() * W, y: -20 - Math.random() * H * 0.7,
                   vx: (Math.random() - 0.5) * 2, vy: 3 + Math.random() * 6 };
        case 'ring':
          a = Math.random() * Math.PI * 2;
          r = Math.max(W, H) * (0.5 + Math.random() * 0.55);
          return { x: W / 2 + Math.cos(a) * r, y: H * 0.45 + Math.sin(a) * r * 0.7,
                   vx: -Math.cos(a) * 2.6, vy: -Math.sin(a) * 2.2 };
        case 'sides':
          left = Math.random() < 0.5;
          return { x: left ? -30 - Math.random() * 260 : W + 30 + Math.random() * 260,
                   y: ty + (Math.random() - 0.5) * H * 0.8,
                   vx: left ? 3 + Math.random() * 5 : -(3 + Math.random() * 5),
                   vy: (Math.random() - 0.5) * 1.5 };
        case 'burst':
          a = Math.random() * Math.PI * 2;
          r = Math.random() * Math.min(W, H) * 0.45;
          return { x: W / 2 + Math.cos(a) * r, y: band.centerY + Math.sin(a) * r * 0.5,
                   vx: Math.cos(a) * 5, vy: Math.sin(a) * 4 };
        default: /* noise */
          return { x: Math.random() * W, y: Math.random() * H,
                   vx: (Math.random() - 0.5) * 7, vy: (Math.random() - 0.5) * 7 };
      }
    }

    function byBucket(a, b) { return a.bucket - b.bucket; }

    /* 依据采样点重建粒子群 */
    function buildParticles(mode) {
      var n = pts.length / 2;
      if (!n) { particles = []; return; }
      var span = Math.max(1, band.textWidth);
      var ps = new Array(n);
      for (var i = 0; i < n; i++) {
        var tx = pts[i * 2], ty = pts[i * 2 + 1];
        var s = spawn(mode, tx, ty);
        var t = (tx - band.textLeft) / span;
        var bucket = clamp(Math.round(t * (BUCKETS - 1) + (Math.random() * 2 - 1) * 1.2),
          0, BUCKETS - 1);
        ps[i] = {
          tx: tx, ty: ty, x: s.x, y: s.y, vx: s.vx, vy: s.vy,
          w1: 0.0016 + Math.random() * 0.0042,
          w2: 0.0013 + Math.random() * 0.0036,
          ph1: Math.random(), ph2: Math.random(),
          amp: REDUCED ? 0 : 0.3 + Math.random() * 1.5,
          size: 0.72 + Math.random() * 0.46,
          k: 0.65 + Math.random() * 0.75,
          delay: REDUCED ? 0 : Math.random() * 34,
          bucket: bucket,
          sp: sprites[bucket]
        };
      }
      ps.sort(byBucket);          /* 按贴图分组，减少绘制时的纹理切换 */
      particles = ps;
    }

    /* ------------------------------------------------------------ 布局 */

    function layout() {
      /* 先把副标题位移清零，量到的才是主题的原始排版位置（否则多次 layout 会漂移） */
      host.style.setProperty('--pt-sub-shift', '0px');
      measureHost();
      W = Math.max(1, Math.round(hostRect.width));
      H = Math.max(1, Math.round(hostRect.height));
      dpr = clamp(window.devicePixelRatio || 1, 1, 2);

      /* 贴图在 layout() 之前就先建好了，那时还不知道真实 dpr；
         高分屏上发现不一致就按新 dpr 重做一遍，否则光晕会被放大糊掉 */
      if (spriteDpr !== dpr) sprites = buildSprites();

      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';

      var tRect = titleEl.getBoundingClientRect();
      var localTop = tRect.top - hostRect.top;
      var localLeft = tRect.left - hostRect.left;
      var localH = tRect.height || 48;

      var subTop = null, subH = 0;
      if (subtitleEl) {
        var sRect = subtitleEl.getBoundingClientRect();
        if (sRect.height > 0) { subTop = sRect.top - hostRect.top; subH = sRect.height; }
      }

      /* 字号：占满可用宽度，但不越过导航、也不至于把整屏吃掉 */
      var navClear = 74;
      var maxW = Math.min(W * 0.9, 1280);
      var heightBudget = Math.max(48, Math.min(H - navClear - 110, H * 0.38));
      var fontSize = fitFontSize(text, maxW, heightBudget);

      /* 该字号下真实的字身高度 */
      probeCtx.font = FONT_WEIGHT + ' ' + fontSize + 'px ' + FONT_STACK;
      var m = probeCtx.measureText(text);
      var glyphH = (m.actualBoundingBoxAscent || fontSize * 0.86) +
        (m.actualBoundingBoxDescent || fontSize * 0.14);

      /* 把「粒子标题 + 间距 + 副标题」当成一整块，仍然居中在主题原本的位置，
         这样换成粒子效果后整体构图不会跑偏 */
      var blockCenter = subTop !== null
        ? (localTop + subTop + subH) / 2
        : localTop + localH / 2;
      var gap = Math.max(16, fontSize * 0.26);
      var blockH = glyphH + (subTop !== null ? gap + subH : 0);
      var blockTop = clamp(blockCenter - blockH / 2, navClear,
        Math.max(navClear, H - 110 - blockH));
      var textCenterY = blockTop + glyphH / 2;

      /* 副标题挪到粒子标题正下方（可为负 = 上移） */
      if (subTop !== null) {
        host.style.setProperty('--pt-sub-shift',
          (blockTop + glyphH + gap - subTop).toFixed(1) + 'px');
      }

      /* 采样盒：字身外留一点余量给抗锯齿边缘 */
      var bandH = glyphH * 1.12;

      /* 实际文字宽度（用于铺满渐变 + 居中） */
      probeCtx.font = FONT_WEIGHT + ' 100px ' + FONT_STACK;
      var refW = probeCtx.measureText(text).width || text.length * 100;
      var textWidth = refW * fontSize / 100;

      var centerX = localLeft + tRect.width / 2;
      if (!isFinite(centerX) || centerX <= 1) centerX = W / 2;
      centerX = clamp(centerX, 40, Math.max(40, W - 40));

      band.left = clamp(centerX - maxW / 2, 4, Math.max(4, W - maxW - 4));
      band.top = textCenterY - bandH / 2;
      band.width = maxW;
      band.height = bandH;
      band.centerY = textCenterY;
      band.textWidth = textWidth;
      band.textLeft = centerX - textWidth / 2;

      /* 让遮罩暗区对准标题 */
      host.style.setProperty('--pt-title-y', (textCenterY / H * 100).toFixed(2) + '%');

      buildBackdrop(fontSize);
      pts = samplePoints(fontSize);
      buildParticles(pickSpawnMode());
      fadeIn = REDUCED ? 1 : 0;
    }

    /* ------------------------------------------------------------ 交互 */

    function explode(power) {
      if (!particles.length) return;
      var n = particles.length;
      var pw = power || 1;
      for (var i = 0; i < n; i++) {
        var p = particles[i];
        var dx = p.x - W / 2;
        var dy = p.y - band.centerY;
        var d = Math.sqrt(dx * dx + dy * dy);
        var f;
        if (d < 4) {                              /* 正中心的粒子给个随机方向 */
          var a = Math.random() * Math.PI * 2;
          dx = Math.cos(a); dy = Math.sin(a); d = 1;
        }
        f = (17 + Math.random() * 17) * pw;
        p.vx += dx / d * f;
        p.vy += dy / d * f * 0.85;
        p.delay = 0;
      }
      chaos = 1;
      flash = 1;
      waves.push({ x: W / 2, y: band.centerY, r: 10, a: 0.85,
                   color: rgba(gradientAt(stops, 0.5), 0.9) });
    }

    /* 在某个点制造一次冲击（点击横幅时用） */
    function pushAt(x, y, power) {
      var R = 210, R2 = R * R, pw = power || 1;
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        var dx = p.x - x, dy = p.y - y, d2 = dx * dx + dy * dy;
        if (d2 > R2) continue;
        var d = Math.sqrt(d2) || 1;
        var f = (1 - d / R);
        f = f * f * 15 * pw;
        p.vx += dx / d * f;
        p.vy += dy / d * f;
        p.delay = 0;
      }
      waves.push({ x: x, y: y, r: 6, a: 0.7,
                   color: rgba(gradientAt(stops, 0.5), 0.8) });
    }

    /* 重新散开再聚拢（「重组」按钮） */
    function reform() {
      if (!particles.length) return;
      var mode = pickSpawnMode();
      var i, p, s;
      /* 打乱粒子顺序 = 打乱「哪个粒子去哪个字模点」 */
      for (i = particles.length - 1; i > 0; i--) {
        var j = (Math.random() * (i + 1)) | 0;
        if (j === i) continue;
        var t = particles[i]; particles[i] = particles[j]; particles[j] = t;
      }
      for (i = 0; i < particles.length; i++) {
        p = particles[i];
        s = spawn(mode, p.tx, p.ty);
        p.x = s.x; p.y = s.y; p.vx = s.vx; p.vy = s.vy;
        p.delay = REDUCED ? 0 : Math.random() * 26;
      }
      particles.sort(byBucket);
      fadeIn = REDUCED ? 1 : 0.25;
      chaos = 0.35;
    }

    function setPalette(index, silent) {
      var n = PALETTES.length;
      paletteIndex = ((index % n) + n) % n;
      stops = PALETTES[paletteIndex].colors.map(hexToRgb);
      sprites = buildSprites();
      for (var i = 0; i < particles.length; i++) {
        particles[i].sp = sprites[particles[i].bucket];
      }
      if (ui) ui.sync();
      if (!silent) {
        try { window.localStorage.setItem(LS_KEY, String(paletteIndex)); } catch (e) { /* 忽略 */ }
      }
    }

    /* ------------------------------------------------------------ 每帧 */

    function update(dt) {
      var spring = SPRING * (1 - 0.86 * chaos);
      var damp = Math.pow(DAMP, dt);
      var mx = mouse.x, my = mouse.y, mact = mouse.active;
      var mr2 = MOUSE_R * MOUSE_R;
      var n = particles.length;
      for (var i = 0; i < n; i++) {
        var p = particles[i];

        if (p.delay > 0) {
          p.delay -= dt;
        } else {
          p.ph1 += p.w1 * dt; if (p.ph1 >= 1) p.ph1 -= 1;
          p.ph2 += p.w2 * dt; if (p.ph2 >= 1) p.ph2 -= 1;
          var tx = p.tx + SIN[(p.ph1 * SIN_N) | 0] * p.amp;
          var ty = p.ty + SIN[(p.ph2 * SIN_N) | 0] * p.amp * 0.8;
          p.vx += (tx - p.x) * spring * p.k * dt;
          p.vy += (ty - p.y) * spring * p.k * dt;
        }

        if (mact) {
          var dx = p.x - mx, dy = p.y - my;
          var d2 = dx * dx + dy * dy;
          if (d2 < mr2) {
            var d = Math.sqrt(d2) || 1;
            var f = 1 - d / MOUSE_R;
            f = f * f * MOUSE_FORCE * dt;
            p.vx += dx / d * f;
            p.vy += dy / d * f;
          }
        }

        p.vx *= damp;
        p.vy *= damp;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }

    function render() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      /* 先铺一层字形深色底，粒子再叠上去发光 */
      if (backdrop) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = clamp(fadeIn, 0, 1);
        ctx.drawImage(backdrop, 0, 0, W, H);
      }

      ctx.globalCompositeOperation = 'lighter';

      var scale = QUALITY_SCALE[quality] * (1 + 0.3 * flash);
      var box = SPRITE_CSS * scale;
      var half = box / 2;
      var n = particles.length;

      ctx.globalAlpha = clamp(fadeIn, 0, 1);
      for (var i = 0; i < n; i++) {
        var p = particles[i];
        var s = box * p.size;
        ctx.drawImage(p.sp, p.x - s * 0.5, p.y - s * 0.5, s, s);
      }

      /* 冲击波 */
      for (var k = waves.length - 1; k >= 0; k--) {
        var w = waves[k];
        ctx.globalAlpha = clamp(w.a, 0, 1) * clamp(fadeIn, 0, 1);
        ctx.strokeStyle = w.color;
        ctx.lineWidth = 1 + 3 * w.a;
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
        ctx.stroke();
        if (w.a <= 0) waves.splice(k, 1);
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    function tick(now) {
      raf = window.requestAnimationFrame(tick);
      if (!lastT) lastT = now;
      var dt = Math.min((now - lastT) / 16.667, STEP_MAX);
      lastT = now;
      if (dt <= 0) return;

      /* 画质自适应：连续卡顿就缩小光晕，持续流畅再升回来 */
      frameAcc += dt; frameN++;
      if (frameN >= 90) {
        var avg = frameAcc / frameN * 16.667;
        frameAcc = 0; frameN = 0;
        if (avg > 26 && quality > 0) { quality--; calmStreak = 0; }
        else if (avg < 15.5 && quality < QUALITY_SCALE.length - 1) {
          if (++calmStreak > 4) { quality++; calmStreak = 0; }
        } else { calmStreak = 0; }
      }

      if (fadeIn < 1) fadeIn = Math.min(1, fadeIn + dt / 36);
      if (chaos > 0) chaos = Math.max(0, chaos * Math.pow(0.955, dt));
      if (flash > 0) flash = Math.max(0, flash * Math.pow(0.9, dt));

      for (var k = 0; k < waves.length; k++) {
        waves[k].r += 26 * dt;
        waves[k].a -= 0.026 * dt;
      }

      update(dt);
      render();
    }

    function start() {
      if (running || disposed) return;
      running = true;
      lastT = 0;
      raf = window.requestAnimationFrame(tick);
    }

    function stop() {
      running = false;
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
    }

    /* -------------------------------------------------------------- UI */

    var ICON_BOOM =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" aria-hidden="true"><path d="M12 2.6v3.6M12 17.8v3.6M2.6 12h3.6' +
      'M17.8 12h3.6M5.9 5.9l2.5 2.5M15.6 15.6l2.5 2.5M18.1 5.9l-2.5 2.5M8.4 15.6l-2.5 2.5"/></svg>';
    var ICON_REFORM =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M20.4 12a8.4 8.4 0 1 1-2.5-6"/><path d="M20.6 4.2v5h-5"/></svg>';

    function buildUI() {
      var el = document.createElement('div');
      el.className = 'pt-ui';
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', '标题粒子效果控制');

      var html = '<div class="pt-swatches" role="radiogroup" aria-label="配色方案">';
      for (var i = 0; i < PALETTES.length; i++) {
        var c = PALETTES[i].colors;
        html += '<button type="button" class="pt-swatch" role="radio" aria-checked="false"' +
          ' data-i="' + i + '" title="' + PALETTES[i].name + '（快捷键 ' + (i + 1) + '）"' +
          ' aria-label="配色：' + PALETTES[i].name + '"' +
          ' style="--pt-c1:' + c[0] + ';--pt-c2:' + c[1] + ';--pt-c3:' + c[2] + '"></button>';
      }
      html += '</div><span class="pt-sep" aria-hidden="true"></span>' +
        '<button type="button" class="pt-btn pt-btn-boom" title="把粒子炸开（快捷键 E）">' +
        ICON_BOOM + '<span>炸开</span></button>' +
        '<button type="button" class="pt-btn pt-btn-reform" title="重新流动重组（快捷键 R）">' +
        ICON_REFORM + '<span>重组</span></button>';

      el.innerHTML = html;
      host.appendChild(el);
      window.setTimeout(function () { el.classList.add('is-in'); }, 40);

      el.addEventListener('click', function (e) {
        var t = e.target;
        var sw = t.closest ? t.closest('.pt-swatch') : null;
        if (sw) { setPalette(parseInt(sw.getAttribute('data-i'), 10)); return; }
        if (t.closest && t.closest('.pt-btn-boom')) { explode(1); return; }
        if (t.closest && t.closest('.pt-btn-reform')) { reform(); }
      });

      return {
        el: el,
        sync: function () {
          var list = el.querySelectorAll('.pt-swatch');
          for (var i = 0; i < list.length; i++) {
            var on = i === paletteIndex;
            list[i].classList.toggle('is-active', on);
            list[i].setAttribute('aria-checked', on ? 'true' : 'false');
          }
        },
        dim: function (on) { el.classList.toggle('is-dim', !!on); }
      };
    }

    /* ---------------------------------------------------------- 事件绑定 */

    function onPointer(e) {
      if (!hostRect.width) measureHost();
      var x = e.clientX - hostRect.left;
      var y = e.clientY - hostRect.top;
      if (x < -60 || y < -60 || x > hostRect.width + 60 || y > hostRect.height + 60) {
        mouse.active = false;
        return;
      }
      mouse.x = x; mouse.y = y; mouse.active = true;
    }

    function onPointerOut(e) {
      if (!e.relatedTarget) mouse.active = false;
    }

    function onDown(e) {
      if (e.target.closest && e.target.closest('.pt-ui, #nav, nav')) return;
      measureHost();
      pushAt(e.clientX - hostRect.left, e.clientY - hostRect.top, 1);
    }

    function onScroll() {
      measureHost();
      if (ui && H > 0) {
        var hidden = Math.max(0, -hostRect.top);
        ui.dim(hidden / H > 0.55);
      }
    }

    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      var k = e.key;
      if (k >= '1' && k <= '9') {
        var i = parseInt(k, 10) - 1;
        if (i < PALETTES.length) setPalette(i);
      } else if (k === 'e' || k === 'E') { explode(1); }
      else if (k === 'r' || k === 'R') { reform(); }
    }

    function onResize() {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(layout, 180);
    }

    function onVisibility() {
      if (document.hidden) stop();
      else start();
    }

    function onPjaxSend() { teardown(); }

    /* ------------------------------------------------------------ 生命周期 */

    function init() {
      stop();
      disposed = false;
      host.classList.add('pt-host');
      /* 主题里 #page-header 已经是 relative，这里只是兜底 */
      if (window.getComputedStyle(host).position === 'static') {
        host.style.position = 'relative';
        forcedPosition = true;
      }
      titleEl.classList.add('pt-title-hidden');

      /* 深色「舞台」遮罩：背景图偏亮时，粒子才透得出来 */
      if (CFG.scrim !== false) {
        scrimEl = document.createElement('div');
        scrimEl.className = 'pt-scrim';
        scrimEl.setAttribute('aria-hidden', 'true');
        host.appendChild(scrimEl);
      }

      canvas = document.createElement('canvas');
      canvas.className = 'pt-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      ctx = canvas.getContext('2d');
      host.appendChild(canvas);

      /* 配色优先级：URL 参数 > 本地记忆 > 默认 */
      var saved = null;
      try { saved = window.localStorage.getItem(LS_KEY); } catch (e) { saved = null; }
      var idx = DEFAULT_PALETTE;
      if (saved !== null && saved !== '' && !isNaN(parseInt(saved, 10))) {
        idx = parseInt(saved, 10);
      }
      var qs = /[?&]pt-palette=(\d+)/.exec(window.location.search);
      if (qs) idx = parseInt(qs[1], 10) - 1;

      setPalette(idx, true);      /* 先建贴图，layout 里建粒子要用 */
      layout();
      ui = buildUI();
      ui.sync();

      document.addEventListener('pointermove', onPointer, { passive: true });
      document.addEventListener('pointerdown', onDown, { passive: true });
      document.addEventListener('pointerout', onPointerOut, { passive: true });
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onResize);
      document.addEventListener('keydown', onKey);
      document.addEventListener('visibilitychange', onVisibility);
      document.addEventListener('pjax:send', onPjaxSend);

      start();
    }

    function destroy() {
      disposed = true;
      stop();
      window.clearTimeout(resizeTimer);
      document.removeEventListener('pointermove', onPointer);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointerout', onPointerOut);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pjax:send', onPjaxSend);
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      if (scrimEl && scrimEl.parentNode) scrimEl.parentNode.removeChild(scrimEl);
      if (ui && ui.el.parentNode) ui.el.parentNode.removeChild(ui.el);
      host.classList.remove('pt-host');
      titleEl.classList.remove('pt-title-hidden');
      host.style.removeProperty('--pt-title-y');
      host.style.removeProperty('--pt-sub-shift');
      if (forcedPosition) { host.style.removeProperty('position'); forcedPosition = false; }
      canvas = null; ctx = null; scrimEl = null; ui = null; backdrop = null;
      particles = []; pts = []; sprites = []; waves = [];
    }

    return {
      titleEl: titleEl,
      init: init,
      destroy: destroy,
      setPalette: setPalette,
      explode: explode,
      reform: reform,
      layout: layout
    };
  }

  /* ================================================================ 启动 */

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  ready(function () {
    var go = function () { boot(); };
    /* 等字体就绪，测量出的字宽才准确 */
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(go, go);
      window.setTimeout(go, 600);       /* 兜底：字体接口异常也要跑起来 */
    } else { go(); }
  });

  /* pjax 站内跳转：回到首页时重新初始化，离开时清理 */
  document.addEventListener('pjax:complete', function () {
    window.setTimeout(boot, 60);
  });

  window.__particleTitle = {
    boot: boot,
    destroy: teardown,
    setPalette: function (i) { if (current) current.setPalette(i); },
    explode: function (p) { if (current) current.explode(p || 1); },
    reform: function () { if (current) current.reform(); },
    palettes: PALETTES.map(function (p) { return p.name; })
  };
})();
