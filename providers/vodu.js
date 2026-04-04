function getStreams(tmdbId, mediaType, season, episode) {
  var path = "/" + (mediaType === "movie" ? "movie" : "tv") + "/" + tmdbId;
  var url = "https://api.themoviedb.org/3" + path + "?api_key=ee8ac8a9044c09a11cc362033f98c735&language=en";

  return fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(info) {
      var titles = [];
      if (info.title) titles.push(info.title);
      if (info.original_title && titles.indexOf(info.original_title) === -1) titles.push(info.original_title);
      if (info.name) titles.push(info.name);
      if (info.original_name && titles.indexOf(info.original_name) === -1) titles.push(info.original_name);
      if (titles.length === 0) return [];
      return searchVODU(titles, 0, mediaType, season, episode);
    })
    .catch(function() { return []; });
}

function searchVODU(titles, idx, mediaType, season, episode) {
  if (idx >= titles.length) return [];
  return fetch("https://movie.vodu.me/index.php?do=list&title=" + encodeURIComponent(titles[idx]))
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var links = [];
      var re = /href=["']([^"']*do=view[^"']*)["']/gi;
      var m;
      while ((m = re.exec(html)) !== null) {
        var href = m[1].replace(/&amp;/g, "&");
        if (href.indexOf("http") !== 0) href = "https://movie.vodu.me/" + href.replace(/^\//, "");
        if (links.indexOf(href) === -1) links.push(href);
      }
      if (links.length === 0) return searchVODU(titles, idx + 1, mediaType, season, episode);
      if (mediaType === "tv" && season && episode) return tryEpLinks(links, 0, parseInt(season) || 1, parseInt(episode) || 1);
      return tryLinks(links, 0);
    })
    .catch(function() { return searchVODU(titles, idx + 1, mediaType, season, episode); });
}

function tryLinks(links, idx) {
  if (idx >= links.length) return [];
  return fetch(links[idx])
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var s = extractVideos(html);
      if (s.length > 0) return s;
      return tryLinks(links, idx + 1);
    })
    .catch(function() { return tryLinks(links, idx + 1); });
}

function tryEpLinks(links, idx, sNum, eNum) {
  if (idx >= links.length) return [];
  return fetch(links[idx])
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var epLinks = [];
      var pats = [
        new RegExp("href=[\"']([^\"']*[Ss]0?" + sNum + "[Ee]0?" + eNum + "[^\"']*)[\"']", "gi"),
        new RegExp("href=[\"']([^\"']*season[\\-_]?" + sNum + "[^\"']*episode[\\-_]?" + eNum + "[^\"']*)[\"']", "gi")
      ];
      for (var p = 0; p < pats.length; p++) {
        var m;
        while ((m = pats[p].exec(html)) !== null) {
          var href = m[1].replace(/&amp;/g, "&");
          if (href.indexOf("http") !== 0) href = "https://movie.vodu.me/" + href.replace(/^\//, "");
          if (epLinks.indexOf(href) === -1) epLinks.push(href);
        }
      }
      if (epLinks.length > 0) return tryLinks(epLinks, 0);
      var s = extractVideos(html);
      if (s.length > 0) return s;
      return tryEpLinks(links, idx + 1, sNum, eNum);
    })
    .catch(function() { return tryEpLinks(links, idx + 1, sNum, eNum); });
}

function extractVideos(html) {
  var streams = [];
  var seen = {};

  function addStream(url, q) {
    if (seen[url]) return;
    seen[url] = true;
    streams.push({ name: "VODU", title: "VODU " + q, url: url, quality: q });
  }

  // Find all video URLs
  var rawUrls = [];
  var m;
  var patterns = [
    /["'](https?:\/\/[^"'\s]*:8888\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*)/gi,
    /<(?:source|video)[^>]*src=["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)/gi,
    /(?:file|src|url|videoUrl|source)\s*[:=]\s*["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*)/gi,
    /"(https?:\\\/\\\/[^"]*\.(?:mp4|m3u8)[^"]*)"/g,
    /["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8)(?:\?[^"'\s]*)?)/gi
  ];

  for (var p = 0; p < patterns.length; p++) {
    while ((m = patterns[p].exec(html)) !== null) {
      var url = m[1].replace(/\\\//g, "/").replace(/&amp;/g, "&");
      if (/-t\.(mp4|m3u8)/i.test(url)) continue;
      if (/_t\.(mp4|m3u8)/i.test(url)) continue;
      if (/thumb|trailer|preview|poster/i.test(url)) continue;
      if (rawUrls.indexOf(url) === -1) rawUrls.push(url);
    }
  }

  // Check which qualities the page mentions (via qsublabel classes)
  var pageHas360 = html.indexOf("360") > -1;
  var pageHas480 = html.indexOf("480") > -1;
  var pageHas720 = html.indexOf("720") > -1;
  var pageHas1080 = html.indexOf("1080") > -1;

  // Add found URLs and generate missing quality variants
  for (var i = 0; i < rawUrls.length; i++) {
    var url = rawUrls[i];
    var match = url.match(/(-)(360|480|720|1080)(\.mp4)/i);

    if (match) {
      // Add this URL with correct quality
      addStream(url, match[2] + "p");

      // Generate variants for qualities mentioned on the page
      if (pageHas360) addStream(url.replace(match[0], match[1] + "360" + match[3]), "360p");
      if (pageHas480) addStream(url.replace(match[0], match[1] + "480" + match[3]), "480p");
      if (pageHas720) addStream(url.replace(match[0], match[1] + "720" + match[3]), "720p");
      if (pageHas1080) addStream(url.replace(match[0], match[1] + "1080" + match[3]), "1080p");
    } else {
      var q = "HD";
      if (/\.m3u8/i.test(url)) q = "HLS";
      addStream(url, q);
    }
  }

  var order = {"1080p": 0, "720p": 1, "480p": 2, "360p": 3, "HLS": 4, "HD": 5};
  streams.sort(function(a, b) {
    return (order[a.quality] != null ? order[a.quality] : 9) - (order[b.quality] != null ? order[b.quality] : 9);
  });
  return streams;
}
module.exports = { getStreams: getStreams };
