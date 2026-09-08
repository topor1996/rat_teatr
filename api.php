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
function sanitize(array $in): array {
  $show = is_array($in['show'] ?? null) ? $in['show'] : [];
  $actors = is_array($in['actors'] ?? null) ? array_slice($in['actors'], 0, 50) : [];
  $outActors = [];
  foreach ($actors as $a) {
    if (!is_array($a)) continue;
    $photo = str($a['photo'] ?? '');
    $sbp = str($a['sbp'] ?? '');
    $item = [
      'name'  => str($a['name'] ?? '', 100),
      'role'  => str($a['role'] ?? '', 100),
      'scene' => str($a['scene'] ?? '', 400),
      'photo' => preg_match('~^photos/[\w.-]+$~', $photo) ? $photo : '',
      'sbp'   => preg_match('~^https?://\S+$~', $sbp) ? $sbp : '',
      'phone' => str($a['phone'] ?? '', 30),
      'bank'  => str($a['bank'] ?? '', 60),
    ];
    if ($item['name'] !== '') $outActors[] = $item;
  }
  return [
    'show' => ['theatre' => str($show['theatre'] ?? '', 100), 'title' => str($show['title'] ?? '', 100), 'dates' => str($show['dates'] ?? '', 100)],
    'actors' => $outActors,
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
    if ($method !== 'POST') fail('POST only', 405);
    requireAuth();
    $f = $_FILES['photo'] ?? null;
    if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
      $err = (int)($f['error'] ?? 0);
      fail(in_array($err, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) ? 'Файл слишком большой для этого хостинга' : 'Нужен файл JPG, PNG или WebP до 8 МБ');
    }
    if ($f['size'] > 8 * 1024 * 1024) fail('Файл больше 8 МБ');
    $info = @getimagesize($f['tmp_name']);
    $ext = ['image/jpeg' => '.jpg', 'image/png' => '.png', 'image/webp' => '.webp'][$info['mime'] ?? ''] ?? null;
    if (!$ext) fail('Нужен файл JPG, PNG или WebP');
    $name = time() . '-' . bin2hex(random_bytes(3)) . $ext;
    if (!move_uploaded_file($f['tmp_name'], $PHOTOS_DIR . '/' . $name)) fail('Не удалось сохранить фото — проверьте права на папку photos', 500);
    out(['ok' => true, 'photo' => 'photos/' . $name]);

  default:
    fail('unknown action', 404);
}
