/* =========================================================
   安星 · 免 Key 真实地理源（百度地图网页版公开检索，JSONP）
   未配置高德 Key 时仍能搜到全中国真实 POI（地铁站/店铺/小区/景点…）。
   坐标由墨卡托值 + 全国地标标定换算为 WGS84，精度约数百米（原型演示级），
   结果标注 approx:true，不冒充米级精度；配置 Key 后自动切换为高德官方米级数据。
   ========================================================= */
(function () {
  var A = window.XA = window.XA || {};
  var SU = 'https://map.baidu.com/su';
  var QS = 'https://map.baidu.com/';
  var CITY = { '北京':131,'上海':289,'广州':257,'深圳':340,'成都':75,'天津':332,'武汉':218,
               '杭州':179,'南京':315,'重庆':132,'西安':233,'苏州':224,'郑州':268,'长沙':158,
               '青岛':236,'沈阳':58,'大连':67,'厦门':194,'昆明':104,'合肥':127,'济南':288,
               '福州':300,'南昌':163,'贵阳':146,'南宁':261,'石家庄':150,'哈尔滨':49 };

  /* 百度接口用 callback 参数支持 JSONP，可绕过 CORS */
  function jsonp(url) {
    return new Promise(function (resolve, reject) {
      var name = '__xaGeo'+Date.now()+Math.floor(Math.random()*100000);
      var s = document.createElement('script');
      var timer = setTimeout(function () { cleanup(); reject(new Error('TIMEOUT')); }, 8000);
      function cleanup() {
        clearTimeout(timer);
        try { delete window[name]; } catch (e) { window[name] = undefined; }
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      window[name] = function (d) { cleanup(); resolve(d); };
      s.src = url + (url.indexOf('?')>=0?'&':'?') + 'callback=' + name;
      s.onerror = function () { cleanup(); reject(new Error('NETWORK')); };
      document.head.appendChild(s);
    });
  }
  function haversine(aLat,aLng,bLat,bLng) {
    var r=Math.PI/180, x=Math.sin((bLat-aLat)*r/2)*Math.sin((bLat-aLat)*r/2)+
      Math.cos(aLat*r)*Math.cos(bLat*r)*Math.sin((bLng-aLng)*r/2)*Math.sin((bLng-aLng)*r/2);
    return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  }
  /* 百度墨卡托 -> WGS84：全国 7 个地标与 OSM WGS84 标定得到的常量修正 */
  function mercToWgs(mx, my) {
    var lng0 = mx/111319.49077777777;
    var lat0 = (2*Math.atan(Math.exp(my/6378137.0)) - Math.PI/2)*180/Math.PI;
    return { lng: lng0 - 0.012431, lat: lat0 + 0.00240750*lat0 + 0.089431 };
  }
  function guessCity(q) {
    for (var k in CITY) if (String(q||'').indexOf(k)>=0) return CITY[k];
    return 0;
  }
  /* 输入联想：免 Key，全中国真实地名（无坐标，仅供提示） */
  function suggest(q, opt) {
    opt=opt||{};
    var cid = opt.cid || guessCity(q);
    var url = SU+'?wd='+encodeURIComponent(q)+'&type=0&pc_ver=2&ie=utf-8'+(cid?'&cid='+cid:'');
    return jsonp(url).then(function (d) {
      var out=[];
      (d && d.s ? d.s : []).forEach(function (s) {
        var f=String(s).split('$');
        if (f.length<4 || !f[3]) return;
        out.push({ name:f[3], address:[f[0],f[1]].filter(Boolean).join(' · '),
                   city:f[0]||'', district:f[1]||'', uid:f[5]||'',
                   q:f[3], label:f[3], sub:[f[1],f[0]].filter(Boolean).join(' · ')||'真实地点',
                   demo:false, approx:true, source:'baidu', noCoord:true });
      });
      return out.slice(0,10);
    }).catch(function(){ return []; });
  }
  /* 主检索：全中国真实 POI + 墨卡托精确坐标（JSONP 拿数据） */
  function search(q, opt) {
    opt=opt||{};
    var cid = opt.cid || guessCity(q);
    var url = QS+'?qt=s&wd='+encodeURIComponent(q)+'&c='+(cid||218)+'&pn=0&nn=0&ie=utf-8';
    return jsonp(url).then(function (j) {
      var c = j && j.content ? j.content : [];
      var origin = opt.origin || null;
      var list = c.map(function (it) {
        var mx=(it.x||it.diPointX||0)/100, my=(it.y||it.diPointY||0)/100;
        if (!mx || !my) return null;
        var w = mercToWgs(mx,my);
        return { name: it.name||q, address: it.addr||it.area_name||'', category: it.std_tag||'真实地点',
                 lat:w.lat, lng:w.lng, dist: origin?haversine(origin.lat,origin.lng,w.lat,w.lng):0,
                 uid: it.uid||'', demo:false, approx:true, source:'baidu' };
      }).filter(Boolean);
      if (origin) list.sort(function(a,b){ return a.dist-b.dist; });
      return list;
    }).catch(function(){ return []; });
  }
  /* 单条联想项补全坐标：用名称再检索一次 */
  function resolve(item, origin) {
    if (!item) return Promise.resolve(null);
    if (item.lat) return Promise.resolve(item);
    return search(item.name||item.q, { origin:origin }).then(function (l) { return l[0] || null; });
  }

  A.GeoFallback = { suggest:suggest, search:search, resolve:resolve,
                     mercToWgs:mercToWgs, guessCity:guessCity, CITY:CITY };
})();
