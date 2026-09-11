<?php
// Бэкенд админки для обычного PHP-хостинга (InfinityFree, любой shared-хостинг с PHP 7.4+).
// Те же функции, что у server.js: вход по паролю, чтение/запись data/data.json, загрузка фото в photos/.
// Адреса: api.php?a=me | login | logout | data | upload
declare(strict_types=1);

$ROOT = __DIR__;
$DATA_DIR = $ROOT . '/data';
$DATA_FILE = $DATA_DIR . '/data.json';
$HISTORY_DIR = $DATA_DIR . '/history';
$VISITS_FILE = $DATA_DIR . '/visits.json';
$PW_FILE = $DATA_DIR . '/password.json'; // хэш пароля, заданного из админки (приоритетнее config.php)
$PUSH_FILE = $DATA_DIR . '/push.json';       // подписки на пуш-уведомления
$PUSH_KEYS = $DATA_DIR . '/push-keys.json';  // VAPID-ключи и секрет для cron (не публиковать)
$WAIT_FILE = $DATA_DIR . '/waitlist.json';   // почта в листе ожидания
$PHOTOS_DIR = $ROOT . '/photos';
$DEFAULT_PASSWORD = 'смените-меня';

$config = file_exists($ROOT . '/config.php') ? require $ROOT . '/config.php' : [];
$PASSWORD = (string)($config['password'] ?? '');

@mkdir($DATA_DIR, 0755, true);
@mkdir($PHOTOS_DIR, 0755, true);
@mkdir($HISTORY_DIR, 0755, true);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

session_set_cookie_params(['lifetime' => 60 * 60 * 24 * 14, 'path' => '/', 'httponly' => true, 'samesite' => 'Strict', 'secure' => !empty($_SERVER['HTTPS'])]);
session_name('rat_admin');
session_start();

function out($data, int $code = 200): void { http_response_code($code); echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); exit; }
function fail(string $msg, int $code = 400): void { out(['error' => $msg], $code); }
function body(): array { $j = json_decode((string)file_get_contents('php://input'), true); return is_array($j) ? $j : []; }
function authed(): bool { return !empty($_SESSION['authed']) && $_SESSION['authed'] === true; }
function requireAuth(): void { if (!authed()) fail('unauthorized', 401); }

