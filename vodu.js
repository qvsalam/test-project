/**
 * VODU Scraper for Nuvio - v1.1.0
 * ⚠️ يعمل فقط على شبكة ISP العراقية
 *
 * Fixed: Converted async/await → Promise chains (Hermes JS engine compatibility)
 */

var VODU_BASE  = 'http://movie.vodu.me';
var TMDB_BASE  = 'https://api.themoviedb.org/3';
var DEFAULT_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36';

// ─── Entry Point ──────────────────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[VODU] Starting: tmdbId=' + tmdbId + ' type=' + mediaType + ' s=' + season + ' e=' + episode);

  return getTMDBInfo(tmdbId, mediaType)
    .then(function(info) {
      if (!info || !info.title) {
        console.warn('[VODU] TMDB lookup failed');
        return [];
      }
      console.log('[VODU] Title: ' + info.title + ' (' + info.year + ')');
      return searchVodu(info.title)
        .then(function(results) {
          if (results.length === 0 && info.originalTitle && info.originalTitle !== info.title) {
            console.log('[VODU] Retrying with original title: ' + info.originalTitle);
            return searchVodu(info.originalTitle);
          }
          return results;
        })
        .then(function(results) {
          if (results.length === 0) {
            var shortTitle = info.title.split(' ').slice(0, 3).join(' ');
            if (shortTitle !== info.title) {
              console.log('[VODU] Retrying with short title: ' + shortTitle);
              return searchVodu(shortTitle);
            }
          }
          return results;
        })
        .then(function(results) {
          console.log('[VODU] Found ' + results.length + ' results');
          if (results.length === 0) return [];

          var match = findBestMatch(results, info.title, info.year);
          if (!match) {
            console.warn('[VODU] No match found. Trying first result...');
            match = results[0];
          }
          console.log('[VODU] Match: "' + match.title + '" id=' + match.id);

          if (mediaType === 'tv' && season != null && episode != null) {
            return getTVStreams(match.id, season, episode, match.title);
          }
          return getMovieStreams(match.id, match.title);
        });
    })
    .catch(function(err) {
      console.error('[VODU] Fatal error: ' + err.message);
      return [];
    });
}

// ─── TMDB Info ────────────────────────────────────────────────────────────────
function getTMDBInfo(tmdbId, mediaType) {
  var endpoint = mediaType === 'tv' ? 'tv' : 'movie';
  var url = TMDB_BASE + '/' + endpoint + '/' + tmdbId + '?api_key=' + TMDB_API_KEY + '&language=en-US';

  return axios.get(url, { timeout: 12000 })
    .then(function(res) {
      var d = res.data;
      return {
        title:         d.title         || d.name         || '',
        originalTitle: d.original_title || d.original_name || '',
        year:          ((d.release_date || d.first_air_date || '').split('-')[0]) || ''
      };
    })
    .catch(function(e) {
      console.error('[VODU] TMDB error: ' + e.message);
      return null;
    });
}

// ─── VODU Search ──────────────────────────────────────────────────────────────
function searchVodu(title) {
  var url = VODU_BASE + '/index.php?do=list&title=' + encodeURIComponent(title);
  console.log('[VODU] Searching: ' + url);

  return axios.get(url, {
    timeout: 25000,
    headers: {
      'User-Agent': DEFAULT_UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ar,en;q=0.9'
    }
  })
  .then(function(res) {
    return parseSearchResults(res.data);
  })
  .catch(function(e) {
    console.error('[VODU] Search failed: ' + e.message);
    return [];
  });
}

function parseSearchResults(html) {
  var results = [];
  var seen    = {};

  // Pattern: href="...?do=view&type=post&id=XXXXX"
  // متوافق مع &amp; كذلك
  var linkPattern = /href="[^"]*do=view[^"]*(?:type=post|type%3Dpost)[^"]*id=(\d+)[^"]*"/g;
  var titlePattern = /class="mytitle"[^>]*>[\s\S]*?<a[^>]*id=(\d+)[^>]*>([^<]+)<\/a>/g;
  var altPattern   = /class="alttitle"[^>]*>\s*([^<]*)\s*<\/div>/g;

  var m;

  // أولاً: استخرج بواسطة mytitle
  while ((m = titlePattern.exec(html)) !== null) {
    var id = m[1];
    var title = decodeHTML(m[2].trim());
    if (!id || !title || seen[id]) continue;
    seen[id] = true;
    results.push({ id: id, title: title, altTitle: '' });
  }

  // جمع الـ altTitles
  var alts = [];
  while ((m = altPattern.exec(html)) !== null) {
    alts.push(decodeHTML(m[1].trim()));
  }
  for (var i = 0; i < results.length && i < alts.length; i++) {
    results[i].altTitle = alts[i];
  }

  // Fallback: مسح عام للروابط
  if (results.length === 0) {
    while ((m = linkPattern.exec(html)) !== null) {
      var pid = m[1];
      if (!pid || seen[pid]) continue;
      seen[pid] = true;
      results.push({ id: pid, title: 'Post ' + pid, altTitle: '' });
    }
  }

  return results;
}

