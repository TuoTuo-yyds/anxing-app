/* 安星 · 首页地图：POI 联想推荐 / 真实地图数据源 / 实时定位 / 路线入口 */
(function () {
  /* 演示固定起点：湖北美术学院藏龙岛校区（OSM 实测陆地坐标，不再落在汤逊湖水域） */
  var DEFAULT = { lat: 30.3942219, lng: 114.413263 };
  var PHOTON = 'https://photon.komoot.io/api/';
  var NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  var gps = { lat: DEFAULT.lat, lng: DEFAULT.lng, real: false, acc: 0 };
  var map = null, markers = [];
  var state = XA.searchState || { query: '', results: [], open: false };
  XA.searchState = state;
  var CATEGORY = { '酒店': 'hotel', '宾馆': 'hotel', '住宿': 'hotel', '便利店': 'convenience store', '超市': 'supermarket', '商店': 'shop', '公厕': 'toilets', '厕所': 'toilets', '洗手间': 'toilets', '餐厅': 'restaurant', '饭店': 'restaurant', '美食': 'restaurant', '咖啡': 'cafe', '药店': 'pharmacy', '医院': 'hospital', '地铁': 'subway', '公交': 'bus stop', '停车': 'parking', '银行': 'bank' };
  var BRAND = { '汉庭': 'Hanting', '如家': 'Home Inn', '全季': 'Ji Hotel', '锦江之星': 'Jinjiang Inn', '全家': 'FamilyMart', '罗森': 'Lawson', '星巴克': 'Starbucks', '肯德基': 'KFC', '麦当劳': "McDonald's" };

  /* 全部地点均来自真实地图服务（高德官方 API / 百度公开检索 / OSM），
     不再内置任何编造的演示 POI。服务不可用时明确报错，绝不冒充真实结果。 */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function outOfChina(lat, lng) { return lng < 73.66 || lng > 135.05 || lat < 3.86 || lat > 53.55; }
  function transformLat(x, y) {
    var r = -100 + 2 * x + 3 * y + .2 * y * y + .1 * x * y + .2 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
    r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
    return r;
  }
  function transformLng(x, y) {
    var r = 300 + x + 2 * y + .1 * x * x + .1 * x * y + .1 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
    r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
    return r;
  }
  function gcj(lat, lng) {
    if (outOfChina(lat, lng)) return [lat, lng];
    var a = 6378245, ee = .006693421622965943, dLat = transformLat(lng - 105, lat - 35), dLng = transformLng(lng - 105, lat - 35);
    var rad = lat / 180 * Math.PI, magic = 1 - ee * Math.sin(rad) * Math.sin(rad), sq = Math.sqrt(magic);
    return [lat + dLat * 180 / ((a * (1 - ee)) / (magic * sq) * Math.PI), lng + dLng * 180 / (a / sq * Math.cos(rad) * Math.PI)];
  }
  function distanceM(a, b, c, d) {
    var r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function fmt(m) { return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km'; }
  function timedFetch(url, ms) {
    if (typeof AbortController === 'undefined') return fetch(url);
    var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, ms || 8000);
    return fetch(url, { signal: ctrl.signal }).finally(function () { clearTimeout(timer); });
  }

  /* ---------- 合并后的搜索下拉 ----------
     输入即检索全国真实地点，搜索框下方直接列出「名称 + 地址 + 距离」的结果；
     点任一条直接打开地点详情，不再经过中间的「附近地点」面板。
     这是「搜索栏内容」与「附近地点列表」合并后的唯一结果入口。 */
  var suggestSeq = 0, suggestTimer = null;
  function renderSuggest(q) {
    var box = XA.$('#poiSuggest'); if (!box) return;
    q = String(q || '').trim();
    if (!q) { hideSuggest(); return; }
    var seq = ++suggestSeq;
    box.innerHTML = '<div class="poi-group">正在全国真实地图中查找「' + esc(q) + '」…</div>';
    box.classList.add('open');
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(function () {
      searchAll(q).then(function (res) {
        if (seq !== suggestSeq) return;
        var list = clean((res.real || []).concat(res.demo || []), 12);
        state.query = q;
        state.results = list;
        state.open = false;                       // 明确不打开「附近地点」面板
        var panel = XA.$('#poiResults'); if (panel) panel.classList.remove('open');
        if (!list.length) {
          box.innerHTML = '<div class="poi-group">没有找到「' + esc(q) + '」</div>' +
            '<div class="poi-suggest-empty">换个更完整的名称试试，例如「藏龙东街地铁站」「广州塔」。</div>';
          return;
        }
        var approx = list.some(function (p) { return p.approx; });
        box.innerHTML = '<div class="poi-group">' +
            (approx ? '真实地点 · 演示精度坐标' : '真实地图地点 · 精确坐标') +
            ' · ' + list.length + ' 个 · 点开即看详情</div>' +
          list.map(function (p, i) {
            return '<button class="poi-sug-item" data-action="poi-direct" data-poi="' + i + '">' +
              ic('pin') + '<span><b>' + esc(p.name) + '</b><small>' +
              esc(p.address || '真实地图收录地点') + '</small></span>' +
              '<em>' + fmt(p.dist) + '</em></button>';
          }).join('');
        box.classList.add('open');
        drawMarkers();
        if (map && markers.length) map.fitBounds(L.featureGroup(markers).getBounds().pad(.35), { maxZoom: 16 });
      }).catch(function () {
        if (seq !== suggestSeq) return;
        box.innerHTML = '<div class="poi-group">地点服务暂时不可用</div>' +
          '<div class="poi-suggest-empty">请检查网络后重试。</div>';
      });
    }, 260);
  }
  function hideSuggest() { suggestSeq++; var b = XA.$('#poiSuggest'); if (b) b.classList.remove('open'); }

  /* ---------- 真实地图数据源：Photon(OSM) → Nominatim(OSM) ---------- */
  function terms(q) {
    var out = [], hasBrand = false;
    function add(v) { if (v && out.indexOf(v) < 0) out.push(v); }
    add(q);
    Object.keys(BRAND).forEach(function (k) { if (q.indexOf(k) >= 0) { add(BRAND[k]); hasBrand = true; } });
    if (!hasBrand) Object.keys(CATEGORY).forEach(function (k) { if (q.indexOf(k) >= 0) add(CATEGORY[k]); });
    return out.slice(0, 2);
  }
  function query(term, radius) {
    var dLat = radius / 111320, dLng = radius / (111320 * Math.cos(gps.lat * Math.PI / 180));
    var bbox = [gps.lng - dLng, gps.lat - dLat, gps.lng + dLng, gps.lat + dLat].join(',');
    var url = PHOTON + '?q=' + encodeURIComponent(term) + '&limit=40&bbox=' + bbox + '&lat=' + gps.lat + '&lon=' + gps.lng;
    return timedFetch(url, 8000).then(function (r) { if (!r.ok) throw new Error('搜索服务暂不可用'); return r.json(); }).then(function (d) {
      return (d.features || []).map(function (f) {
        var p = f.properties || {}, c = f.geometry.coordinates;
        return { name: p.name || p.street || '未命名地点', lat: c[1], lng: c[0], address: [p.district, p.street, p.housenumber].filter(Boolean).join('') || [p.city, p.state].filter(Boolean).join(' · '), category: p.osm_value || '地点', dist: distanceM(gps.lat, gps.lng, c[1], c[0]), demo: false };
      }).filter(function (p) { return p.dist <= radius; }).sort(function (a, b) { return a.dist - b.dist; });
    });
  }
  function searchTerms(q, radius) {
    var list = terms(q);
    function next(i) {
      if (i >= list.length) return Promise.resolve([]);
      return query(list[i], radius).then(function (r) { return r.length ? r : next(i + 1); }).catch(function () { return next(i + 1); });
    }
    return next(0);
  }
  function nominatim(q) {
    var r = 5000, dLat = r / 111320, dLng = r / (111320 * Math.cos(gps.lat * Math.PI / 180));
    var vb = [gps.lng - dLng, gps.lat + dLat, gps.lng + dLng, gps.lat - dLat].join(',');
    var url = NOMINATIM + '?format=json&limit=12&addressdetails=1&bounded=1&viewbox=' + vb + '&q=' + encodeURIComponent(terms(q)[0] || q);
    return timedFetch(url, 8000).then(function (res) { if (!res.ok) throw new Error('no'); return res.json(); }).then(function (d) {
      return (d || []).map(function (f) {
        var lat = parseFloat(f.lat), lng = parseFloat(f.lon), a = f.address || {};
        return { name: f.name || (f.display_name || '').split(',')[0], lat: lat, lng: lng, address: [a.road, a.suburb, a.city].filter(Boolean).join(' · '), category: f.type || '地点', dist: distanceM(gps.lat, gps.lng, lat, lng), demo: false };
      }).filter(function (p) { return isFinite(p.lat) && isFinite(p.lng); }).sort(function (a, b) { return a.dist - b.dist; });
    }).catch(function () { return []; });
  }
  /* ---------- 真实地点检索链 ----------
     1) 已配置高德 Key：官方 Web 服务，全国 POI，米级精确坐标（GCJ02→WGS84）
     2) 未配置 Key：百度网页版公开检索（JSONP），同样全国真实 POI，坐标为演示精度
     3) 两条链路都失败：明确报错，不再用编造地点冒充真实结果
     数据一律来自真实地图服务，用户搜到哪个地方就是哪个地方。 */
  /* 清洗：过滤无名称/无坐标/重复项，保证列表里每一条都是可定位的真实地点 */
  function clean(list, limit) {
    var seen = {};
    return (list || []).filter(function (p) {
      if (!p || !p.name || String(p.name).trim() === '' || String(p.name) === 'undefined') return false;
      if (!isFinite(p.lat) || !isFinite(p.lng) || (!p.lat && !p.lng)) return false;
      var k = p.name + '|' + (+p.lat).toFixed(4) + ',' + (+p.lng).toFixed(4);
      if (seen[k]) return false; seen[k] = 1; return true;
    }).slice(0, limit || 12);
  }
  function searchAll(q) {
    var origin = { lat: gps.lat, lng: gps.lng };
    var precise = !!(XA.Geo && XA.Geo.hasKey());
    var primary = precise
      ? XA.Geo.search(q, { origin: origin, limit: 20 }).catch(function () { return []; })
      : Promise.resolve([]);
    return primary.then(function (list) {
      var a = clean(list, 12);
      if (a.length) return { real: a, demo: [], precise: true };
      // 降级到免 Key 的全国真实 POI 源
      return XA.GeoFallback.search(q, { origin: origin }).then(function (b) {
        var c = clean(b, 12);
        if (c.length) return { real: c, demo: [], precise: false };
        // 再尝试全球 OSM（覆盖境外/英文地名）
        return searchTerms(q, 50000).then(function (o) { return o || []; }).catch(function () { return []; })
          .then(function (o) { return { real: clean(o, 12), demo: [], precise: false, osm: true }; });
      });
    });
  }

  function renderResults(q) {
    var panel = XA.$('#poiResults'), list = XA.$('#poiList');
    if (!panel || !list) return;
    panel.classList.add('open'); state.open = true;
    var total = state.results.length;
    XA.$('#poiTitle').textContent = q + ' · ' + (total ? total + ' 个附近地点' : '搜索结果');
    if (!total) {
      list.innerHTML = '<div class="poi-empty">暂无附近地点，换个关键词试试。</div>';
      return;
    }
    function item(p, i) {
      return '<button class="poi-item" data-action="poi-detail" data-poi="' + i + '"><span class="poi-index">' + (i + 1) + '</span>' +
        '<span><b>' + esc(p.name) + '</b><small>' + esc(p.address || '公开地图收录地点') + '</small></span><em>' + fmt(p.dist) + '</em></button>';
    }
    var isApprox = state.results.some(function (p) { return p.approx; });
    var label = isApprox ? '真实地点 · 演示精度坐标（配置地图 Key 后为米级）' : '真实地图地点 · 精确坐标';
    list.innerHTML = '<div class="poi-group">' + label + ' · ' + state.results.length + ' 个</div>' +
      state.results.map(function (p, i) { return item(p, i); }).join('');
  }
  function clearMarkers() {
    if (!map) return;
    markers.forEach(function (m) { map.removeLayer(m); }); markers = [];
  }
  function drawMarkers() {
    clearMarkers(); if (!map) return;
    state.results.forEach(function (p, i) {
      var m = L.circleMarker(gcj(p.lat, p.lng), { radius: 8, color: '#0b1420', weight: 2.5, fillColor: p.demo ? '#ffc46b' : '#ffffff', fillOpacity: 1 }).addTo(map);
      m.bindTooltip(esc(p.name), { direction: 'top', offset: [0, -8], className: 'poi-tooltip' });
      m.on('click', function () { openDetail(i); });
      markers.push(m);
    });
  }
  /* 点「搜索」或按回车：结果仍只出现在搜索框下方的下拉里，不再弹「附近地点」面板 */
  function doSearch(q) {
    q = String(q || '').trim();
    if (!q) { XA.toast('请先输入地点名称，再点搜索'); var i0 = XA.$('#homeSearchInput'); if (i0) i0.focus(); return; }
    var input = XA.$('#homeSearchInput'); if (input) input.value = q;
    renderSuggest(q);
  }
  function runSearch(q) { doSearch(q); }   // 兼容旧调用，统一走合并后的下拉
  function openDetail(i) {
    var p = state.results[i]; if (!p) return;
    var src = p.approx ? '真实地点 · 演示精度坐标' : '真实地点 · 精确坐标';
    XA.openSheet('<h3>' + esc(p.name) + '</h3><div class="sheet-sub">' + src + ' · 距你 ' + fmt(p.dist) + '</div>' +
      /* 纯资料展示：无卡片、无边框、无点击态，与下方操作按钮明确区分 */
      '<dl class="poi-facts">' +
        '<div class="poi-fact"><dt>地址</dt><dd>' + esc(p.address || '地图暂未提供详细地址') + '</dd></div>' +
        '<div class="poi-fact"><dt>类别</dt><dd>' + esc(p.category || '地点') + '</dd></div>' +
        '<div class="poi-fact"><dt>坐标</dt><dd class="poi-coord">' + p.lat.toFixed(6) + ', ' + p.lng.toFixed(6) + '<span>WGS84</span></dd></div>' +
      '</dl>' +
      '<p class="poi-facts-note">选择路线后可查看夜间安全评分与照明信息</p>' +
      '<button class="primary-btn" data-action="navigate-poi" data-poi="' + i + '">选择路线并导航</button>' +
      '<button class="ghost-btn" data-action="locate-poi" data-poi="' + i + '">在地图中定位</button>');
  }
  /* 定位按钮：申请位置权限；授权后回到真实位置，未授权时保持演示起点 */
  function recenter() {
    if (XA.startLiveLocation) XA.startLiveLocation(false);
    var p = XA.position || DEFAULT;
    var c = gcj(p.real ? p.lat : DEFAULT.lat, p.real ? p.lng : DEFAULT.lng);
    if (map) map.setView(c, 16, { animate: true });
    XA.toast(p.real ? '已回到你的实时位置' : '已回到演示起点 · 湖北美术学院藏龙岛校区');
  }
  function closeSearch() {
    state.open = false; clearMarkers(); hideSuggest();
    var p = XA.$('#poiResults'); if (p) p.classList.remove('open');
  }
  function focusSearch() {
    XA.go('home');
    setTimeout(function () { var i = XA.$('#homeSearchInput'); if (i) { i.focus(); renderSuggest(i.value); } }, 120);
  }
  /* ---------- 使用指南：按当前 3.0 真实交互重写五步 ----------
     每条含：标题、说明（做什么）、原则（为什么这么设计）、示意图目标元素 gm、
     以及真实界面里的高亮 target。文案遵循八大原则，术语与实际界面完全一致。 */
  var GUIDE_STEPS = [
    { title: '搜索真实地点',
      tip: '顶部输入地铁站、店铺、小区或景点，搜索框下方直接列出真实地点与距离；点其中一条就直接看到该地点的地址、类别、坐标，并可立即选择路线导航。',
      why: '易学性 · 效率：一步到位，不用在两层列表之间来回点。',
      gm: 'search', label: '顶部搜索框', target: '.home-search', shape: 'pill' },
    { title: '看清身边的守护信息',
      tip: '「附近 12 人」显示同路段夜行者；右侧按钮切换风险点位，状态会明确写着「已隐藏 / 已显示」；定位按钮随时回到你的真实位置。',
      why: '可见性 · 反馈：信息常驻可见，每次操作都有明确回应。',
      gm: 'nearby', label: '附近同行者', target: '.nearby-chip', shape: 'pill' },
    { title: '沿真实路线出发',
      tip: '选好地点后比较安全分、路灯与监控，点「开始导航」；地图上会出现沿道路的引导线与橙色终点，缩放拖动都跟着走，右下角可一键回到完整路线。',
      why: '一致性 · 用户控制：路线与终点始终跟着地图，随时可退出。',
      gm: 'route', label: '开始导航', target: '.tab[data-tab="home"]', shape: 'pill' },
    { title: '夜路有声音陪着',
      tip: '伴行页有音乐、听书与 AR 眼镜入口。不想被打扰时随时切回导航，声音不会挡住任何安全操作。',
      why: '容错 · 美观：陪伴是可选的，不打断主任务。',
      gm: 'tab-music', label: '伴行标签', target: '.tab[data-tab="entertainment"]', shape: 'round' },
    { title: '按危险程度求救',
      tip: '中央「求救」分两级：有点不安先「共享实时位置」（不报警、不打扰警方）；确认危险才进 SOS，确认后仍有可取消的倒计时。',
      why: '容错 · 用户控制：不必小题大做，误触也来得及取消。',
      gm: 'tab-help', label: '求救按钮', target: '.sos-tab', shape: 'round' }
  ];
  /* 示意图：每个可指向元素带 data-gm，圆圈由 positionSpot() 实测坐标后精确套住 */
  function mockHtml(s) {
    return '<div class="guide-mock"><div class="gm-screen" id="gmScreen">' +
      '<span class="gm-status">安星 · 夜行安全　21:40</span>' +
      '<span class="gm-search" data-gm="search">' + ic('search') + '输入地点或品牌<span class="gm-search-btn">搜索</span></span>' +
      '<span class="gm-map">' +
        '<span class="gm-nearby" data-gm="nearby"><i></i>附近 12 人</span>' +
        '<span class="gm-float" data-gm="risk">' + ic('warning') + '</span>' +
        '<span class="gm-locate" data-gm="locate">' + ic('pin') + '</span>' +
        '<span class="gm-route-line"></span>' +
        '<span class="gm-me">' + ic('navigation') + '</span>' +
      '</span>' +
      '<span class="gm-route" data-gm="route">推荐路线 A　【开始导航】</span>' +
      '<span class="gm-tabs">' +
        '<i data-gm="tab-nav">' + ic('navigation') + '</i>' +
        '<i data-gm="tab-music">' + ic('music') + '</i>' +
        '<i class="gm-help" data-gm="tab-help">求救</i>' +
        '<i data-gm="tab-community">' + ic('users') + '</i>' +
        '<i data-gm="tab-profile">' + ic('user') + '</i>' +
      '</span>' +
      '<span class="gm-spot" id="gmSpot"></span>' +
      '<span class="gm-arrow" id="gmArrow">↓</span>' +
      '</div><small>界面示意图 · 已圈出「' + esc(s.label) + '」</small></div>';
  }
  /* 关键修复：不再用百分比猜位置。渲染完成后实测目标元素相对示意图的
     真实矩形，按原尺寸外扩 padding 套框，保证圆圈完整、端正地包住目标。 */
  function positionSpot(s) {
    var screen = XA.$('#gmScreen'), spot = XA.$('#gmSpot'), arrow = XA.$('#gmArrow');
    if (!screen || !spot || !arrow) return;
    var t = XA.$('[data-gm="' + s.gm + '"]', screen);
    if (!t) return;
    var sr = screen.getBoundingClientRect(), tr = t.getBoundingClientRect();
    if (!tr.width || !tr.height) return;
    var pad = s.shape === 'round' ? 6 : 5;
    var w = tr.width + pad * 2, h = tr.height + pad * 2;
    var l = tr.left - sr.left - pad, top = tr.top - sr.top - pad;
    spot.style.left = l + 'px'; spot.style.top = top + 'px';
    spot.style.width = w + 'px'; spot.style.height = h + 'px';
    spot.style.borderRadius = s.shape === 'round' ? '50%' : Math.round(Math.min(w, h) / 2) + 'px';
    /* 箭头在框上方；若上方空间不足则移到框下方并翻转方向 */
    var above = top > 26;
    arrow.style.left = (l + w / 2) + 'px';
    arrow.style.top = above ? (top - 3) + 'px' : (top + h + 3) + 'px';
    arrow.textContent = above ? '↓' : '↑';
    arrow.classList.toggle('below', !above);
  }
  function clearGuideHl() { XA.$$('.guide-hl').forEach(function (el) { el.classList.remove('guide-hl'); }); }
  function guide() {
    /* 「我的 → 使用指南」是显式入口，任何时候都必须能打开，
       不受"已看过/已关闭"状态影响；打开时收起底部提示栏避免重叠。 */
    XA.guideShown = true;
    var hint = XA.$('#guideHint'); if (hint) hint.remove();
    var phone = XA.$('#phone'); if (!phone) return;
    var old = XA.$('#guideLayer'); if (old) old.remove();
    phone.insertAdjacentHTML('beforeend', '<div class="guide-layer" id="guideLayer"><div class="guide-card"><span class="guide-step" id="guideStep">1 / ' + GUIDE_STEPS.length + '</span><div id="guideBody"></div><div class="guide-actions"><button data-action="skip-guide">跳过</button><button class="primary-btn" data-action="next-guide" id="guideNext">下一步</button></div></div></div>');
    XA.guideStep = 1; renderGuide();
  }
  function renderGuide() {
    var s = GUIDE_STEPS[XA.guideStep - 1]; if (!s) return;
    clearGuideHl();
    var el = XA.$(s.target);
    if (el) el.classList.add('guide-hl');
    var stepEl = XA.$('#guideStep'), body = XA.$('#guideBody'), next = XA.$('#guideNext');
    if (stepEl) stepEl.textContent = XA.guideStep + ' / ' + GUIDE_STEPS.length;
    if (body) {
      body.innerHTML = '<h2>' + s.title + '</h2><p>' + s.tip + '</p>' +
        '<div class="guide-why">' + ic('shield') + '<span>' + s.why + '</span></div>' + mockHtml(s);
    }
    if (next) next.textContent = XA.guideStep === GUIDE_STEPS.length ? '开始体验' : '下一步';
    /* innerHTML 后直接同步实测（读取 rect 会强制浏览器完成布局），
       再用 rAF 兜底一次；不依赖动画帧，任何环境下都精确。 */
    positionSpot(s);
    requestAnimationFrame(function () { positionSpot(s); });
    if (XA._guideResize) window.removeEventListener('resize', XA._guideResize);
    XA._guideResize = function () { positionSpot(GUIDE_STEPS[XA.guideStep - 1] || {}); };
    window.addEventListener('resize', XA._guideResize);
  }
  function endGuide() {
    clearGuideHl();
    if (XA._guideResize) { window.removeEventListener('resize', XA._guideResize); XA._guideResize = null; }
    var l = XA.$('#guideLayer'); if (l) l.remove();
    /* 看完 / 跳过教程后，底部引导提示栏一并关闭：
       持久化「已看过」→ 刷新不再自动出现；明确提示可随时从「我的 → 使用指南」重新打开。 */
    if (XA.markGuideSeen) XA.markGuideSeen();
    if (XA.dismissGuideHint) XA.dismissGuideHint();
  }

  /* 实时定位由 legacy.js 统一发布；poi-map 只订阅，避免多个 watcher 抢定位 */
  XA.onPositionChange = function (p) {
    /* 实时坐标仅用于搜索中心 / SOS 位置共享，不移动武汉演示地图视角与标记 */
    gps = { lat: p.lat, lng: p.lng, real: !!p.real, acc: p.acc || 0 };
  };
  function init() {
    var el = XA.$('#homeMap'); if (!el) return;
    map = el._xaMap || null;
    if (map) { XA.settings.follow = false; setTimeout(function () { map.invalidateSize(); }, 200); }
    if (XA.position && XA.position.real) XA.onPositionChange(XA.position);
    /* 恢复页面状态只重画地图标记，绝不重新弹出「附近地点」面板 */
    if (state.results.length) drawMarkers();
    var panel = XA.$('#poiResults'); if (panel) panel.classList.remove('open');
    /* 引导改由 legacy.js 在登录完成后给出非阻断提示，由用户主动打开，这里不再定时强弹 */
  }
  XA.actions.search = focusSearch;
  XA.actions['open-poi-map'] = focusSearch;
  XA.actions['focus-search'] = focusSearch;
  XA.actions['do-search'] = function () { var i = XA.$('#homeSearchInput'); doSearch(i ? i.value : ''); };
  XA.actions['search-category'] = function (el) { doSearch(el.dataset.category); };
  XA.actions['poi-suggest'] = function (el) { var i = XA.$('#homeSearchInput'); if (i) i.value = el.dataset.q; doSearch(el.dataset.q); };
  XA.actions['close-search'] = closeSearch;
  /* 下拉里的地点：一步直达详情弹层（跳过中间的「附近地点」结果面板） */
  XA.actions['poi-direct'] = function (el) {
    var i = +el.dataset.poi;
    if (!state.results[i]) return;
    hideSuggest();                 // 关闭下拉，避免遮住详情弹层
    openDetail(i);
  };
  XA.actions['poi-detail'] = function (el) { openDetail(+el.dataset.poi); };
  XA.actions['locate-poi'] = function (el) { var p = state.results[+el.dataset.poi]; if (p && map) { XA.closeModal(); map.setView(gcj(p.lat, p.lng), 18); XA.toast('已定位到 ' + p.name); } };
  XA.actions['navigate-poi'] = function (el) {
    var p = state.results[+el.dataset.poi]; if (!p) return;
    XA.closeModal();
    XA.setDestination(p.name, { name: p.name, lat: p.lat, lng: p.lng });
    XA.go('route');
    XA.toast('目的地已设置 · 点击【开始导航】出发');
  };
  XA.actions.recenter = recenter;
  XA.actions['open-guide'] = guide;
  XA.actions['skip-guide'] = endGuide;
  XA.actions['next-guide'] = function () { if (XA.guideStep >= GUIDE_STEPS.length) endGuide(); else { XA.guideStep++; renderGuide(); } };
  var ROUTE_INFO = { A: ['栗庙路主线', '92', '86%', '12 处', '+3 分钟'], B: ['藏龙支路捷径', '78', '61%', '8 处', '+0 分钟'], C: ['藏龙大道夜市', '64', '43%', '5 处', '-3 分钟'] };
  XA.actions['route-detail'] = function (el) {
    var k = el && el.dataset.route ? el.dataset.route : 'A';
    var info = ROUTE_INFO[k] || ROUTE_INFO.A;
    XA.selectRoute(k);
    XA.openSheet('<h3>路线 ' + k + ' · ' + info[0] + '</h3><div class="sheet-sub">安全分 ' + info[1] + ' · 路灯 ' + info[2] + ' · 监控 ' + info[3] + ' · 额外耗时 ' + info[4] + '</div>' +
      '<div class="option-row">' + ic('shield') + '<span><b>安全系数 ' + info[1] + '</b><small>路灯、监控与人流加权计算</small></span></div>' +
      '<div class="option-row">' + ic('warning') + '<span><b>风险提示</b><small>出发前请再次观察现场环境，路况可能变化</small></span></div>' +
      '<button class="primary-btn" data-action="start-nav">' + ic('navigation') + '开始导航</button>');
  };
  var inputInit = function () {
    var i = XA.$('#homeSearchInput'); if (!i) return;
    var timer = null;
    i.addEventListener('input', function () {
      clearTimeout(timer);
      var v = i.value;
      if (!String(v || '').trim()) { hideSuggest(); return; }   // 清空立即隐藏，不再弹出默认推荐
      timer = setTimeout(function () { renderSuggest(v); }, 160); // 输入停顿后再联想，避免触发过早
    });
    i.addEventListener('focus', function () { if (String(i.value || '').trim()) renderSuggest(i.value); });
    i.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(i.value); if (e.key === 'Escape') hideSuggest(); });
    document.addEventListener('pointerdown', function (e) {
      if (!e.target.closest('#poiSuggest') && !e.target.closest('#homeSearch')) hideSuggest();
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); inputInit(); }); else { init(); inputInit(); }
})();