function readData(string $file): array {
  $j = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
  return is_array($j) ? $j : ['show' => ['theatre' => '', 'title' => '', 'dates' => ''], 'actors' => []];
}
function str($v, int $max = 500): string { return mb_substr(trim((string)($v ?? '')), 0, $max); }
function url($v): string { $v = str($v, 500); return preg_match('~^https?://\S+$~', $v) ? $v : ''; }
function img($v): string { $v = str($v); return preg_match('~^photos/[\w.-]+$~', $v) ? $v : ''; }
function playMedia($v): array {
  $out = [];
  foreach (array_slice(is_array($v) ? $v : [], 0, 40) as $x) {
    if (!is_array($x)) continue;
    $src = media($x['src'] ?? '');
    if ($src === '') continue;
    $type = preg_match('~\.(mp4|webm|mov)$~i', $src) ? 'video' : 'photo';
    $out[] = ['type' => $type, 'src' => $src, 'caption' => str($x['caption'] ?? '', 140), 'alt' => str($x['alt'] ?? '', 200), 'poster' => img($x['poster'] ?? ''), 'hidden' => !empty($x['hidden'])];
  }
  return $out;
}
function voices($v): array {
  $out = [];
  foreach (array_slice(is_array($v) ? $v : [], 0, 10) as $x) {
    if (!is_array($x)) continue;
    $item = ['name' => str($x['name'] ?? '', 100), 'note' => str($x['note'] ?? '', 200), 'audio' => media($x['audio'] ?? '')];
    if ($item['audio'] !== '') $out[] = $item;
  }
  return $out;
}
function media($v): string { $v = str($v); return preg_match('~^photos/[\w.-]+$~', $v) ? $v : ''; }
function sanitize(array $in): array {
  $show = is_array($in['show'] ?? null) ? $in['show'] : [];
  $th = is_array($in['theatre'] ?? null) ? $in['theatre'] : [];
  $lst = fn($k, $max) => array_slice(is_array($in[$k] ?? null) ? $in[$k] : [], 0, $max);
  $actors = []; $plays = []; $events = []; $reviews = []; $gallery = [];
  foreach ($lst('actors', 50) as $a) {
    if (!is_array($a)) continue;
    $item = ['name' => str($a['name'] ?? '', 100), 'golos' => !array_key_exists('golos', $a) || !empty($a['golos']), 'role' => str($a['role'] ?? '', 100), 'scene' => str($a['scene'] ?? '', 400), 'bio' => str($a['bio'] ?? '', 600), 'roles' => str($a['roles'] ?? '', 300),
             'photo' => img($a['photo'] ?? ''), 'sbp' => url($a['sbp'] ?? ''), 'phone' => str($a['phone'] ?? '', 30), 'bank' => str($a['bank'] ?? '', 60)];
    if ($item['name'] !== '') $actors[] = $item;
  }
  foreach ($lst('plays', 50) as $p) {
    if (!is_array($p)) continue;
    $id = preg_replace('~[^a-z0-9-]~', '', mb_strtolower(str($p['id'] ?? '', 40)));
    $item = ['id' => $id ?: 'play-' . (count($plays) + 1), 'title' => str($p['title'] ?? '', 100), 'genre' => str($p['genre'] ?? '', 120), 'description' => str($p['description'] ?? '', 3000),
             'poster' => img($p['poster'] ?? ''), 'duration' => str($p['duration'] ?? '', 40), 'age' => str($p['age'] ?? '', 6), 'cast' => str($p['cast'] ?? '', 500), 'ticketUrl' => url($p['ticketUrl'] ?? ''), 'afishaShowId' => preg_replace('~\D~', '', str($p['afishaShowId'] ?? '', 40)), 'voices' => voices($p['voices'] ?? null), 'media' => playMedia($p['media'] ?? null), 'hidden' => !empty($p['hidden'])];
    if ($item['title'] !== '') $plays[] = $item;
  }
  $BADGES = ['premiere', 'last', 'few', 'soldout'];
  foreach ($lst('events', 200) as $e) {
    if (!is_array($e)) continue;
    $date = str($e['date'] ?? '', 10);
    if (!preg_match('~^\d{4}-\d{2}-\d{2}$~', $date)) continue;
    $badges = array_values(array_filter(is_array($e['badges'] ?? null) ? $e['badges'] : [], fn($b) => in_array($b, $BADGES, true)));
    $events[] = ['date' => $date, 'time' => str($e['time'] ?? '', 5), 'playId' => str($e['playId'] ?? '', 40), 'venue' => str($e['venue'] ?? '', 120),
                 'price' => str($e['price'] ?? '', 40), 'ticketUrl' => url($e['ticketUrl'] ?? ''), 'afishaSessionId' => preg_replace('~\D~', '', str($e['afishaSessionId'] ?? '', 40)), 'note' => str($e['note'] ?? '', 120), 'badges' => $badges, 'hidden' => !empty($e['hidden'])];
  }
  usort($events, fn($x, $y) => strcmp($x['date'] . $x['time'], $y['date'] . $y['time']));
  foreach ($lst('reviews', 100) as $r) {
    if (!is_array($r)) continue;
    $item = ['text' => str($r['text'] ?? '', 800), 'author' => str($r['author'] ?? '', 100), 'source' => str($r['source'] ?? '', 100), 'url' => url($r['url'] ?? ''), 'playId' => str($r['playId'] ?? '', 40), 'hidden' => !empty($r['hidden'])];
    if (!empty($r['fromSite'])) { $item['fromSite'] = true; $item['id'] = preg_replace('~[^\w-]~', '', (string)($r['id'] ?? '')); $item['date'] = str($r['date'] ?? '', 10); }
    if ($item['text'] !== '') $reviews[] = $item;
  }
  foreach ($lst('gallery', 200) as $g) {
    if (!is_array($g)) continue;
    $item = ['photo' => img($g['photo'] ?? ''), 'video' => media($g['video'] ?? ''), 'poster' => img($g['poster'] ?? ''), 'caption' => str($g['caption'] ?? '', 140), 'alt' => str($g['alt'] ?? '', 200), 'playId' => str($g['playId'] ?? '', 40), 'hidden' => !empty($g['hidden'])];
    $item['actors'] = array_values(array_filter(array_map(fn($n) => str($n, 100), array_slice(is_array($g['actors'] ?? null) ? $g['actors'] : [], 0, 20)), fn($n) => $n !== '')); // кто на фото (имена из списка актёров)
    if ($item['photo'] !== '' || $item['video'] !== '') $gallery[] = $item; // фото или видео (ролик в бэкстейдже)
  }
  return [
    'theatre' => ['name' => str($th['name'] ?? '', 100), 'tagline' => str($th['tagline'] ?? '', 200), 'about' => str($th['about'] ?? '', 3000), 'venue' => str($th['venue'] ?? '', 120),
                  'address' => str($th['address'] ?? '', 200), 'instagram' => url($th['instagram'] ?? ''), 'telegram' => url($th['telegram'] ?? ''), 'vk' => url($th['vk'] ?? ''),
                  'email' => str($th['email'] ?? '', 100), 'phone' => str($th['phone'] ?? '', 30), 'ticketsUrl' => url($th['ticketsUrl'] ?? ''),
                  'heroVideo' => media($th['heroVideo'] ?? ''), 'heroPoster' => img($th['heroPoster'] ?? ''), 'mapCoords' => str($th['mapCoords'] ?? '', 40), 'marquee' => str($th['marquee'] ?? '', 300), 'afishaPartnerId' => preg_replace('~\D~', '', str($th['afishaPartnerId'] ?? '', 20))],
    'plays' => $plays, 'events' => $events, 'reviews' => $reviews, 'gallery' => $gallery,
    'show' => ['theatre' => str($show['theatre'] ?? '', 100), 'title' => str($show['title'] ?? '', 100), 'dates' => str($show['dates'] ?? '', 100),
               'heading1' => str($show['heading1'] ?? '', 40), 'heading2' => str($show['heading2'] ?? '', 40), 'lead' => str($show['lead'] ?? '', 400), 'marquee' => str($show['marquee'] ?? '', 300),
               'thanks' => str($show['thanks'] ?? '', 80), 'thanksNote' => str($show['thanksNote'] ?? '', 200)],
    'actors' => $actors,
  ];
}


