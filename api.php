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
    $item = ['name' => str($a['name'] ?? '', 100), 'role' => str($a['role'] ?? '', 100), 'scene' => str($a['scene'] ?? '', 400), 'bio' => str($a['bio'] ?? '', 600), 'roles' => str($a['roles'] ?? '', 300),
             'photo' => img($a['photo'] ?? ''), 'sbp' => url($a['sbp'] ?? ''), 'phone' => str($a['phone'] ?? '', 30), 'bank' => str($a['bank'] ?? '', 60)];
    if ($item['name'] !== '') $actors[] = $item;
  }
  foreach ($lst('plays', 50) as $p) {
    if (!is_array($p)) continue;
    $id = preg_replace('~[^a-z0-9-]~', '', mb_strtolower(str($p['id'] ?? '', 40)));
    $item = ['id' => $id ?: 'play-' . (count($plays) + 1), 'title' => str($p['title'] ?? '', 100), 'genre' => str($p['genre'] ?? '', 120), 'description' => str($p['description'] ?? '', 3000),
             'poster' => img($p['poster'] ?? ''), 'duration' => str($p['duration'] ?? '', 40), 'age' => str($p['age'] ?? '', 6), 'cast' => str($p['cast'] ?? '', 500), 'ticketUrl' => url($p['ticketUrl'] ?? ''), 'afishaShowId' => preg_replace('~\D~', '', str($p['afishaShowId'] ?? '', 40)), 'voices' => voices($p['voices'] ?? null)];
    if ($item['title'] !== '') $plays[] = $item;
  }
  $BADGES = ['premiere', 'last', 'few', 'soldout'];
  foreach ($lst('events', 200) as $e) {
    if (!is_array($e)) continue;
    $date = str($e['date'] ?? '', 10);
    if (!preg_match('~^\d{4}-\d{2}-\d{2}$~', $date)) continue;
    $badges = array_values(array_filter(is_array($e['badges'] ?? null) ? $e['badges'] : [], fn($b) => in_array($b, $BADGES, true)));
    $events[] = ['date' => $date, 'time' => str($e['time'] ?? '', 5), 'playId' => str($e['playId'] ?? '', 40), 'venue' => str($e['venue'] ?? '', 120),
                 'price' => str($e['price'] ?? '', 40), 'ticketUrl' => url($e['ticketUrl'] ?? ''), 'afishaSessionId' => preg_replace('~\D~', '', str($e['afishaSessionId'] ?? '', 40)), 'note' => str($e['note'] ?? '', 120), 'badges' => $badges];
  }
  usort($events, fn($x, $y) => strcmp($x['date'] . $x['time'], $y['date'] . $y['time']));
  foreach ($lst('reviews', 100) as $r) {
    if (!is_array($r)) continue;
    $item = ['text' => str($r['text'] ?? '', 800), 'author' => str($r['author'] ?? '', 100), 'source' => str($r['source'] ?? '', 100), 'url' => url($r['url'] ?? ''), 'playId' => str($r['playId'] ?? '', 40)];
    if ($item['text'] !== '') $reviews[] = $item;
  }
  foreach ($lst('gallery', 200) as $g) {
    if (!is_array($g)) continue;
    $item = ['photo' => img($g['photo'] ?? ''), 'caption' => str($g['caption'] ?? '', 140), 'alt' => str($g['alt'] ?? '', 200), 'playId' => str($g['playId'] ?? '', 40)];
    if ($item['photo'] !== '') $gallery[] = $item;
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
function snapshot(string $dataFile, string $dir): void {
  if (!is_file($dataFile)) return;
  @copy($dataFile, $dir . '/' . date('Y-m-d-His') . '-' . substr((string)microtime(true), -3) . '.json');
  $files = glob($dir . '/*.json') ?: []; sort($files);
  while (count($files) > 20) @unlink(array_shift($files));
}
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
    if ($PASSWORD === '' || $PASSWORD === $DEFAULT_PASSWORD) fail('Сначала задайте пароль в файле config.php на хостинге', 403);
    $_SESSION['attempts'] = (int)($_SESSION['attempts'] ?? 0);
    if ($_SESSION['attempts'] >= 5 && time() - (int)($_SESSION['blocked_at'] ?? 0) < 60) fail('Слишком много попыток, подождите минуту', 429);
    if (hash_equals($PASSWORD, (string)(body()['password'] ?? ''))) {
      session_regenerate_id(true);
      $_SESSION['authed'] = true; $_SESSION['attempts'] = 0;
      out(['ok' => true]);
    }
    $_SESSION['attempts']++;
    if ($_SESSION['attempts'] >= 5) $_SESSION['blocked_at'] = time();
    sleep(1);
    fail('Неверный пароль', 401);

  case 'logout':
    $_SESSION = [];
    session_destroy();
    out(['ok' => true]);

  case 'data':
    if ($method === 'GET') out(readData($DATA_FILE));
    if ($method !== 'PUT' && $method !== 'POST') fail('PUT only', 405);
    requireAuth();
    $data = sanitize(body());
    snapshot($DATA_FILE, $HISTORY_DIR);
    $tmp = $DATA_FILE . '.tmp';
    if (file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) === false) fail('Не удалось записать data/data.json — проверьте права на папку data', 500);
    rename($tmp, $DATA_FILE);
    out(['ok' => true, 'data' => $data]);

  case 'history':
    // список сохранённых версий (последние 20)
    requireAuth();
    out(['ok' => true, 'items' => historyList($HISTORY_DIR)]);

  case 'restore':
    // вернуть версию: текущая перед этим тоже сохраняется в историю
    requireAuth();
    if ($method !== 'POST') fail('POST only', 405);
    $id = preg_replace('~[^0-9-]~', '', (string)(body()['id'] ?? ''));
    $f = $HISTORY_DIR . '/' . $id . '.json';
    if ($id === '' || !is_file($f)) fail('Версия не найдена');
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
        if (basename($rel) === 'password.txt') continue;
        $zip->addFile($file->getPathname(), $rel);
      }
    }
    $zip->close();
    header_remove('Content-Type');
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="rat-theater-backup-' . date('Y-m-d-Hi') . '.zip"');
    header('Content-Length: ' . filesize($zipPath));
    readfile($zipPath); @unlink($zipPath); exit;

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
