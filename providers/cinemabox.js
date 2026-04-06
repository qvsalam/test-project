function getStreams(titles, mediaType, season, episode) {
  if (!titles || titles.length === 0) return Promise.resolve([]);
  return searchCinemaBox(titles, 0, mediaType, season, episode);
}

function searchCinemaBox(titles, idx, mediaType, season, episode) {
  if (idx >= titles.length) return Promise.resolve([]);
  
  var query = encodeURIComponent(titles[idx]);
  var searchUrl = "https://pucinema.albox.co/search?q=" + query;
  
  return fetch(searchUrl)
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var links = [];
      // البحث عن روابط العروض في نتائج البحث
      var showRegex = /href=["'](https:\/\/pucinema\.albox\.co\/show\/\d+)["']/gi;
      var match;
      while ((match = showRegex.exec(html)) !== null) {
        var href = match[1];
        if (links.indexOf(href) === -1) links.push(href);
      }
      
      if (links.length === 0) return searchCinemaBox(titles, idx + 1, mediaType, season, episode);
      return tryLinks(links, 0, mediaType, season, episode);
    })
    .catch(function() { return searchCinemaBox(titles, idx + 1, mediaType, season, episode); });
}

function tryLinks(links, idx, mediaType, season, episode) {
  if (idx >= links.length) return Promise.resolve([]);
  
  return fetch(links[idx])
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var allUrls = getAllVideoUrls(html);
      var streams = [];
      
      if (mediaType === "tv" && season && episode) {
        streams = filterEpisode(allUrls, parseInt(season) || 1, parseInt(episode) || 1, html);
      } else {
        streams = filterMovieUrls(allUrls, html);
      }
      
      if (streams.length > 0) return streams;
      return tryLinks(links, idx + 1, mediaType, season, episode);
    })
    .catch(function() { return tryLinks(links, idx + 1, mediaType, season, episode); });
}

function filterEpisode(allUrls, sNum, eNum, html) {
  var sStr = sNum < 10 ? "0" + sNum : "" + sNum;
  var eStr = eNum < 10 ? "0" + eNum : "" + eNum;
  var pats = [
    "S" + sStr + "E" + eStr,
    "s" + sStr + "e" + eStr,
    "S" + sNum + "E" + eNum,
    "s" + sNum + "e" + eNum,
    "E" + eStr,
    "E" + eNum
  ];
  
  var streams = [];
  var seen = {};
  
  for (var i = 0; i < allUrls.length; i++) {
    var url = allUrls[i];
    if (isSkip(url)) continue;
    
    var upper = url.toUpperCase();
    var matched = false;
    for (var p = 0; p < pats.length; p++) {
      if (upper.indexOf(pats[p].toUpperCase()) > -1) {
        matched = true;
        break;
      }
    }
    
    if (matched && !seen[url]) {
      seen[url] = true;
      streams.push({ 
        name: "CinemaBox", 
        title: "CinemaBox " + getQ(url), 
        url: url, 
        quality: getQ(url) 
      });
    }
  }
  
  sortStreams(streams);
  return streams;
}

function filterMovieUrls(allUrls, html) {
  var streams = [];
  var seen = {};
  for (var i = 0; i < allUrls.length; i++) {
    var url = allUrls[i];
    if (isSkip(url)) continue;
    if (seen[url]) continue;
    seen[url] = true;
    streams.push({ 
      name: "CinemaBox", 
      title: "CinemaBox " + getQ(url), 
      url: url, 
      quality: getQ(url) 
    });
  }
  sortStreams(streams);
  return streams;
}

function getAllVideoUrls(html) {
  var urls = [];
  var m;
  // الأنماط المعتادة لروابط الفيديو في مواقع البث العراقية
  var res = [
    /["'](https?:\/\/[^"'\s]*online\d*\.albox\.co[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*)/gi,
    /["'](https?:\/\/[^"'\s]*storage[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*)/gi,
    /["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8)(?:\?[^"'\s]*)?)/gi
  ];
  
  for (var p = 0; p < res.length; p++) {
    while ((m = res[p].exec(html)) !== null) {
      var u = m[1].replace(/\\\//g, "/").replace(/&amp;/g, "&");
      if (urls.indexOf(u) === -1) urls.push(u);
    }
  }
  return urls;
}

function isSkip(url) {
  if (/thumb|trailer|preview|poster|logo/i.test(url)) return true;
  return false;
}

function getQ(url) {
  if (/1080/i.test(url)) return "1080p";
  if (/720/i.test(url)) return "720p";
  if (/480/i.test(url)) return "480p";
  if (/360/i.test(url)) return "360p";
  if (/\.m3u8/i.test(url)) return "HLS";
  return "HD";
}

function sortStreams(streams) {
  var order = {"1080p": 0, "720p": 1, "480p": 2, "360p": 3, "HLS": 4, "HD": 5};
  streams.sort(function(a, b) {
    return (order[a.quality] != null ? order[a.quality] : 9) - (order[b.quality] != null ? order[b.quality] : 9);
  });
}

module.exports = { getStreams: getStreams };