// ---------- Афиша (tickets.afisha.ru): даты, цены и остатки мест ----------
function http_get(string $url, int $timeout = 15): ?string {
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_FOLLOWLOCATION => true, CURLOPT_USERAGENT => 'Mozilla/5.0 (rat-theater site)', CURLOPT_SSL_VERIFYPEER => false]);
    $r = curl_exec($ch); curl_close($ch);
    if (is_string($r) && $r !== '') return $r;
  }
  $ctx = stream_context_create(['http' => ['timeout' => $timeout, 'header' => "User-Agent: Mozilla/5.0 (rat-theater site)\r\n"], 'ssl' => ['verify_peer' => false]]);
  $r = @file_get_contents($url, false, $ctx);
  return is_string($r) && $r !== '' ? $r : null;
}
function afisha_show(string $partner, string $showId): ?array {
  $j = http_get("https://tickets.afisha.ru/wl/{$partner}/api/shows/info?lang=ru&show_id={$showId}");
  $d = $j ? json_decode($j, true) : null;
  return is_array($d) && !empty($d['show']) ? $d['show'] : null;
}
function afisha_events(array $show): array {
  $out = [];
  foreach ($show['events'] ?? [] as $e) {
    if (empty($e['id']) || empty($e['date'])) continue;
    $out[] = ['sessionId' => (string)$e['id'], 'date' => substr($e['date'], 0, 10), 'time' => substr($e['date'], 11, 5),
              'venue' => trim((string)($e['location_name'] ?? '')), 'count' => (int)($e['count'] ?? 0),
              'minPrice' => (int)round((float)($e['min_price'] ?? 0)), 'maxPrice' => (int)round((float)($e['max_price'] ?? 0))];
  }
  return $out;
}

function readJson(string $file, array $default): array { $j = is_file($file) ? json_decode((string)file_get_contents($file), true) : null; return is_array($j) ? $j + $default : $default; }
function writeJson(string $file, array $v): void { $tmp = $file . '.tmp'; file_put_contents($tmp, json_encode($v, JSON_UNESCAPED_UNICODE)); rename($tmp, $file); }

/* ---------- пуш-уведомления (Web Push, VAPID) и лист ожидания ----------
   Пуш уходит без текста: браузер получает «тычок», service worker спрашивает push_msg, что показать.
   Так не нужно шифровать полезную нагрузку — хватает подписи VAPID (ES256 через OpenSSL). */
