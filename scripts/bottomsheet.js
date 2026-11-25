/* =========================================================
   安星 · 沉浸式底部上拉弹窗控制器
   依赖：XA.$ / XA.$$（app.js），ic()（screens-a.js）
   面板固定 85% 屏高，translateY 永远 >= 0 => 底边不出屏，不露白
   两个锚点：expanded(translateY=0) / collapsed(translateY=maxY)
   ========================================================= */
(function () {
  function ico(name, cls) { return '<svg class="ico ' + (cls || '') + '"><use href="#i-' + name + '"/></svg>'; }

  var STOPS = [];            // 运行时计算的锚点像素值
  var MAX_Y = 0;             // 收起态位移
  var PEEK = 0;              // 收起时露出的高度
  var sheetY = 0;            // 当前位移
  var sheet, scrollEl, layer, backdrop;
  var dragging = false, moved = false, mode = null, startPointerY = 0, startSheetY = 0, lastY = 0, lastT = 0, velocity = 0;

  function buildContent() {
    var cards = [
      ['放松视频', '庇护所建造 · 雨林', 'music', 'cv-amber', 'video'],
      ['深夜食堂', '治愈吃播 · 热汤面', 'play', 'cv-rose', 'video'],
      ['雨夜白噪音', '街声与伞面细雨', 'music', 'cv-blue', 'radio'],
      ['解压时刻', 'AI Cols 爽剧精选', 'play', 'cv-violet', 'video'],
      ['伴行歌单', '果宝特攻DJ · Hit the Road, Jack', 'music', 'cv-mint', 'radio'],
      ['枕边有声书', '夜行便利店 · 第 1 章', 'play', 'cv-slate', 'book']
    ];
    var grid = cards.map(function (c) {
      return '<button class="bs-card" data-bs-play data-bs-cat="' + c[4] + '">' +
        '<span class="bs-cover ' + c[3] + '"><span class="bs-cover-ico">' + ico(c[2]) + '</span><span class="bs-play">' + ico('play') + '</span></span>' +
        '<span class="bs-card-b"><b>' + c[0] + '</b><small>' + c[1] + '</small></span></button>';
    }).join('');

    return '<div class="bs-layer" id="bsLayer">' +
      '<div class="bs-backdrop" data-bs-backdrop></div>' +
      '<div class="bs-sheet" id="bsSheet" role="dialog" aria-modal="true" aria-label="沉浸伴行面板">' +
        '<div class="bs-grab" id="bsGrab">' +
          '<div class="bs-handle"></div>' +
          '<div class="bs-head"><span class="bs-head-ico">' + ico('music') + '</span>' +
            '<span class="bs-head-txt"><b>沉浸伴行</b><small>上拉展开 · 下滑收起 · 内容独立滚动</small></span></div>' +
          '<button class="bs-close" data-bs-close aria-label="关闭沉浸伴行">' + ico('close') + '</button>' +
          '<span class="bs-grab-hint">' + ico('chevron') + ' 上拉</span>' +
        '</div>' +
        '<div class="bs-scroll" id="bsScroll">' +
          '<div class="bs-tabs">' +
            '<button class="bs-tab active" data-bs-tab="all">为你推荐</button>' +
            '<button class="bs-tab" data-bs-tab="video">放松视频</button>' +
            '<button class="bs-tab" data-bs-tab="radio">音乐电台</button>' +
            '<button class="bs-tab" data-bs-tab="book">听书</button>' +
          '</div>' +
          '<div class="bs-note">' + ico('shield') + '<span>听歌看剧时，底部 SOS 始终悬浮可求救</span><b>LIVE</b></div>' +
          '<div class="bs-sec"><b>今夜精选</b><small>下滑内容 · 到顶后下拉可收起</small></div>' +
          '<div class="bs-grid">' + grid + '</div>' +
          '<div class="bs-sec"><b>继续收听</b><small>AUTO PLAY</small></div>' +
          '<div class="bs-grid">' + grid + '</div>' +
        '</div>' +
      '</div></div>';
  }

  function measure() {
    var phone = XA.$('#phone');
    var H = phone.clientHeight;
    PEEK = sheet.querySelector('.bs-grab').offsetHeight;
    var sheetH = sheet.offsetHeight || H * 0.85;
    MAX_Y = Math.max(0, sheetH - PEEK);
    STOPS = [0, MAX_Y];
  }

  function applyTransform() {
    if (sheetY < 0) sheetY = 0;
    sheet.style.transform = 'translateY(' + sheetY + 'px)';
  }

  function setSheetY(y) { sheetY = y; applyTransform(); }

  function nearestStop() {
    return (Math.abs(sheetY - STOPS[0]) <= Math.abs(sheetY - STOPS[1])) ? STOPS[0] : STOPS[1];
  }

  function snap(forceDown) {
    sheet.classList.add('snapping');
    var target;
    if (forceDown) target = STOPS[1];
    else if (velocity > 0.55) target = STOPS[1];
    else if (velocity < -0.55) target = STOPS[0];
    else target = nearestStop();
    setSheetY(target);
    setTimeout(function () { sheet.classList.remove('snapping'); }, 470);
  }

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    /* 交互元素直接交给原生 click，绝不启动拖拽；否则内部按钮会被手势吞掉 */
    if (e.target.closest('button, a, input, select, textarea')) return;
    dragging = true;
    moved = false;
    velocity = 0;
    startPointerY = e.clientY;
    startSheetY = sheetY;
    lastY = e.clientY;
    lastT = performance.now();
    mode = (e.target.closest('.bs-grab')) ? 'sheet' : 'content';
    sheet.classList.remove('snapping', 'at-top');
    /* 关键修复：不调用 setPointerCapture，否则 click 的 target 会被劫持为 sheet，
       面板内所有按钮（关闭 / 视频 / 电台 / 听书 / 标签）都会失效 */
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function onMove(e) {
    if (!dragging) return;
    var now = performance.now();
    var dy = e.clientY - lastY;
    if (!moved) {
      if (Math.abs(e.clientY - startPointerY) < 5) { lastY = e.clientY; lastT = now; return; }
      moved = true;
      sheet.classList.add('grabbing');
    }

    if (mode === 'content') {
      var maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      var top = scrollEl.scrollTop;
      var handoffUp = dy < 0 && top >= maxScroll - 1;
      var handoffDown = dy > 0 && top <= 1;
      if (!handoffUp && !handoffDown) {
        scrollEl.scrollTop = top - dy;
      } else {
        mode = 'sheet';
        startSheetY = sheetY;
        startPointerY = e.clientY - dy;
      }
    }

    if (mode === 'sheet') {
      var raw = startSheetY + (e.clientY - startPointerY);
      var damped;
      if (raw < 0) { damped = raw * 0.12; sheet.classList.add('at-top'); }
      else if (raw > MAX_Y) { damped = MAX_Y + (raw - MAX_Y) * 0.28; }
      else { damped = raw; sheet.classList.remove('at-top'); }
      setSheetY(damped);
      var dt = now - lastT;
      if (dt > 0) velocity = velocity * 0.4 + (dy / dt) * 0.6;
    }

    lastY = e.clientY;
    lastT = now;
    e.preventDefault();
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    sheet.classList.remove('grabbing');
    if (moved && mode === 'sheet') snap(false);
    mode = null;
  }

  function bindGestures() {
    sheet.addEventListener('pointerdown', onDown);
  }

  function open() {
    if (!layer) {
      var phone = XA.$('#phone');
      phone.insertAdjacentHTML('beforeend', buildContent());
      layer = XA.$('#bsLayer');
      sheet = XA.$('#bsSheet');
      scrollEl = XA.$('#bsScroll');
      backdrop = layer.querySelector('.bs-backdrop');
      measure();
      bindGestures();
      backdrop.addEventListener('click', close);
      layer.querySelector('[data-bs-close]').addEventListener('click', function (e) {
        e.stopPropagation();
        close();
      });
      XA.$$('.bs-tab').forEach(function (t) {
        t.addEventListener('click', function (e) {
          e.stopPropagation();
          XA.$$('.bs-tab').forEach(function (x) { x.classList.remove('active'); });
          t.classList.add('active');
          var cat = t.dataset.bsTab || 'all';
          XA.$$('.bs-card').forEach(function (c) { c.hidden = cat !== 'all' && c.dataset.bsCat !== cat; });
          scrollEl.scrollTop = 0;
          XA.toast('已切换 · ' + t.textContent);
        });
      });
      XA.$$('[data-bs-play]').forEach(function (c) {
        c.addEventListener('click', function (e) {
          e.stopPropagation();
          XA.toast('正在播放 · ' + c.querySelector('b').textContent + '（演示）');
        });
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && layer && layer.classList.contains('open')) close();
      });
    }
    measure();
    layer.classList.add('open');
    XA.$('#phone').classList.add('modal-open');
    setSheetY(0);                        // 点击入口即完全展开，无需用户手动上拉
    sheet.style.transform = 'translateY(100%)';
    void sheet.offsetWidth;
    sheet.classList.add('snapping');
    setSheetY(0);
    setTimeout(function () { sheet.classList.remove('snapping'); }, 470);
  }

  function collapse() {
    if (!layer || !layer.classList.contains('open')) return;
    sheet.classList.add('snapping');
    setSheetY(MAX_Y);
    setTimeout(function () { sheet.classList.remove('snapping'); }, 470);
  }

  function close() {
    if (!layer) return;
    /* 清理进行中的手势，避免关闭后残留 window 级监听继续吞事件 */
    dragging = false;
    moved = false;
    mode = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    sheet.classList.remove('grabbing');
    XA.$$('.bs-card').forEach(function (c) { c.hidden = false; });
    XA.$$('.bs-tab').forEach(function (t, i) { t.classList.toggle('active', i === 0); });
    sheet.classList.add('snapping');
    sheet.style.transform = 'translateY(100%)';
    XA.$('#phone').classList.remove('modal-open');
    layer.classList.remove('open');      // CSS 下 .bs-layer 会 display:none，遮罩彻底失效
    setTimeout(function () { sheet.classList.remove('snapping'); }, 470);
  }

  window.addEventListener('resize', function () {
    if (layer && layer.classList.contains('open')) { measure(); setSheetY(Math.min(sheetY, MAX_Y)); }
  });

  XA.openBottomSheet = open;
  XA.closeBottomSheet = close;
  XA.actions['open-bottom-sheet'] = function () { open(); };
  XA.actions['close-bottom-sheet'] = function () { close(); };
})();
