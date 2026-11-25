/* =========================================================
   安星 · 真实地理服务层 (Amap Web Service)
   - 官方 Web 服务 API：全中国真实 POI / 地理编码 / 步行路径
   - 浏览器直连（高德返回 ACAO:*），无需后端代理
   - 统一坐标系：对外一律 WGS84，内部自动完成 GCJ02 纠偏
   - Key 未配置时自动降级到免 Key 的真实 POI 源，绝不返回编造地点
   ========================================================= */
(function () {
  var A = window.XA = window.XA || {};
  var BASE = 'https://restapi.amap.com/v3';
  var KEY_STORE = 'xa_amap_key';
  /* 内置的高德 Web 服务 Key：用户打开 APP 即可使用真实地点搜索，无需任何配置。
     个人开发者免费额度（30 万次/日）。若需更换，可在设置页覆盖（存于本机 localStorage）。 */
  var BUILTIN_KEY = 'eba96933596f86a0d79c484b8c168540';

  /* ---------------- 坐标系 ---------------- */
  var PI = Math.PI, A_AXIS = 6378245.0, EE = 0.00669342162296594323;
  function outOfChina(lng, lat) { return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55); }
  function transLat(x, y) {
    var r = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*Math.sqrt(Math.abs(x));
    r += (20*Math.sin(6*x*PI) + 20*Math.sin(2*x*PI))*2/3;
    r += (20*Math.sin(y*PI) + 40*Math.sin(y/3*PI))*2/3;
    r += (160*Math.sin(y/12*PI) + 320*Math.sin(y*PI/30))*2/3;
    return r;
  }
  function transLng(x, y) {
    var r = 300 + x + 2*y + .1*x*x + .1*x*y + .1*Math.sqrt(Math.abs(x));
    r += (20*Math.sin(6*x*PI) + 20*Math.sin(2*x*PI))*2/3;
    r += (20*Math.sin(x*PI) + 40*Math.sin(x/3*PI))*2/3;
    r += (150*Math.sin(x/12*PI) + 300*Math.sin(x/30*PI))*2/3;
    return r;
  }
  function wgs84ToGcj02(lng, lat) {
    if (outOfChina(lng, lat)) return [lng, lat];
    var dLat = transLat(lng-105, lat-35), dLng = transLng(lng-105, lat-35);
    var rad = lat/180*PI, magic = 1-EE*Math.sin(rad)*Math.sin(rad), sq = Math.sqrt(magic);
    dLat = dLat*180/((A_AXIS*(1-EE))/(magic*sq)*PI);
    dLng = dLng*180/(A_AXIS/sq*Math.cos(rad)*PI);
    return [lng+dLng, lat+dLat];
  }
  function gcj02ToWgs84(lng, lat) {
    if (outOfChina(lng, lat)) return [lng, lat];
    var g = wgs84ToGcj02(lng, lat);
    /* 一次迭代即可收敛到厘米级 */
    var w = [lng-(g[0]-lng), lat-(g[1]-lat)];
    g = wgs84ToGcj02(w[0], w[1]);
    return [w[0]-(g[0]-lng), w[1]-(g[1]-lat)];
  }

  /* ---------------- Key ---------------- */
  /* 优先使用本机覆盖值；未覆盖时直接用内置 Key —— 打开 APP 即生效 */
  function getKey() {
    try {
      var v = (localStorage.getItem(KEY_STORE) || '').trim();
      if (v) return v;
    } catch (e) {}
    return BUILTIN_KEY;
  }
  function setKey(k) {
    try { localStorage.setItem(KEY_STORE, String(k||'').trim()); } catch (e) {}
    A.Geo.key = getKey();
  }
  function clearOverride() {
    try { localStorage.removeItem(KEY_STORE); } catch (e) {}
    A.Geo.key = getKey();
  }
  function hasKey() { return !!getKey(); }
  function isBuiltin() {
    try { return !(localStorage.getItem(KEY_STORE) || '').trim(); } catch (e) { return true; }
  }

  /* ---------------- HTTP ---------------- */
  function http(path, params) {
    var q = Object.keys(params||{}).map(function (k) {
      return encodeURIComponent(k)+'='+encodeURIComponent(params[k]);
    }).join('&');
    var url = BASE+'/'+path+'?'+q+'&output=json&key='+encodeURIComponent(getKey());
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 9000);
    return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) {
      if (!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    }).then(function (d) {
      if (d.status !== '1' && d.status !== 1) {
        var err = new Error(d.info || '地图服务返回错误');
        err.code = d.infocode; throw err;
      }
      return d;
    }).finally(function () { clearTimeout(timer); });
  }

  function splitLoc(s) {
    var p = String(s||'').split(',');
    if (p.length < 2) return null;
    var lng = parseFloat(p[0]), lat = parseFloat(p[1]);
    if (!isFinite(lng) || !isFinite(lat)) return null;
    var w = gcj02ToWgs84(lng, lat);   // 高德返回 GCJ02
    return { lng: w[0], lat: w[1], gcjLng: lng, gcjLat: lat };
  }
  function haversine(aLat, aLng, bLat, bLng) {
    var r = PI/180, x = Math.sin((bLat-aLat)*r/2)*Math.sin((bLat-aLat)*r/2) +
      Math.cos(aLat*r)*Math.cos(bLat*r)*Math.sin((bLng-aLng)*r/2)*Math.sin((bLng-aLng)*r/2);
    return 6371000*2*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  }
  function normalize(raw, origin) {
    var loc = splitLoc(raw.location);
    if (!loc) return null;
    var name = raw.name || raw.address || '未命名地点';
    var addr = [raw.cityname, raw.adname, raw.address].filter(Boolean).join(' · ') || raw.pname || '';
    return {
      name: name, address: addr,
      category: raw.typecode ? (raw.type || '地点') : (raw.type || '地点'),
      lat: loc.lat, lng: loc.lng, gcjLat: loc.gcjLat, gcjLng: loc.gcjLng,
      adcode: raw.adcode || '', city: raw.cityname || raw.city || '',
      uid: raw.id || '', tel: raw.tel || '',
      dist: origin ? haversine(origin.lat, origin.lng, loc.lat, loc.lng) : 0,
      demo: false, source: 'amap'
    };
  }

  /* ---------------- 搜索 ---------------- */
  /* 关键词搜索：全国范围，支持地铁站/店铺/小区/景点等任何真实地点 */
  function search(keyword, opt) {
    opt = opt || {};
    if (!hasKey()) return Promise.reject(new Error('NO_KEY'));
    var p = { keywords: keyword, offset: opt.limit || 20, page: opt.page || 1, extensions: 'all' };
    if (opt.city) p.city = opt.city;                       // 城市限定（可选，留空＝全国）
    if (opt.origin) {
      var g = wgs84ToGcj02(opt.origin.lng, opt.origin.lat);
      p.location = g[0].toFixed(6)+','+g[1].toFixed(6);   // 结果按距离排序
      p.sortrule = 'distance';
    }
    return http('place/text', p).then(function (d) {
      var list = (d.pois || []).map(function (x) { return normalize(x, opt.origin); }).filter(Boolean);
      return list.sort(function (a,b) { return a.dist-b.dist; });
    });
  }
  /* 周边搜索：以真实定位为中心 */
  function around(keyword, origin, opt) {
    opt = opt || {};
    if (!hasKey()) return Promise.reject(new Error('NO_KEY'));
    var g = wgs84ToGcj02(origin.lng, origin.lat);
    return http('place/around', {
      location: g[0].toFixed(6)+','+g[1].toFixed(6),
      keywords: keyword || '', radius: opt.radius || 3000,
      offset: opt.limit || 20, page: 1, sortrule: 'distance', extensions: 'all'
    }).then(function (d) {
      return (d.pois||[]).map(function (x) { return normalize(x, origin); }).filter(Boolean);
    });
  }
  /* 输入联想：边输边提示真实地点 */
  function suggest(keyword, opt) {
    opt = opt || {};
    if (!hasKey()) return Promise.reject(new Error('NO_KEY'));
    var p = { keywords: keyword, datatype: 'poi' };
    if (opt.city) p.city = opt.city;
    if (opt.origin) {
      var g = wgs84ToGcj02(opt.origin.lng, opt.origin.lat);
      p.location = g[0].toFixed(6)+','+g[1].toFixed(6);
    }
    return http('assistant/inputtips', p).then(function (d) {
      return (d.tips||[]).map(function (t) {
        var n = normalize(t, opt.origin);
        if (!n) return null;
        n.name = t.name || n.name;
        n.address = [t.district, t.address].filter(function (v,i,a) { return v && a.indexOf(v)===i; }).join(' · ');
        return n;
      }).filter(Boolean);
    });
  }
  /* 地理编码：地址 -> 精确坐标 */
  function geocode(address, city) {
    if (!hasKey()) return Promise.reject(new Error('NO_KEY'));
    var p = { address: address };
    if (city) p.city = city;
    return http('geocode/geo', p).then(function (d) {
      var g = d.geocodes || [];
      if (!g.length) return null;
      var loc = splitLoc(g[0].location);
      if (!loc) return null;
      return { name: address, address: g[0].formatted_address || '', lat: loc.lat, lng: loc.lng,
               gcjLat: loc.gcjLat, gcjLng: loc.gcjLng, demo:false, source:'amap' };
    });
  }
  /* 逆地理编码：坐标 -> 真实地址（用于"我在哪"） */
  function regeo(lat, lng) {
    if (!hasKey()) return Promise.reject(new Error('NO_KEY'));
    var g = wgs84ToGcj02(lng, lat);
    return http('geocode/regeo', { location: g[0].toFixed(6)+','+g[1].toFixed(6), extensions:'base' })
      .then(function (d) {
        var r = d.regeocode || {}, ac = r.addressComponent || {};
        return { formatted: r.formatted_address || '', province: ac.province || '', city: ac.city || ac.province || '',
                 district: ac.district || '', road: (ac.road||[])[0] || '', street: (ac.streetNumber||{}).street || '',
                 adcode: ac.adcode || '', demo:false };
      });
  }
  /* 步行路径规划：真实道路折线 */
  function walking(origin, dest) {
    if (!hasKey()) return Promise.reject(new Error('NO_KEY'));
    var o = wgs84ToGcj02(origin.lng, origin.lat), t = wgs84ToGcj02(dest.lng, dest.lat);
    return http('direction/walking', {
      origin: o[0].toFixed(6)+','+o[1].toFixed(6),
      destination: t[0].toFixed(6)+','+t[1].toFixed(6)
    }).then(function (d) {
      var paths = (d.route && d.route.paths) || [];
      if (!paths.length) return null;
      function coords(steps) {
        var out=[];
        (steps||[]).forEach(function (s) {
          String(s.polyline||'').split(';').forEach(function (pair) {
            var p=pair.split(','); if(p.length<2) return;
            var w=gcj02ToWgs84(parseFloat(p[0]),parseFloat(p[1]));
            out.push([w[1],w[0]]);   // [lat,lng] 供 Leaflet
          });
        });
        return out;
      }
      return { distance: +paths[0].distance||0, duration: +paths[0].duration||0,
               coords: coords(paths[0].steps), steps: paths[0].steps||[], demo:false, source:'amap' };
    });
  }
  /* IP 定位：仅作 GPS 不可用时的粗略城市级兜底，明确标注低精度 */
  function ipCity() {
    if (!hasKey()) return Promise.reject(new Error('NO_KEY'));
    return http('ip', {}).then(function (d) {
      return { province: d.province || '', city: d.city || '', adcode: d.adcode || '', demo:false };
    });
  }

  /* ---------------- 多条真实步行备选路线 ----------------
     高德步行 API 只返回 1 条路径，无法提供"第二条、第三条真实路线"。
     这里用 OSM 步行路网服务（foot profile）取 2 条沿真实道路的备选路线，
     与高德主路线组成 3 个真实选择；每条都带真实转向步骤。
     返回坐标统一 WGS84，格式为 [lat, lng]，与主路线一致。 */
  var OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/';
  function actionText(s) {
    var mod = ((s && s.maneuver) || {}).modifier || '';
    if (mod.indexOf('left') >= 0) return '左转';
    if (mod.indexOf('right') >= 0) return '右转';
    return '直行';
  }
  function roadOf(s) {
    var n = s && s.name;
    if (Array.isArray(n)) n = n.filter(Boolean).join('');
    return String(n == null ? '' : n).trim() || '当前道路';
  }
  function turnText(s) {
    var mv = (s && s.maneuver) || {}, type = mv.type || '', mod = mv.modifier || '';
    var road = roadOf(s);
    var unnamed = road === '当前道路';
    var dir = mod.indexOf('left') >= 0 ? '左转' : mod.indexOf('right') >= 0 ? '右转' : '';
    if (type === 'depart') return unnamed ? '从当前位置出发 · 沿步行道前行' : '从当前位置出发 · 沿' + road + '步行';
    if (type === 'arrive') return '到达目的地附近';
    if (type === 'new name') return unnamed ? '继续沿当前步行道前行' : '继续沿' + road + '前行';
    /* 无名路段不要说「进入当前道路」，直接说转向动作 */
    if (dir) return unnamed ? dir + '继续前行' : dir + '进入' + road;
    return unnamed ? '沿当前步行道直行' : '沿' + road + '前行';
  }
  function parseRoute(rt) {
    var coords = ((rt.geometry && rt.geometry.coordinates) || []).map(function (c) { return [c[1], c[0]]; });
    var steps = [];
    (rt.legs || []).forEach(function (leg) {
      (leg.steps || []).forEach(function (s) {
        steps.push({ instruction: turnText(s), road: roadOf(s),
                     distance: Number(s.distance) || 0, duration: Number(s.duration) || 0,
                     action: actionText(s) });
      });
    });
    return { coords: coords, distance: Number(rt.distance) || 0,
             duration: Number(rt.duration) || 0, steps: steps, source: 'osrm-foot' };
  }
  function routesFrom(d) {
    if (d.code !== 'Ok' || !d.routes || !d.routes.length) return [];
    return d.routes.map(parseRoute).filter(function (r) { return r.coords.length > 1 && r.distance > 0; });
  }
  function fetchOSRM(coordsStr, extra) {
    return fetch(OSRM_FOOT + coordsStr +
      '?overview=full&geometries=geojson&steps=true' + (extra || ''), { mode: 'cors' })
      .then(function (r) { return r.json(); }).then(routesFrom).catch(function () { return []; });
  }
  function walkingAlternatives(origin, dest) {
    var pair = origin.lng.toFixed(6) + ',' + origin.lat.toFixed(6) + ';' +
               dest.lng.toFixed(6) + ',' + dest.lat.toFixed(6);
    return fetchOSRM(pair, '&alternatives=true').then(function (list) {
      if (list.length >= 2) return list;
      /* 少数起终点只返回 1 条备选：用连线侧方的途经点强制生成另一条真实绕行路线
         （仍沿真实道路，OSRM 会自动吸附到最近路网，不会画出凭空直线）。 */
      var mLat = (origin.lat + dest.lat) / 2, mLng = (origin.lng + dest.lng) / 2;
      var dLat = dest.lat - origin.lat, dLng = dest.lng - origin.lng;
      var len = Math.sqrt(dLat*dLat + dLng*dLng) || 0.001;
      var off = Math.min(0.004, Math.max(0.0015, len * 0.35));
      var vLat = mLat + dLng / len * off, vLng = mLng - dLat / len * off;
      var via = origin.lng.toFixed(6) + ',' + origin.lat.toFixed(6) + ';' +
                vLng.toFixed(6) + ',' + vLat.toFixed(6) + ';' +
                dest.lng.toFixed(6) + ',' + dest.lat.toFixed(6);
      return fetchOSRM(via).then(function (extra) {
        return list.concat(extra).slice(0, 2);
      });
    });
  }

  A.Geo = {
    key: getKey(), getKey: getKey, setKey: setKey, clearOverride: clearOverride,
    isBuiltin: isBuiltin, hasKey: hasKey,
    wgs84ToGcj02: wgs84ToGcj02, gcj02ToWgs84: gcj02ToWgs84, haversine: haversine,
    search: search, around: around, suggest: suggest, geocode: geocode,
    regeo: regeo, walking: walking, walkingAlternatives: walkingAlternatives, ipCity: ipCity
  };
})();