function b64u(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function pushKeys(): array {
  global $PUSH_KEYS;
  $k = is_file($PUSH_KEYS) ? json_decode((string)file_get_contents($PUSH_KEYS), true) : null;
  if (is_array($k) && !empty($k['private'])) return $k;
  $res = @openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
  if (!$res) fail('OpenSSL на хостинге без эллиптических кривых — уведомления недоступны', 500);
  openssl_pkey_export($res, $pem); $d = openssl_pkey_get_details($res);
  $pub = "\x04" . str_pad($d['ec']['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['ec']['y'], 32, "\0", STR_PAD_LEFT);
  $k = ['private' => $pem, 'public' => b64u($pub), 'cron' => bin2hex(random_bytes(12)), 'created' => date('c')];
  writeJson($PUSH_KEYS, $k);
  return $k;
}
function der2raw(string $der): string { // подпись DER → r||s по 32 байта
  $pos = 2; if ((ord($der[1]) & 0x80) !== 0) $pos += ord($der[1]) & 0x7f;
  $out = '';
  for ($i = 0; $i < 2; $i++) { $pos++; $len = ord($der[$pos++]); $int = ltrim(substr($der, $pos, $len), "\0"); $pos += $len; $out .= str_pad($int, 32, "\0", STR_PAD_LEFT); }
  return $out;
}
function vapidJwt(string $aud, array $k, string $contact): string {
  $data = b64u(json_encode(['typ' => 'JWT', 'alg' => 'ES256'])) . '.' . b64u(json_encode(['aud' => $aud, 'exp' => time() + 12 * 3600, 'sub' => $contact], JSON_UNESCAPED_SLASHES));
  openssl_sign($data, $der, $k['private'], OPENSSL_ALGO_SHA256);
  return $data . '.' . b64u(der2raw($der));
}
function pushPoke(string $endpoint, array $k, string $contact): int {
  $u = parse_url($endpoint); $aud = ($u['scheme'] ?? 'https') . '://' . ($u['host'] ?? '');
  $headers = ['Authorization: vapid t=' . vapidJwt($aud, $k, $contact) . ', k=' . $k['public'], 'TTL: 86400', 'Content-Length: 0', 'Urgency: normal'];
  if (function_exists('curl_init')) {
    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => '', CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_HTTPHEADER => $headers]);
    curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
    return $code;
  }
  $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => '', 'timeout' => 15, 'ignore_errors' => true], 'ssl' => ['verify_peer' => false]]);
  @file_get_contents($endpoint, false, $ctx);
  return (int)(preg_match('~ (\d{3}) ~', $http_response_header[0] ?? '', $m) ? $m[1] : 0);
}
function pushDb(): array { global $PUSH_FILE; $j = is_file($PUSH_FILE) ? json_decode((string)file_get_contents($PUSH_FILE), true) : null; return is_array($j) ? $j + ['subs' => []] : ['subs' => []]; }
function evKey(array $e): string { return ($e['date'] ?? '') . '_' . ($e['time'] ?? '') . '_' . ($e['playId'] ?? ''); }
function siteBase(): string {
  $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
  return $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/') . '/';
}
/* обход подписок: что пора отправить. Возвращает статистику. */
function pushRun(): array {
  global $DATA_FILE, $PUSH_FILE, $WAIT_FILE, $DATA_DIR;
  $data = readData($DATA_FILE); $db = pushDb(); $k = pushKeys();
  $contact = 'mailto:' . (($data['theatre']['email'] ?? '') ?: 'admin@example.com');
  $plays = []; foreach ($data['plays'] ?? [] as $p) $plays[$p['id']] = $p;
  $events = []; foreach ($data['events'] ?? [] as $e) if (empty($e['hidden'])) $events[evKey($e)] = $e;
  $tz = new DateTimeZone('Europe/Moscow'); $now = new DateTime('now', $tz);
  $months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  $when = function (array $e) use ($months) { [$y, $m, $d] = array_map('intval', explode('-', $e['date'])); return $d . ' ' . $months[$m - 1] . (($e['time'] ?? '') ? ' в ' . $e['time'] : ''); };
  $title = function (array $e) use ($plays) { return $plays[$e['playId'] ?? '']['title'] ?? ($e['note'] ?: 'Спектакль'); };
  $urlOf = function (array $e) use ($plays) { return isset($plays[$e['playId'] ?? '']) ? 'play.html?id=' . rawurlencode($e['playId']) : './'; };
  $hoursTo = function (array $e) use ($tz, $now) { $dt = new DateTime($e['date'] . ' ' . (($e['time'] ?? '') ?: '19:00'), $tz); return ($dt->getTimestamp() - $now->getTimestamp()) / 3600; };
  // остатки билетов нужны только если кто-то ждёт
  $waiting = false; foreach ($db['subs'] as $s) if (!empty($s['wait'])) { $waiting = true; break; }
  $mails = is_file($WAIT_FILE) ? (json_decode((string)file_get_contents($WAIT_FILE), true) ?: []) : [];
  foreach ($mails as $m) if (empty($m['sent'])) { $waiting = true; break; }
  $sessions = [];
  if ($waiting) {
    $partner = preg_replace('~\D~', '', (string)($data['theatre']['afishaPartnerId'] ?? ''));
    if ($partner !== '') foreach (array_unique(array_filter(array_map(fn($p) => preg_replace('~\D~', '', (string)($p['afishaShowId'] ?? '')), $data['plays'] ?? []))) as $sid) {
      $show = afisha_show($partner, $sid); if ($show) foreach (afisha_events($show) as $ev) $sessions[$ev['sessionId']] = $ev['count'];
    }
  }
  $available = function (array $e) use ($sessions) { $sid = preg_replace('~\D~', '', (string)($e['afishaSessionId'] ?? '')); return $sid !== '' && isset($sessions[$sid]) && $sessions[$sid] > 0; };
  $stat = ['sent' => 0, 'failed' => 0, 'removed' => 0, 'mailed' => 0];
  foreach ($db['subs'] as $id => &$s) {
    $queue = [];
    foreach (($s['remind'] ?? []) as $key => $done) {
      $e = $events[$key] ?? null;
      if (!$e) { unset($s['remind'][$key]); continue; }
      $h = $hoursTo($e);
      if ($h < -3) { unset($s['remind'][$key]); continue; }
      if (!$done && $h <= 26) { $queue[] = ['title' => ($e['date'] === $now->format('Y-m-d') ? 'Сегодня' : 'Завтра') . ': «' . $title($e) . '»', 'body' => $when($e) . ', ' . (($e['venue'] ?? '') ?: ($data['theatre']['venue'] ?? '')) . '. Ждём вас!', 'url' => $urlOf($e), 'tag' => 'remind-' . $key]; $s['remind'][$key] = 1; }
    }
    foreach (($s['wait'] ?? []) as $key => $done) {
      $e = $events[$key] ?? null;
      if (!$e || $hoursTo($e) < 0) { unset($s['wait'][$key]); continue; }
      if (!$done && $available($e)) { $queue[] = ['title' => 'Появились билеты: «' . $title($e) . '»', 'body' => $when($e) . '. Успейте, пока снова не разобрали.', 'url' => $urlOf($e), 'tag' => 'wait-' . $key]; unset($s['wait'][$key]); }
    }
    if (!$queue) continue;
    $s['pending'] = array_merge($s['pending'] ?? [], $queue);
    $code = pushPoke($s['endpoint'], $k, $contact);
    if ($code === 404 || $code === 410) { unset($db['subs'][$id]); $stat['removed']++; continue; }
    if ($code >= 200 && $code < 300) { $stat['sent']++; $s['fails'] = 0; }
    else { $stat['failed']++; $s['fails'] = ($s['fails'] ?? 0) + 1; if ($s['fails'] >= 5) { unset($db['subs'][$id]); $stat['removed']++; } }
  }
  unset($s);
  // письма из листа ожидания
  $changed = false;
  foreach ($mails as &$m) {
    if (!empty($m['sent'])) continue;
    $e = $events[$m['key']] ?? null;
    if (!$e || $hoursTo($e) < 0) { $m['sent'] = 'expired'; $changed = true; continue; }
    if ($available($e)) {
      $subject = '=?UTF-8?B?' . base64_encode('Появились билеты: «' . $title($e) . '»') . '?=';
      $body = 'Здравствуйте! На «' . $title($e) . '» ' . $when($e) . ' снова есть билеты: ' . siteBase() . $urlOf($e) . "\n\nТеатр RAT";
      $from = ($data['theatre']['email'] ?? '') ?: ('noreply@' . ($_SERVER['HTTP_HOST'] ?? 'localhost'));
      $ok = @mail($m['email'], $subject, $body, "From: {$from}\r\nContent-Type: text/plain; charset=UTF-8");
      $m['sent'] = $ok ? date('c') : 'failed'; $changed = true; if ($ok) $stat['mailed']++;
    }
  }
  unset($m);
  if ($changed) writeJson($WAIT_FILE, $mails);
  $db['lastRun'] = date('c'); $db['lastStat'] = $stat;
  writeJson($PUSH_FILE, $db);
  return $stat;
}
function snapshot(string $dataFile, string $dir): void {
  if (!is_file($dataFile)) return;
  @copy($dataFile, $dir . '/' . date('Y-m-d-His') . '-' . sprintf('%03d', (int)fmod(microtime(true) * 1000, 1000)) . '.json');
  $files = glob($dir . '/*.json') ?: []; sort($files);
  while (count($files) > 20) @unlink(array_shift($files));
}
function historyId(string $id): string { $id = preg_replace('~[^0-9.\-]~', '', $id); return strpos($id, '..') === false ? $id : ''; } // имя файла версии: цифры, дефисы, точка; без выхода из папки
function historyList(string $dir): array {
  $out = [];
  foreach (array_reverse(glob($dir . '/*.json') ?: []) as $f) {
    $j = json_decode((string)file_get_contents($f), true) ?: [];
    $out[] = ['id' => basename($f, '.json'), 'time' => filemtime($f), 'size' => filesize($f),
              'actors' => count($j['actors'] ?? []), 'events' => count($j['events'] ?? []), 'plays' => count($j['plays'] ?? []), 'reviews' => count($j['reviews'] ?? []), 'gallery' => count($j['gallery'] ?? [])];
  }
  return $out;
}

