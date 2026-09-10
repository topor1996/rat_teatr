<?php
// Бэкенд админки для обычного PHP-хостинга (InfinityFree, любой shared-хостинг с PHP 7.4+).
// Те же функции, что у server.js: вход по паролю, чтение/запись data/data.json, загрузка фото в photos/.
// Адреса: api.php?a=me | login | logout | data | upload
declare(strict_types=1);

$ROOT = __DIR__;
$DATA_DIR = $ROOT . '/data';
$DATA_FILE = $DATA_DIR . '/data.json';
$PHOTOS_DIR = $ROOT . '/photos';
$DEFAULT_PASSWORD = 'смените-меня';

$config = file_exists($ROOT . '/config.php') ? require $ROOT . '/config.php' : [];
$PASSWORD = (string)($config['password'] ?? '');

@mkdir($DATA_DIR, 0755, true);
@mkdir($PHOTOS_DIR, 0755, true);

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
             'poster' => img($p['poster'] ?? ''), 'duration' => str($p['duration'] ?? '', 40), 'age' => str($p['age'] ?? '', 6), 'cast' => str($p['cast'] ?? '', 500), 'ticketUrl' => url($p['ticketUrl'] ?? ''), 'afishaShowId' => preg_replace('~\D~', '', str($p['afishaShowId'] ?? '', 40))];
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
    $item = ['photo' => img($g['photo'] ?? ''), 'caption' => str($g['caption'] ?? '', 140), 'playId' => str($g['playId'] ?? '', 40)];
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
    $tmp = $DATA_FILE . '.tmp';
    if (file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) === false) fail('Не удалось записать data/data.json — проверьте права на папку data', 500);
    rename($tmp, $DATA_FILE);
    out(['ok' => true, 'data' => $data]);

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
      $ext = ['video/mp4' => '.mp4', 'video/webm' => '.webm', 'video/quicktime' => '.mov'][$mime] ?? null;
      if (!$ext) fail('Нужен файл JPG, PNG, WebP или видео MP4/WebM');
      if ($f['size'] > 10 * 1024 * 1024) fail('Видео больше 10 МБ — сожмите его (5–10 секунд, 720p)');
    }
    $name = time() . '-' . bin2hex(random_bytes(3)) . $ext;
    if (!move_uploaded_file($f['tmp_name'], $PHOTOS_DIR . '/' . $name)) fail('Не удалось сохранить файл — проверьте права на папку photos', 500);
    out(['ok' => true, 'photo' => 'photos/' . $name]);

  default:
    fail('unknown action', 404);
}
