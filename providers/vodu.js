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
      return tryLinks(links, 0, mediaType, season, episode);
    })
    .catch(function() { return searchVODU(titles, idx + 1, mediaType, season, episode); });
}

function tryLinks(links, idx, mediaType, season, episode) {
  if (idx >= links.length) return [];
  return fetch(links[idx])
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var s;
      if (mediaType === "tv" && season && episode) {
        s = extractEpisodeVideos(html, parseInt(season) || 1, parseInt(episode) || 1);
      } else {
        s = extractVideos(html);
      }
      if (s.length > 0) return s;
      return tryLinks(links, idx + 1, mediaType, season, episode);
    })
    .catch(function() { return tryLinks(links, idx + 1, mediaType, season, episode); });
}

function extractEpisodeVideos(html, sNum, eNum) {
  // Get ALL video URLs from page
  var allUrls = getAllVideoUrls(html);

  // Build episode patterns to match in filename
  var sStr = sNum < 10 ? "0" + sNum : "" + sNum;
  var eStr = eNum < 10 ? "0" + eNum : "" + eNum;
  var patterns = [
    "S" + sStr + "E" + eStr,
    "S" + sNum + "E" + eNum,
    "s" + sStr + "e" + eStr,
    "_" + sStr + "x" + eStr,
    "E" + eStr + "_",
    "E" + eStr + "-",
    "E" + eStr + ".",
    "_E" + eNum + "_",
    "_E" + eNum + "-",
    "_E" + eNum + "."
  ];

  var streams = [];
  var seen = {};

  for (var i = 0; i < allUrls.length; i++) {
    var url = allUrls[i];
    var matched = false;
    for (var p = 0; p < patterns.length; p++) {
      if (url.toUpperCase().indexOf(patterns[p].toUpperCase()) > -1) {
        matched = true;
        break;
      }
    }
    if (matched && !seen[url]) {
      if (/-t\.(mp4|m3u8)/i.test(url)) continue;
      if (/_t\.(mp4|m3u8)/i.test(url)) continue;
      if (/thumb|trailer|preview|poster/i.test(url)) continue;
      seen[url] = true;
      var q = getQuality(url);
      streams.push({ name: "VODU", title: "VODU " + q, url: url, quality: q });
    }
  }

  // Add 720p variant if missing
  var has720 = false;
  var baseUrl = null;
  for (var j = 0; j < streams.length; j++) {
    if (streams[j].quality === "720p") has720 = true;
    if (!baseUrl && /-(?:360|1080)\./i.test(streams[j].url)) baseUrl = streams[j].url;
  }
  if (!has720 && baseUrl && html.indexOf("720") > -1) {
    var url720 = baseUrl.replace(/-(?:360|1080)\./i, "-720.");
    streams.push({ name: "VODU", title: "VODU 720p", url: url720, quality: "720p" });
  }

  var order = {"1080p": 0, "720p": 1, "480p": 2, "360p": 3, "HLS": 4, "HD": 5};
  streams.sort(function(a, b) {
    return (order[a.quality] != null ? order[a.quality] : 9) - (order[b.quality] != null ? order[b.quality] : 9);
  });
  return streams;
}

function extractVideos(html) {
  var allUrls = getAllVideoUrls(html);
  var streams = [];
  var seen = {};

  for (var i = 0; i < allUrls.length; i++) {
    var url = allUrls[i];
    if (seen[url]) continue;
    if (/-t\.(mp4|m3u8)/i.test(url)) continue;
    if (/_t\.(mp4|m3u8)/i.test(url)) continue;
    if (/thumb|trailer|preview|poster/i.test(url)) continue;
    seen[url] = true;
    var q = getQuality(url);
    streams.push({ name: "VODU", title: "VODU " + q, url: url, quality: q });
  }

  var has720 = false;
  var baseUrl = null;
  for (var j = 0; j < streams.length; j++) {
    if (streams[j].quality === "720p") has720 = true;
    if (!baseUrl && /-(?:360|1080)\./i.test(streams[j].url)) baseUrl = streams[j].url;
  }
  if (!has720 && baseUrl && html.indexOf("720") > -1) {
    var url720 = baseUrl.replace(/-(?:360|1080)\./i, "-720.");
    streams.push({ name: "VODU", title: "VODU 720p", url: url720, quality: "720p" });
  }

  var order = {"1080p": 0, "720p": 1, "480p": 2, "360p": 3, "HLS": 4, "HD": 5};
  streams.sort(function(a, b) {
    return (order[a.quality] != null ? order[a.quality] : 9) - (order[b.quality] != null ? order[b.quality] : 9);
  });
  return streams;
}

function getAllVideoUrls(html) {
  var urls = [];
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
      if (urls.indexOf(url) === -1) urls.push(url);
    }
  }
  return urls;
}

function getQuality(url) {
  if (/-360\./i.test(url)) return "360p";
  if (/-480\./i.test(url)) return "480p";
  if (/-720\./i.test(url)) return "720p";
  if (/-1080\./i.test(url)) return "1080p";
  if (/\.m3u8/i.test(url)) return "HLS";
  return "HD";
}
module.exports = { getStreams: getStreams };