function decodeHTML(str) {
  return (str || '')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// ─── Best Match ───────────────────────────────────────────────────────────────
function findBestMatch(results, targetTitle, year) {
  function norm(s) {
    return (s || '').toLowerCase()
      .replace(/[:'!?.,\-–]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var normTarget = norm(targetTitle);

  var scored = results.map(function(r) {
    var normR   = norm(r.title);
    var normAlt = norm(r.altTitle || '');
    var score   = 0;

    if (normR === normTarget || normAlt === normTarget)                       score = 100;
    else if (normR.indexOf(normTarget) === 0 || normAlt.indexOf(normTarget) === 0) score = 85;
    else if (normTarget.indexOf(normR)  === 0)                                score = 75;
    else if (normR.indexOf(normTarget) >= 0 || normAlt.indexOf(normTarget) >= 0) score = 65;
    else if (normTarget.indexOf(normR)  >= 0)                                 score = 50;
    else {
      var targetWords = normTarget.split(' ').filter(function(w) { return w.length > 2; });
      var rWords = (normR + ' ' + normAlt).split(' ');
      var rSet = {};
      rWords.forEach(function(w) { rSet[w] = true; });
      var overlap = targetWords.filter(function(w) { return rSet[w]; }).length;
      score = Math.round((overlap / (targetWords.length || 1)) * 50);
    }

    if (year && (r.title.indexOf(year) >= 0 || (r.altTitle && r.altTitle.indexOf(year) >= 0))) {
      score += 5;
    }

    return { id: r.id, title: r.title, altTitle: r.altTitle, score: score };
  });

  scored.sort(function(a, b) { return b.score - a.score; });
  return (scored[0] && scored[0].score >= 40) ? scored[0] : null;
}

// ─── Movie Streams ────────────────────────────────────────────────────────────
function getMovieStreams(postId, displayTitle) {
  var url = VODU_BASE + '/index.php?do=view&type=post&id=' + postId;
  console.log('[VODU] Fetching movie page: ' + url);

  return axios.get(url, {
    timeout: 25000,
    headers: { 'User-Agent': DEFAULT_UA }
  })
  .then(function(res) {
    var streams = extractVideoUrls(res.data, displayTitle);
    console.log('[VODU] Found ' + streams.length + ' stream(s)');
    return streams;
  })
  .catch(function(e) {
    console.error('[VODU] Movie page error: ' + e.message);
    return [];
  });
}

// ─── TV Streams ───────────────────────────────────────────────────────────────
function getTVStreams(seriesId, season, episode, seriesTitle) {
  var epLabel = 'S' + pad(season) + 'E' + pad(episode);
  var seriesUrl = VODU_BASE + '/index.php?do=view&type=post&id=' + seriesId;

  return axios.get(seriesUrl, {
    timeout: 25000,
    headers: { 'User-Agent': DEFAULT_UA }
  })
  .then(function(res) {
    var html = res.data;

    // محاولة 1: ابحث عن رابط الحلقة المحدد
    var epPageId = findEpisodePageId(html, season, episode);
    if (epPageId) {
      console.log('[VODU] Found episode page id=' + epPageId);
      var epUrl = VODU_BASE + '/index.php?do=view&type=post&id=' + epPageId;
      return axios.get(epUrl, {
        timeout: 25000,
        headers: { 'User-Agent': DEFAULT_UA }
      })
      .then(function(epRes) {
        var streams = extractVideoUrls(epRes.data, seriesTitle + ' ' + epLabel);
        if (streams.length > 0) return streams;
        // Fallback على الصفحة الرئيسية للمسلسل
        return extractVideoUrls(html, seriesTitle + ' ' + epLabel);
      });
    }

    // محاولة 2: streams مباشرة من صفحة المسلسل
    var directStreams = extractVideoUrls(html, seriesTitle + ' ' + epLabel);
    if (directStreams.length > 0) return directStreams;

    // محاولة 3: بحث خاص بالحلقة
    return searchVodu(seriesTitle + ' ' + epLabel)
      .then(function(epResults) {
        if (epResults.length > 0) {
          return getMovieStreams(epResults[0].id, seriesTitle + ' ' + epLabel);
        }
        console.warn('[VODU] No streams for ' + epLabel);
        return [];
      });
  })
  .catch(function(e) {
    console.error('[VODU] TV streams error: ' + e.message);
    return [];
  });
}

function pad(n) {
  return String(n).length < 2 ? '0' + String(n) : String(n);
}

function findEpisodePageId(html, season, episode) {
  var s2 = pad(season), e2 = pad(episode);
  var patterns = [
    new RegExp('s' + s2 + 'e' + e2, 'i'),
    new RegExp('s' + season + 'e' + episode + '[^\\d]', 'i'),
    new RegExp('season\\s*' + season + '[^\\d]*episode\\s*' + episode, 'i'),
    new RegExp('الموسم\\s*' + season + '[\\s\\S]{0,50}حلقة\\s*' + episode, 'i'),
    new RegExp('حلقة\\s*' + episode, 'i')
  ];

  var anchorRe = /<a\s[^>]*href="[^"]*id=(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = anchorRe.exec(html)) !== null) {
    var id   = m[1];
    var text = m[2].replace(/<[^>]+>/g, ' ').trim();
    for (var p = 0; p < patterns.length; p++) {
      if (patterns[p].test(text) || patterns[p].test(m[0])) return id;
    }
  }
  return null;
}

// ─── Video URL Extractor ──────────────────────────────────────────────────────
function extractVideoUrls(html, displayTitle) {
  var streams = [];
  var seen    = {};
  var label   = displayTitle || 'VODU';

  function qualityFromUrl(url) {
    if (/[_\-]t\.(mp4|m3u8)/i.test(url))   return null; // thumbnail
    if (/thumb|trailer|preview/i.test(url)) return null;
    if (/1080/i.test(url))  return '1080p';
    if (/720/i.test(url))   return '720p';
    if (/480/i.test(url))   return '480p';
    if (/360/i.test(url))   return '360p';
    if (/\.m3u8/i.test(url)) return 'HLS';
    return 'HD';
  }

  function addStream(rawUrl, qualityOverride) {
    var url = (rawUrl || '')
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/')
      .replace(/\\/g, '')
      .trim();
    if (!url || seen[url]) return;
    var q = qualityOverride || qualityFromUrl(url);
    if (!q) return;
    seen[url] = true;
    streams.push({
      name:    'VODU',
      title:   label + ' | ' + q,
      url:     url,
      quality: q
    });
  }

  var m;

  // ── 1. روابط MP4 المباشرة من سيرفرات VODU
  var mp4Re = /https?:\/\/(?:movie\.)?vodu\.me(?::\d+)?\/videos?\/[^\s"'\\)>\]]+\.mp4(?:[^\s"'\\)>\]]*)?/gi;
  while ((m = mp4Re.exec(html)) !== null) { addStream(m[0]); }

  // ── 2. سيرفرات بديلة (int.vodu.me / isp.vodu.me)
  var altRe = /https?:\/\/(?:int|isp)\.vodu\.me(?::\d+)?\/[^\s"'\\)>\]]+\.mp4(?:[^\s"'\\)>\]]*)?/gi;
  while ((m = altRe.exec(html)) !== null) { addStream(m[0]); }

  // ── 3. HLS/M3U8 من سيرفرات VODU
  var hlsRe = /https?:\/\/[^\s"'>\]]*vodu[^\s"'>\]]*\.m3u8(?:[^\s"'>\]]*)?/gi;
  while ((m = hlsRe.exec(html)) !== null) { addStream(m[0], 'HLS'); }

  // ── 4. متغيرات JS (VideoJS / JW Player)
  var jsRe = /(?:file|src|url|videoUrl|tvVideoUrl|source)\s*[:=]\s*["'`](https?:\/\/[^"'`\s]+\.(?:mp4|m3u8)[^"'`\s]*)/gi;
  while ((m = jsRe.exec(html)) !== null) { addStream(m[1]); }

  // ── 5. JSON (escaped slashes)
  var jsonRe = /"(https?:\\\/\\\/[^"]+\.(?:mp4|m3u8)[^"]*)"/g;
  while ((m = jsonRe.exec(html)) !== null) { addStream(m[1]); }

  // ── 6. أي رابط بصيغة data-src أو data-url
  var dataRe = /data-(?:src|url|file)\s*=\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)/gi;
  while ((m = dataRe.exec(html)) !== null) { addStream(m[1]); }

  // ترتيب حسب الجودة
  var order = { '1080p': 0, '720p': 1, '480p': 2, '360p': 3, 'HLS': 4, 'HD': 5 };
  streams.sort(function(a, b) {
    return (order[a.quality] != null ? order[a.quality] : 9) -
           (order[b.quality] != null ? order[b.quality] : 9);
  });

  console.log('[VODU] Extracted ' + streams.length + ' stream(s)');
  return streams;
}

// ─── Export ───────────────────────────────────────────────────────────────────
module.exports = { getStreams: getStreams };