$a = $_GET['a'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

switch ($a) {
  case 'me':
    out(['authed' => authed(), 'backend' => 'php']);

  case 'login':
    if ($method !== 'POST') fail('POST only', 405);
    $pwHash = is_file($PW_FILE) ? (string)(json_decode((string)file_get_contents($PW_FILE), true)['hash'] ?? '') : '';
    if ($pwHash === '' && ($PASSWORD === '' || $PASSWORD === $DEFAULT_PASSWORD)) fail('Сначала задайте пароль в файле config.php на хостинге', 403);
    $_SESSION['attempts'] = (int)($_SESSION['attempts'] ?? 0);
    if ($_SESSION['attempts'] >= 5 && time() - (int)($_SESSION['blocked_at'] ?? 0) < 60) fail('Слишком много попыток, подождите минуту', 429);
    $given = (string)(body()['password'] ?? '');
    if ($pwHash !== '' ? password_verify($given, $pwHash) : hash_equals($PASSWORD, $given)) {
      session_regenerate_id(true);
      $_SESSION['authed'] = true; $_SESSION['attempts'] = 0;
      out(['ok' => true]);
    }
    $_SESSION['attempts']++;
    if ($_SESSION['attempts'] >= 5) $_SESSION['blocked_at'] = time();
    sleep(1);
    fail('Неверный пароль', 401);

  case 'password':
    // смена пароля из админки: хэш хранится в data/password.json, config.php больше не нужен
    requireAuth();
    if ($method !== 'POST') fail('POST only', 405);
    $b = body(); $cur = (string)($b['current'] ?? ''); $next = (string)($b['next'] ?? '');
    $pwHash = is_file($PW_FILE) ? (string)(json_decode((string)file_get_contents($PW_FILE), true)['hash'] ?? '') : '';
    $okCur = $pwHash !== '' ? password_verify($cur, $pwHash) : hash_equals($PASSWORD, $cur);
    if (!$okCur) { sleep(1); fail('Текущий пароль неверный', 401); }
    if (mb_strlen($next) < 8) fail('Новый пароль короче 8 символов');
    if ($next === $cur) fail('Новый пароль совпадает с текущим');
    writeJson($PW_FILE, ['hash' => password_hash($next, PASSWORD_DEFAULT), 'changed' => date('c')]);
    session_regenerate_id(true);
    out(['ok' => true]);

  case 'logout':
    $_SESSION = [];
    session_destroy();
    out(['ok' => true]);

  case 'data':
    if ($method === 'GET') out(readData($DATA_FILE));
    if ($method !== 'PUT' && $method !== 'POST') fail('PUT only', 405);
    requireAuth();
    $data = sanitize(body());
    // отзывы с сайта, которые пришли, пока админка была открыта: не даём их затереть (since — момент загрузки админки)
    $since = (int)($_GET['since'] ?? 0);
    if ($since > 0) {
      $have = []; foreach ($data['reviews'] as $r) if (!empty($r['id'])) $have[$r['id']] = true;
      foreach (readData($DATA_FILE)['reviews'] ?? [] as $r) if (!empty($r['fromSite']) && !empty($r['id']) && empty($have[$r['id']]) && (int)substr($r['id'], 1, 10) > $since) $data['reviews'][] = $r;
    }
    snapshot($DATA_FILE, $HISTORY_DIR);
    $tmp = $DATA_FILE . '.tmp';
    if (file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) === false) fail('Не удалось записать data/data.json — проверьте права на папку data', 500);
    rename($tmp, $DATA_FILE);
    out(['ok' => true, 'data' => $data]);

  case 'review':
    // отзыв зрителя с сайта: попадает в черновики, публикует админ. Ловушка для ботов + не больше 5 в день с одного адреса
    if ($method !== 'POST') fail('POST only', 405);
    $b = body();
    if (trim((string)($b['site'] ?? '')) !== '') out(['ok' => true]); // бот заполнил скрытое поле — делаем вид, что приняли
    $text = str($b['text'] ?? '', 800); $author = str($b['author'] ?? '', 60); $playId = preg_replace('~[^\w-]~', '', (string)($b['playId'] ?? ''));
    if (mb_strlen($text) < 20) fail('Напишите хотя бы пару предложений');
    if (preg_match('~https?://|www\.~i', $text)) fail('Ссылки в отзывах не публикуем');
    $rateFile = $DATA_DIR . '/reviews-rate.json'; $rate = readJson($rateFile, []); $day = date('Y-m-d'); $rate = array_filter($rate, fn($v, $k) => strpos($k, $day) === 0, ARRAY_FILTER_USE_BOTH);
    $rk = $day . '-' . substr(hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . ($_SERVER['HTTP_USER_AGENT'] ?? '')), 0, 12);
    if (($rate[$rk] ?? 0) >= 5) fail('Слишком много отзывов за день, спасибо! Остальное — завтра', 429);
    $rate[$rk] = ($rate[$rk] ?? 0) + 1; writeJson($rateFile, $rate);
    $data = readData($DATA_FILE);
    $data['reviews'][] = ['text' => $text, 'author' => $author, 'source' => 'с сайта', 'url' => '', 'playId' => $playId, 'hidden' => true, 'fromSite' => true, 'id' => 'r' . time() . '-' . bin2hex(random_bytes(2)), 'date' => $day];
    $tmp = $DATA_FILE . '.tmp'; file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)); rename($tmp, $DATA_FILE);
    out(['ok' => true]);

  case 'snapshot':
    // содержимое одной версии из истории — для сравнения «что изменилось»
    requireAuth();
    $id = historyId((string)($_GET['id'] ?? ''));
    $f = $HISTORY_DIR . '/' . $id . '.json';
    if ($id === '' || !is_file($f)) fail('Версия не найдена: ' . $id, 404);
    out(['ok' => true, 'data' => json_decode((string)file_get_contents($f), true) ?: []]);

  case 'history':
    // список сохранённых версий (последние 20)
    requireAuth();
    out(['ok' => true, 'items' => historyList($HISTORY_DIR)]);

  case 'restore':
    // вернуть версию: текущая перед этим тоже сохраняется в историю
    requireAuth();
    if ($method !== 'POST') fail('POST only', 405);
    $id = historyId((string)(body()['id'] ?? ''));
    $f = $HISTORY_DIR . '/' . $id . '.json';
    if ($id === '' || !is_file($f)) fail('Версия не найдена: ' . $id);
    $restored = json_decode((string)file_get_contents($f), true);
    if (!is_array($restored)) fail('Файл версии повреждён');
    snapshot($DATA_FILE, $HISTORY_DIR);
    file_put_contents($DATA_FILE, json_encode(sanitize($restored), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    out(['ok' => true, 'data' => readData($DATA_FILE)]);

  case 'backup':
    // архив со всеми данными и фото
    requireAuth();
    if (!class_exists('ZipArchive')) fail('На хостинге нет ZipArchive — скачайте папки data и photos через File Manager', 500);
    $zipPath = tempnam(sys_get_temp_dir(), 'ratbk');
    $zip = new ZipArchive();
    if ($zip->open($zipPath, ZipArchive::OVERWRITE) !== true) fail('Не удалось создать архив', 500);
    foreach ([$DATA_DIR => 'data', $PHOTOS_DIR => 'photos'] as $dir => $name) {
      foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $file) {
        $rel = $name . '/' . substr($file->getPathname(), strlen($dir) + 1);
        if (in_array(basename($rel), ['password.txt', 'password.json', 'push-keys.json', 'push.json', 'waitlist.json', 'reviews-rate.json'], true) || strpos($rel, 'data/og/') === 0) continue;
        $zip->addFile($file->getPathname(), $rel);
      }
    }
    $zip->close();
    header_remove('Content-Type');
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="rat-theater-backup-' . date('Y-m-d-Hi') . '.zip"');
    header('Content-Length: ' . filesize($zipPath));
    readfile($zipPath); @unlink($zipPath); exit;

  case 'sizes':
    // размеры файлов в photos/ — для проверки веса страниц в админке
    requireAuth();
    $sizes = [];
    foreach (glob($PHOTOS_DIR . '/*') ?: [] as $f) if (is_file($f)) $sizes['photos/' . basename($f)] = filesize($f);
    out(['ok' => true, 'sizes' => $sizes]);

  case 'hit':
    // счётчик посещений без cookie: страница + день; уникальность — по усечённому хэшу IP+браузера, IP не хранится
    $page = preg_replace('~[^a-z0-9:_-]~', '', mb_strtolower(str($_GET['p'] ?? '', 60)));
    if ($page === '') fail('no page');
    $day = date('Y-m-d');
    $h = substr(hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . ($_SERVER['HTTP_USER_AGENT'] ?? '') . '|' . $day), 0, 12);
    $v = readJson($VISITS_FILE, ['days' => [], 'seen' => []]);
    $v['days'][$day][$page]['views'] = (int)($v['days'][$day][$page]['views'] ?? 0) + 1;
    if (empty($v['seen'][$day][$page][$h])) { $v['seen'][$day][$page][$h] = 1; $v['days'][$day][$page]['uniq'] = (int)($v['days'][$day][$page]['uniq'] ?? 0) + 1; }
    foreach (array_keys($v['seen']) as $d) if ($d !== $day) unset($v['seen'][$d]);       // хэши храним только за текущий день
    foreach (array_keys($v['days']) as $d) if ($d < date('Y-m-d', strtotime('-400 days'))) unset($v['days'][$d]);
    writeJson($VISITS_FILE, $v);
    out(['ok' => true]);

  case 'visits':
    requireAuth();
    $v = readJson($VISITS_FILE, ['days' => [], 'seen' => []]);
    krsort($v['days']);
    out(['ok' => true, 'days' => $v['days']]);

  case 'upload':
    // фото (jpg/png/webp до 8 МБ) и видео для шапки (mp4/webm до 10 МБ)
    if ($method !== 'POST') fail('POST only', 405);
    requireAuth();
    $f = $_FILES['photo'] ?? null;
    if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
      $err = (int)($f['error'] ?? 0);
      fail(in_array($err, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) ? 'Файл слишком большой для этого хостинга (лимит около 10 МБ)' : 'Не удалось получить файл');
    }
    $info = @getimagesize($f['tmp_name']);
    $ext = ['image/jpeg' => '.jpg', 'image/png' => '.png', 'image/webp' => '.webp'][$info['mime'] ?? ''] ?? null;
    if ($ext) { if ($f['size'] > 8 * 1024 * 1024) fail('Фото больше 8 МБ'); }
    else {
      $mime = function_exists('mime_content_type') ? (string)@mime_content_type($f['tmp_name']) : '';
      $ext = ['video/mp4' => '.mp4', 'video/webm' => '.webm', 'video/quicktime' => '.mov', 'audio/mpeg' => '.mp3', 'audio/mp4' => '.m4a', 'audio/x-m4a' => '.m4a', 'audio/aac' => '.aac', 'audio/ogg' => '.ogg', 'audio/wav' => '.wav', 'audio/x-wav' => '.wav'][$mime] ?? null;
      if (!$ext) fail('Нужен файл JPG, PNG, WebP или видео MP4/WebM');
      if ($f['size'] > 10 * 1024 * 1024) fail('Видео больше 10 МБ — сожмите его (5–10 секунд, 720p)');
    }
    $name = time() . '-' . bin2hex(random_bytes(3)) . $ext;
    if (!move_uploaded_file($f['tmp_name'], $PHOTOS_DIR . '/' . $name)) fail('Не удалось сохранить файл — проверьте права на папку photos', 500);
    out(['ok' => true, 'photo' => 'photos/' . $name]);

  case 'push_key':
    // публичный VAPID-ключ для подписки в браузере (создаётся при первом обращении)
    out(['ok' => true, 'key' => pushKeys()['public']]);

  case 'push_sub':
    // подписка браузера: kind = remind (за день до показа) | wait (сообщить, если появятся билеты) | renew (браузер обновил подписку)
    if ($method !== 'POST') fail('POST only', 405);
    $b = body(); $sub = is_array($b['sub'] ?? null) ? $b['sub'] : [];
    $endpoint = str($sub['endpoint'] ?? '', 2000); $kind = str($b['kind'] ?? '', 10); $key = str($b['key'] ?? '', 80);
    if (!preg_match('~^https://\S+$~', $endpoint)) fail('bad endpoint');
    if (!preg_match('~^[\d\-:_\w]*$~u', $key)) fail('bad key');
    $db = pushDb(); if (count($db['subs']) >= 5000) fail('Слишком много подписок', 429);
    $id = sha1($endpoint);
    if ($kind === 'renew' && !empty($b['old'])) { $oldId = sha1(str($b['old'], 2000)); if (isset($db['subs'][$oldId])) { $db['subs'][$id] = $db['subs'][$oldId]; unset($db['subs'][$oldId]); } }
    $s = $db['subs'][$id] ?? ['created' => date('c'), 'remind' => [], 'wait' => [], 'pending' => []];
    $s['endpoint'] = $endpoint; $s['keys'] = ['p256dh' => str($sub['keys']['p256dh'] ?? '', 200), 'auth' => str($sub['keys']['auth'] ?? '', 100)];
    if ($kind === 'remind' && $key !== '') $s['remind'][$key] = 0;
    if ($kind === 'wait' && $key !== '') $s['wait'][$key] = 0;
    if ($kind === 'off' && $key !== '') { unset($s['remind'][$key], $s['wait'][$key]); }
    $db['subs'][$id] = $s; writeJson($PUSH_FILE, $db);
    out(['ok' => true, 'remind' => array_keys($s['remind']), 'wait' => array_keys($s['wait'])]);

  case 'push_msg':
    // service worker забирает тексты уведомлений для своей подписки
    if ($method !== 'POST') fail('POST only', 405);
    $endpoint = str(body()['endpoint'] ?? '', 2000); $db = pushDb(); $id = sha1($endpoint);
    $msgs = $db['subs'][$id]['pending'] ?? [];
    if ($msgs) { $db['subs'][$id]['pending'] = []; writeJson($PUSH_FILE, $db); }
    out(['ok' => true, 'messages' => array_values($msgs)]);

  case 'push_send':
    // обход подписок: напоминания за день и «появились билеты». Дёргается внешним cron (cron-job.org) по секретному ключу или из админки
    $k = pushKeys();
    if (!authed() && !hash_equals($k['cron'], (string)($_GET['key'] ?? ''))) fail('unauthorized', 401);
    out(['ok' => true] + pushRun());

  case 'push_stats':
    requireAuth();
    $db = pushDb(); $k = pushKeys(); $remind = 0; $wait = 0;
    foreach ($db['subs'] as $s) { $remind += count(array_filter($s['remind'] ?? [], fn($v) => !$v)); $wait += count($s['wait'] ?? []); }
    $mails = is_file($WAIT_FILE) ? (json_decode((string)file_get_contents($WAIT_FILE), true) ?: []) : [];
    out(['ok' => true, 'subs' => count($db['subs']), 'remind' => $remind, 'wait' => $wait, 'mails' => count(array_filter($mails, fn($m) => empty($m['sent']))),
      'lastRun' => $db['lastRun'] ?? null, 'lastStat' => $db['lastStat'] ?? null, 'cronUrl' => siteBase() . 'api.php?a=push_send&key=' . $k['cron']]);

  case 'waitlist':
    // почта в лист ожидания на аншлаг
    if ($method !== 'POST') fail('POST only', 405);
    $b = body(); $email = str($b['email'] ?? '', 120); $key = str($b['key'] ?? '', 80);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Проверьте адрес почты');
    if (!preg_match('~^[\d\-:_\w]*$~u', $key) || $key === '') fail('bad key');
    $mails = is_file($WAIT_FILE) ? (json_decode((string)file_get_contents($WAIT_FILE), true) ?: []) : [];
    if (count($mails) >= 5000) fail('Лист ожидания переполнен', 429);
    foreach ($mails as $m) if ($m['email'] === $email && $m['key'] === $key && empty($m['sent'])) out(['ok' => true]);
    $mails[] = ['email' => $email, 'key' => $key, 'created' => date('c'), 'sent' => null];
    writeJson($WAIT_FILE, $mails);
    out(['ok' => true]);

  case 'afisha_status':
    // остатки мест и цены по всем сеансам сайта; кэш 10 минут в data/afisha-status.json
    $cacheFile = $DATA_DIR . '/afisha-status.json';
    $cache = is_file($cacheFile) ? json_decode((string)file_get_contents($cacheFile), true) : null;
    if (is_array($cache) && time() - (int)($cache['updated'] ?? 0) < 600 && empty($_GET['force'])) out($cache);
    $data = readData($DATA_FILE);
    $partner = preg_replace('~\D~', '', (string)($data['theatre']['afishaPartnerId'] ?? ''));
    $sessions = []; $ok = false;
    if ($partner !== '') {
      $showIds = array_unique(array_filter(array_map(fn($p) => preg_replace('~\D~', '', (string)($p['afishaShowId'] ?? '')), $data['plays'] ?? [])));
      foreach ($showIds as $sid) {
        $show = afisha_show($partner, $sid);
        if (!$show) continue;
        $ok = true;
        foreach (afisha_events($show) as $e) $sessions[$e['sessionId']] = ['count' => $e['count'], 'minPrice' => $e['minPrice'], 'date' => $e['date'], 'time' => $e['time']];
      }
    }
    if (!$ok) { if (is_array($cache)) out($cache); out(['ok' => false, 'updated' => 0, 'sessions' => []]); }
    $res = ['ok' => true, 'updated' => time(), 'sessions' => $sessions];
    @file_put_contents($cacheFile, json_encode($res, JSON_UNESCAPED_UNICODE));
    out($res);

  case 'afisha_shows':
    // все спектакли партнёра в Афише: id, название, постер — чтобы ID подставлялся по названию
    requireAuth();
    $data = readData($DATA_FILE);
    $partner = preg_replace('~\D~', '', (string)($data['theatre']['afishaPartnerId'] ?? '')) ?: '37';
    $j = http_get("https://tickets.afisha.ru/wl/{$partner}/api/shows?lang=ru");
    $d = $j ? json_decode($j, true) : null;
    if (!is_array($d) || !isset($d['shows'])) fail('Афиша не ответила', 502);
    $shows = [];
    foreach ($d['shows'] as $s) if (!empty($s['id'])) $shows[] = ['id' => (string)$s['id'], 'name' => (string)($s['name'] ?? ''), 'image' => (string)($s['image'] ?? ''), 'age' => (int)($s['age_limit'] ?? 0)];
    out(['ok' => true, 'shows' => $shows]);

  case 'afisha_poster':
    // скачать постер спектакля из Афиши в photos/
    requireAuth();
    $u = url($_GET['url'] ?? '');
    if ($u === '' || !preg_match('~^https://(store\.rambler\.ru|[a-z0-9.-]*afisha\.ru)/~', $u)) fail('Недопустимый адрес картинки');
    $bin = http_get($u, 30);
    if (!$bin) fail('Не удалось скачать постер');
    $tmp = tempnam(sys_get_temp_dir(), 'poster'); file_put_contents($tmp, $bin);
    $info = @getimagesize($tmp);
    $ext = ['image/jpeg' => '.jpg', 'image/png' => '.png', 'image/webp' => '.webp'][$info['mime'] ?? ''] ?? null;
    if (!$ext) { @unlink($tmp); fail('Постер не картинка'); }
    $name = time() . '-' . bin2hex(random_bytes(3)) . $ext;
    rename($tmp, $PHOTOS_DIR . '/' . $name);
    out(['ok' => true, 'photo' => 'photos/' . $name]);

  case 'afisha_import':
    // даты спектакля из Афиши: q — ID спектакля в Афише или ссылка на страницу спектакля на teatrdoc.ru
    requireAuth();
    $q = str($_GET['q'] ?? '', 300);
    $data = readData($DATA_FILE);
    $partner = preg_replace('~\D~', '', (string)($data['theatre']['afishaPartnerId'] ?? '')) ?: '37';
    $showId = '';
    if (preg_match('~^https?://~', $q)) {
      $html = http_get($q);
      if (!$html) fail('Не удалось загрузить страницу площадки');
      if (preg_match('~shows_id\s*:\s*(\d+)~', $html, $m)) $showId = $m[1];
      elseif (preg_match('~openModal\((\d+)\)~', $html, $m)) { // есть только сеанс — узнаём спектакль через событие
        $j = http_get("https://tickets.afisha.ru/wl/{$partner}/api/events/info?lang=ru&event_id={$m[1]}");
        $d = $j ? json_decode($j, true) : null; $showId = (string)($d['event']['show_id'] ?? '');
      }
      if ($showId === '') fail('На этой странице не нашлось виджета Афиши');
    } else {
      $showId = preg_replace('~\D~', '', $q);
      if ($showId === '') fail('Укажите ID спектакля в Афише или ссылку на teatrdoc.ru');
    }
    $show = afisha_show($partner, $showId);
    if (!$show) fail('Афиша не вернула спектакль с ID ' . $showId);
    out(['ok' => true, 'showId' => (string)$show['id'], 'name' => (string)($show['name'] ?? ''), 'image' => (string)($show['image'] ?? ''), 'age' => (int)($show['age_limit'] ?? 0), 'events' => afisha_events($show)]);

  default:
    fail('unknown action', 404);
}
