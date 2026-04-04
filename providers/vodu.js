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
  var allQualities = ["360", "480", "720", "1080"];

  function add(url, q) {
    url = url.replace(/\\\//g, "/").replace(/&amp;/g, "&");
    if (seen[url]) return;
    if (/-t\.(mp4|m3u8)/i.test(url)) return;
    if (/_t\.(mp4|m3u8)/i.test(url)) return;
    if (/thumb|trailer|preview|poster/i.test(url)) return;
    seen[url] = true;
    if (!q) {
      if (/-360\./i.test(url)) q = "360p";
      else if (/-480\./i.test(url)) q = "480p";
      else if (/-720\./i.test(url)) q = "720p";
      else if (/-1080\./i.test(url)) q = "1080p";
      else if (/\.m3u8/i.test(url)) q = "HLS";
      else q = "HD";
    }
    streams.push({ name: "VODU", title: "VODU " + q, url: url, quality: q });
  }

  // Generate all quality variants from a URL
  function addWithVariants(url) {
    add(url);
    // If URL has -360, -480, -720, or -1080, generate other qualities
    var match = url.match(/(-)(360|480|720|1080)(\.mp4)/i);
    if (match) {
      for (var i = 0; i < allQualities.length; i++) {
        var variant = url.replace(match[0], match[1] + allQualities[i] + match[3]);
        add(variant, allQualities[i] + "p");
      }
    }
  }

  var m;
  var v1 = /["'](https?:\/\/[^"'\s]*:8888\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*)/gi;
  while ((m = v1.exec(html)) !== null) addWithVariants(m[1]);
  var v2 = /<(?:source|video)[^>]*src=["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)/gi;
  while ((m = v2.exec(html)) !== null) addWithVariants(m[1]);
  var v3 = /(?:file|src|url|videoUrl|source)\s*[:=]\s*["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*)/gi;
  while ((m = v3.exec(html)) !== null) addWithVariants(m[1]);
  var v4 = /"(https?:\\\/\\\/[^"]*\.(?:mp4|m3u8)[^"]*)"/g;
  while ((m = v4.exec(html)) !== null) addWithVariants(m[1]);
  var v5 = /["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8)(?:\?[^"'\s]*)?)/gi;
  while ((m = v5.exec(html)) !== null) addWithVariants(m[1]);

  var order = {"1080p": 0, "720p": 1, "480p": 2, "360p": 3, "HLS": 4, "HD": 5};
  streams.sort(function(a, b) {
    return (order[a.quality] != null ? order[a.quality] : 9) - (order[b.quality] != null ? order[b.quality] : 9);
  });
  return streams;
}
module.exports = { getStreams: getStreams };
