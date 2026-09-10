<?php
// Отдаёт index.html / play.html, подставляя Open Graph и schema.org из data/data.json,
// чтобы Telegram, WhatsApp и Яндекс видели название, описание и постер без JavaScript.
declare(strict_types=1);
function rat_render(string $file, ?string $playId = null): void {
  $root = __DIR__;
  $html = (string)file_get_contents($root . '/' . $file);
  $d = json_decode((string)@file_get_contents($root . '/data/data.json'), true) ?: [];
  $th = $d['theatre'] ?? [];
  $plays = array_values(array_filter($d['plays'] ?? [], fn($p) => empty($p['hidden'])));
  $vis = []; foreach ($plays as $p) $vis[$p['id']] = true;
  $events = array_values(array_filter($d['events'] ?? [], fn($ev) => empty($ev['hidden']) && (empty($ev['playId']) || isset($vis[$ev['playId']]))));
  $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
  $base = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/') . '/';
  $e = fn($v) => htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
  $name = $th['name'] ?: 'Театр RAT';
  $play = null;
  if ($playId !== null) foreach ($plays as $p) if (($p['id'] ?? '') === $playId) { $play = $p; break; }
  $today = date('Y-m-d');
  $upcoming = array_values(array_filter($events, fn($ev) => ($ev['date'] ?? '') >= $today));
  usort($upcoming, fn($a, $b) => strcmp($a['date'] . ($a['time'] ?? ''), $b['date'] . ($b['time'] ?? '')));
  $byId = []; foreach ($plays as $p) $byId[$p['id']] = $p;
  $months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  $fmt = function ($ev) use ($months) { [$y, $m, $dd] = array_map('intval', explode('-', $ev['date'])); return $dd . ' ' . $months[$m - 1] . (($ev['time'] ?? '') ? ', ' . $ev['time'] : ''); };

  if ($play) {
    $next = null; foreach ($upcoming as $ev) if (($ev['playId'] ?? '') === $play['id']) { $next = $ev; break; }
    $title = $play['title'] . ' — ' . $name;
    $desc = trim(($play['genre'] ? $play['genre'] . '. ' : '') . ($next ? 'Ближайший показ ' . $fmt($next) . '. ' : '') . mb_substr($play['description'] ?? '', 0, 180));
    $image = !empty($play['poster']) ? $base . $play['poster'] : $base . 'assets/og-cover.png';
    $url = $base . 'play.html?id=' . rawurlencode($play['id']);
  } else {
    $next = $upcoming[0] ?? null;
    $title = $name;
    $desc = trim(($th['tagline'] ?? '') . ($next ? ' Ближайший показ: ' . (($byId[$next['playId'] ?? ''] ?? null)['title'] ?? 'спектакль') . ', ' . $fmt($next) . '.' : ''));
    $image = $base . 'assets/og-cover.png';
    $url = $base;
  }
  $og = "<meta property=\"og:type\" content=\"website\">\n<meta property=\"og:site_name\" content=\"{$e($name)}\">\n<meta property=\"og:title\" content=\"{$e($title)}\">\n<meta property=\"og:description\" content=\"{$e($desc)}\">\n<meta property=\"og:image\" content=\"{$e($image)}\">\n<meta property=\"og:url\" content=\"{$e($url)}\">\n<meta property=\"og:locale\" content=\"ru_RU\">\n<meta name=\"twitter:card\" content=\"summary_large_image\">\n<meta name=\"description\" content=\"{$e($desc)}\">";
  // og:video: Telegram и VK показывают ролик прямо в превью. На странице спектакля — первое видео из медиа, на главной — видео шапки
  $video = null;
  if ($play) { foreach ($play['media'] ?? [] as $m) if (($m['type'] ?? '') === 'video' && empty($m['hidden']) && !empty($m['src'])) { $video = $m['src']; break; } }
  elseif (!empty($th['heroVideo'])) $video = $th['heroVideo'];
  if ($video) {
    $ext = strtolower(pathinfo($video, PATHINFO_EXTENSION)); $mime = $ext === 'webm' ? 'video/webm' : ($ext === 'mov' ? 'video/quicktime' : 'video/mp4');
    $og .= "\n<meta property=\"og:video\" content=\"{$e($base . $video)}\">\n<meta property=\"og:video:secure_url\" content=\"{$e($base . $video)}\">\n<meta property=\"og:video:type\" content=\"{$mime}\">\n<meta property=\"og:video:width\" content=\"1280\">\n<meta property=\"og:video:height\" content=\"720\">";
  }
  $html = preg_replace('~<!--OG-->.*?<!--/OG-->~s', $og, $html, 1);
  $html = preg_replace('~<meta name="description" content="[^"]*">\\s*~', '', $html, 1);
  $html = preg_replace('~<title>.*?</title>~s', '<title>' . $e($title) . '</title>', $html, 1);

  $graph = [['@type' => 'TheaterGroup', 'name' => $name, 'url' => $base, 'description' => $th['tagline'] ?? '']];
  foreach (array_slice($upcoming, 0, 20) as $ev) {
    $p = $byId[$ev['playId'] ?? ''] ?? null;
    if ($play && (!$p || $p['id'] !== $play['id'])) continue;
    $ticket = $ev['ticketUrl'] ?: ($p['ticketUrl'] ?? '') ?: ($th['ticketsUrl'] ?? '');
    $item = ['@type' => 'TheaterEvent', 'name' => $p['title'] ?? ($ev['note'] ?: 'Спектакль'), 'startDate' => $ev['date'] . 'T' . ($ev['time'] ?: '19:00') . ':00+03:00',
      'eventStatus' => 'https://schema.org/EventScheduled', 'eventAttendanceMode' => 'https://schema.org/OfflineEventAttendanceMode',
      'location' => ['@type' => 'Place', 'name' => $ev['venue'] ?: ($th['venue'] ?? ''), 'address' => $th['address'] ?? ''],
      'performer' => ['@type' => 'TheaterGroup', 'name' => $name], 'organizer' => ['@type' => 'Organization', 'name' => $name, 'url' => $base],
      'url' => $p ? $base . 'play.html?id=' . rawurlencode($p['id']) : $base];
    if (!empty($p['poster'])) $item['image'] = $base . $p['poster'];
    if ($ticket) $item['offers'] = ['@type' => 'Offer', 'url' => $ticket, 'priceCurrency' => 'RUB', 'availability' => in_array('soldout', $ev['badges'] ?? [], true) ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock'];
    $graph[] = $item;
  }
  if ($play) {
    if (!empty($play['poster'])) $graph[] = ['@type' => 'ImageObject', 'contentUrl' => $base . $play['poster'], 'name' => $play['title'], 'caption' => 'Постер спектакля «' . $play['title'] . '»', 'representativeOfPage' => true];
    foreach ($play['media'] ?? [] as $m) {
      if (!empty($m['hidden']) || empty($m['src'])) continue;
      $ts = preg_match('~/(\d{10})-~', $m['src'], $mm) ? date('Y-m-d', (int)$mm[1]) : null;
      if (($m['type'] ?? '') === 'video') $graph[] = array_filter(['@type' => 'VideoObject', 'name' => $m['caption'] ?: 'Видео: ' . $play['title'], 'description' => $m['alt'] ?: 'Видео со спектакля «' . $play['title'] . '»', 'thumbnailUrl' => $base . ($m['poster'] ?: ($play['poster'] ?: 'assets/og-cover.png')), 'contentUrl' => $base . $m['src'], 'uploadDate' => $ts, 'inLanguage' => 'ru']);
      else $graph[] = ['@type' => 'ImageObject', 'contentUrl' => $base . $m['src'], 'name' => $m['caption'] ?: $play['title'], 'caption' => $m['alt'] ?: ($m['caption'] ?: $play['title'])];
    }
  }
  $ld = '<script type="application/ld+json">' . json_encode(['@context' => 'https://schema.org', '@graph' => $graph], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '</script>';
  $html = str_replace('</head>', $ld . "\n</head>", $html);
  header('Content-Type: text/html; charset=utf-8');
  echo $html;
}
