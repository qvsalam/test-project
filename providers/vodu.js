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
      if (mediaType === "tv" && season && episode) {
        return findEpisode(links, parseInt(season) || 1, parseInt(episode) || 1);
      }
      return tryLinks(links, 0);
    })
    .catch(function() { return searchVODU(titles, idx + 1, mediaType, season, episode); });
}

function findEpisode(searchLinks, sNum, eNum) {
  // Each search result is a season/series page
  // Try each one to find episode links inside
  return trySeriesPages(searchLinks, 0, sNum, eNum);
}

function trySeriesPages(pages, idx, sNum, eNum) {
  if (idx >= pages.length) return [];

  return fetch(pages[idx])
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // Get all episode links from this series page
      var epLinks = [];
      var re = /href=["']([^"']*do=view[^"']*)["']/gi;
      var m;
      while ((m = re.exec(html)) !== null) {
        var href = m[1].replace(/&amp;/g, "&");
        if (href.indexOf("http") !== 0) href = "https://movie.vodu.me/" + href.replace(/^\//, "");
        if (epLinks.indexOf(href) === -1) epLinks.push(href);
      }

      if (epLinks.length === 0) {
        // This page has no sub-links, maybe it IS an episode
        var streams = extractVideos(html);
        if (streams.length > 0) return streams;
        return trySeriesPages(pages, idx + 1, sNum, eNum);
      }

      // Episodes are listed in order - pick by episode number
      // Episode 1 = first link, Episode 2 = second link, etc.
      var epIndex = eNum - 1;

      if (epIndex >= 0 && epIndex < epLinks.length) {
        // Found the episode link, extract videos from it
        return fetch(epLinks[epIndex])
          .then(function(r2) { return r2.text(); })
          .then(function(epHtml) {
            var streams = extractVideos(epHtml);
            if (streams.length > 0) return streams;
            // If no streams, try next series page
            return trySeriesPages(pages, idx + 1, sNum, eNum);
          })
          .catch(function() {
            return trySeriesPages(pages, idx + 1, sNum, eNum);
          });
      }

      // Episode number out of range, try next series page (maybe different season)
      return trySeriesPages(pages, idx + 1, sNum, eNum);
    })
    .catch(function() {
      return trySeriesPages(pages, idx + 1, sNum, eNum);
    });
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

function extractVideos(html) {
  var streams = [];
  var seen = {};

  function add(url) {
    url = url.replace(/\\\//g, "/").replace(/&amp;/g, "&");
    if (seen[url]) return;
    if (/-t\.(mp4|m3u8)/i.test(url)) return;
    if (/_t\.(mp4|m3u8)/i.test(url)) return;
    if (/thumb|trailer|preview|poster/i.test(url)) return;
    seen[url] = true;
    var q = "HD";
    if (/-360\./i.test(url)) q = "360p";
    else if (/-480\./i.test(url)) q = "480p";
    else if (/-720\./i.test(url)) q = "720p";
    else if (/-1080\./i.test(url)) q = "1080p";
    else if (/\.m3u8/i.test(url)) q = "HLS";
    streams.push({ name: "VODU", title: "VODU " + q, url: url, quality: q });
  }

  var m;
  var patterns = [
    /["'](https?:\/\/[^"'\s]*:8888\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*)/gi,
    /<(?:source|video)[^>]*src=["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)/gi,
    /(?:file|src|url|videoUrl|source)\s*[:=]\s*["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*)/gi,
    /"(https?:\\\/\\\/[^"]*\.(?:mp4|m3u8)[^"]*)"/g,
    /["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8)(?:\?[^"'\s]*)?)/gi
  ];

  for (var p = 0; p < patterns.length; p++) {
    while ((m = patterns[p].exec(html)) !== null) add(m[1]);
  }

  // Add 720p variant if page mentions 720 but no 720p stream found
  var has720 = false;
  var baseUrl = null;
  for (var i = 0; i < streams.length; i++) {
    if (streams[i].quality === "720p") has720 = true;
    if (!baseUrl && /-(?:360|1080)\./i.test(streams[i].url)) baseUrl = streams[i].url;
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
module.exports = { getStreams: getStreams };
