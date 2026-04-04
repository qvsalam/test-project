// VODU Iraq Provider for Nuvio v1.3.0
// Works only on Iraqi ISP networks

var VODU = "https://movie.vodu.me";
var TMDB = "https://api.themoviedb.org/3";
var KEY = "258f9e3b7fae26a1b295cb13e0689b73";

function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[VODU] Start: tmdbId=" + tmdbId + " type=" + mediaType);

  var tmdbUrl = TMDB + "/" + (mediaType === "movie" ? "movie" : "tv") + "/" + tmdbId + "?api_key=" + KEY + "&language=en";

  return fetch(tmdbUrl)
    .then(function(r) { return r.json(); })
    .then(function(info) {
      var title = info.title || info.name || info.original_title || info.original_name || "";
      var year = (info.release_date || info.first_air_date || "").substring(0, 4);
      console.log("[VODU] Title: " + title + " Year: " + year);

      if (!title) {
        console.log("[VODU] No title from TMDB");
        return [];
      }

      var searchUrl = VODU + "/index.php?do=list&title=" + encodeURIComponent(title);
      console.log("[VODU] Search: " + searchUrl);

      return fetch(searchUrl)
        .then(function(r) { return r.text(); })
        .then(function(html) {
          var links = [];
          var re = /href=["']([^"']*do=view[^"']*)["']/gi;
          var m;
          while ((m = re.exec(html)) !== null) {
            var href = m[1].replace(/&amp;/g, "&");
            if (href.indexOf("http") !== 0) {
              href = VODU + "/" + href.replace(/^\//, "");
            }
            if (links.indexOf(href) === -1) {
              links.push(href);
            }
          }

          console.log("[VODU] Found " + links.length + " links on search page");

          if (links.length === 0) {
            return tryArabicSearch(tmdbId, mediaType, season, episode);
          }

          if (mediaType === "tv" && season && episode) {
            return findEpisodeStreams(links, season, episode);
          }

          return tryLinks(links, 0);
        });
    })
    .catch(function(err) {
      console.error("[VODU] Error: " + err.message);
      return [];
    });
}

function tryArabicSearch(tmdbId, mediaType, season, episode) {
  var tmdbUrl = TMDB + "/" + (mediaType === "movie" ? "movie" : "tv") + "/" + tmdbId + "?api_key=" + KEY + "&language=ar";

  return fetch(tmdbUrl)
    .then(function(r) { return r.json(); })
    .then(function(info) {
      var title = info.title || info.name || "";
      if (!title) return [];

      console.log("[VODU] Arabic search: " + title);
      var searchUrl = VODU + "/index.php?do=list&title=" + encodeURIComponent(title);

      return fetch(searchUrl)
        .then(function(r) { return r.text(); })
        .then(function(html) {
          var links = [];
          var re = /href=["']([^"']*do=view[^"']*)["']/gi;
          var m;
          while ((m = re.exec(html)) !== null) {
            var href = m[1].replace(/&amp;/g, "&");
            if (href.indexOf("http") !== 0) {
              href = VODU + "/" + href.replace(/^\//, "");
            }
            if (links.indexOf(href) === -1) {
              links.push(href);
            }
          }

          console.log("[VODU] Arabic found " + links.length + " links");

          if (mediaType === "tv" && season && episode) {
            return findEpisodeStreams(links, season, episode);
          }

          return tryLinks(links, 0);
        });
    })
    .catch(function(err) {
      console.error("[VODU] Arabic error: " + err.message);
      return [];
    });
}

function tryLinks(links, idx) {
  if (idx >= links.length) {
    console.log("[VODU] No streams in any link");
    return [];
  }

  console.log("[VODU] Trying link " + (idx + 1) + ": " + links[idx]);

  return fetch(links[idx])
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var streams = extractVideos(html);
      if (streams.length > 0) {
        console.log("[VODU] Got " + streams.length + " streams!");
        return streams;
      }
      return tryLinks(links, idx + 1);
    })
    .catch(function() {
      return tryLinks(links, idx + 1);
    });
}

function findEpisodeStreams(links, season, episode) {
  var sNum = parseInt(season) || 1;
  var eNum = parseInt(episode) || 1;
  console.log("[VODU] Looking for S" + sNum + "E" + eNum);
  return tryEpLinks(links, 0, sNum, eNum);
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
          if (href.indexOf("http") !== 0) {
            href = VODU + "/" + href.replace(/^\//, "");
          }
          if (epLinks.indexOf(href) === -1) {
            epLinks.push(href);
          }
        }
      }

      if (epLinks.length > 0) {
        return tryLinks(epLinks, 0);
      }

      var streams = extractVideos(html);
      if (streams.length > 0) return streams;

      return tryEpLinks(links, idx + 1, sNum, eNum);
    })
    .catch(function() {
      return tryEpLinks(links, idx + 1, sNum, eNum);
    });
}

function extractVideos(html) {
  var streams = [];
  var seen = {};

  function add(url, quality) {
    url = url.replace(/\\\//g, "/").replace(/&amp;/g, "&");
    if (seen[url]) return;
    if (/thumb|trailer|preview|poster|_t\./i.test(url)) return;
    seen[url] = true;
    if (!quality) quality = guessQ(url);
    streams.push({
      name: "VODU",
      title: "VODU " + quality,
      url: url,
      quality: quality
    });
  }

  var m;

  // 1. Port 8888 URLs (VODU video server)
  var v1 = /["'](https?:\/\/[^"'\s]*:8888\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*)/gi;
  while ((m = v1.exec(html)) !== null) { add(m[1]); }

  // 2. source/video tags
  var v2 = /<(?:source|video)[^>]*src=["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)/gi;
  while ((m = v2.exec(html)) !== null) { add(m[1]); }

  // 3. JS file/src/url assignments
  var v3 = /(?:file|src|url|videoUrl|source)\s*[:=]\s*["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*)/gi;
  while ((m = v3.exec(html)) !== null) { add(m[1]); }

  // 4. JSON escaped
  var v4 = /"(https?:\\\/\\\/[^"]*\.(?:mp4|m3u8)[^"]*)"/g;
  while ((m = v4.exec(html)) !== null) { add(m[1]); }

  // 5. Generic video URLs
  var v5 = /["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8)(?:\?[^"'\s]*)?)/gi;
  while ((m = v5.exec(html)) !== null) { add(m[1]); }

  // 6. Any :8888 URL
  var v6 = /["'](https?:\/\/[^"'\s]*:8888[^"'\s]+)/gi;
  while ((m = v6.exec(html)) !== null) {
    if (/\.(mp4|m3u8|mkv)/i.test(m[1])) { add(m[1]); }
  }

  // Sort by quality
  var order = {"1080p": 0, "720p": 1, "480p": 2, "360p": 3, "HLS": 4, "HD": 5};
  streams.sort(function(a, b) {
    var oa = order[a.quality] != null ? order[a.quality] : 9;
    var ob = order[b.quality] != null ? order[b.quality] : 9;
    return oa - ob;
  });

  return streams;
}

function guessQ(url) {
  if (/1080/i.test(url)) return "1080p";
  if (/720/i.test(url)) return "720p";
  if (/480/i.test(url)) return "480p";
  if (/360/i.test(url)) return "360p";
  if (/\.m3u8/i.test(url)) return "HLS";
  return "HD";
}

module.exports = { getStreams: getStreams };
