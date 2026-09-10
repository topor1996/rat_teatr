<?php
// Картинка-превью для соцсетей (og:image) 1200×630: постер, название, ближайший показ, остаток билетов.
// og.php?id=<спектакль> — карточка спектакля; og.php — карточка театра с ближайшим показом.
// Рисует GD, кэширует в data/og/, перерисовывает, когда меняются постер, дата или остаток мест.
declare(strict_types=1);
$ROOT = __DIR__;
$d = json_decode((string)@file_get_contents($ROOT . '/data/data.json'), true) ?: [];
$th = $d['theatre'] ?? []; $name = ($th['name'] ?? '') ?: 'Театр RAT';
$id = preg_replace('~[^\w-]~', '', (string)($_GET['id'] ?? ''));
$plays = array_values(array_filter($d['plays'] ?? [], fn($p) => empty($p['hidden'])));
$byId = []; foreach ($plays as $p) $byId[$p['id']] = $p;
$play = $byId[$id] ?? null;
$fallback = $play && !empty($play['poster']) ? $play['poster'] : 'assets/og-cover.png';
if (!function_exists('imagecreatetruecolor') || !function_exists('imagettftext')) { header('Location: ' . $fallback, true, 302); exit; }

$today = date('Y-m-d');
$events = array_values(array_filter($d['events'] ?? [], fn($e) => empty($e['hidden']) && ($e['date'] ?? '') >= $today && (!$play || ($e['playId'] ?? '') === $play['id']) && (empty($e['playId']) || isset($byId[$e['playId']]))));
usort($events, fn($a, $b) => strcmp($a['date'] . ($a['time'] ?? ''), $b['date'] . ($b['time'] ?? '')));
$next = $events[0] ?? null;
$status = json_decode((string)@file_get_contents($ROOT . '/data/afisha-status.json'), true) ?: [];
$count = null;
if ($next) { $sid = preg_replace('~\D~', '', (string)($next['afishaSessionId'] ?? '')); if ($sid !== '' && isset($status['sessions'][$sid])) $count = (int)$status['sessions'][$sid]['count']; }
if ($next && in_array('soldout', $next['badges'] ?? [], true)) $count = 0;
$bucket = $count === null ? 'n' : ($count === 0 ? '0' : ($count <= 5 ? '5' : ($count <= 15 ? '15' : ($count <= 30 ? '30' : 'm'))));
$poster = $play && !empty($play['poster']) && is_file($ROOT . '/' . $play['poster']) ? $ROOT . '/' . $play['poster'] : null;
$key = md5(json_encode([$id, $play['title'] ?? $name, $play['genre'] ?? '', $poster ? filemtime($poster) : 0, $next['date'] ?? '', $next['time'] ?? '', $next['playId'] ?? '', $bucket, $th['venue'] ?? '', 3]));
$dir = $ROOT . '/data/og'; @mkdir($dir, 0755, true);
$file = $dir . '/' . ($id ?: 'site') . '-' . $key . '.png';
header('Content-Type: image/png'); header('Cache-Control: public, max-age=600');
if (is_file($file)) { readfile($file); exit; }
foreach (glob($dir . '/' . ($id ?: 'site') . '-*.png') ?: [] as $old) @unlink($old);

$W = 1200; $H = 630; $im = imagecreatetruecolor($W, $H); imagealphablending($im, true);
$F = $ROOT . '/fonts/og/'; $OSW = $F . 'oswald-700.ttf'; $OSW5 = $F . 'oswald-500.ttf'; $SPRAY = $F . 'spray.ttf'; $MONO = $F . 'ptmono.ttf';
$c = fn($r, $g, $b) => imagecolorallocate($im, $r, $g, $b);
$black = $c(10, 10, 10); $white = $c(255, 255, 255); $acid = $c(201, 255, 61); $muted = $c(156, 151, 138); $red = $c(255, 59, 47); $paper = $c(232, 227, 210);
imagefilledrectangle($im, 0, 0, $W, $H, $black);
// лёгкое зерно, как на сайте
mt_srand(7); for ($i = 0; $i < 9000; $i++) { $x = mt_rand(0, $W - 1); $y = mt_rand(0, $H - 1); $v = mt_rand(18, 40); imagesetpixel($im, $x, $y, $c($v, $v, $v)); }
// текст с переносом по ширине; возвращает нижнюю координату
function drawWrap($im, string $text, string $font, float $size, int $x, int $y, int $maxW, $color, float $lh = 1.05, int $maxLines = 3): int {
  $words = preg_split('~\s+~u', trim($text)); $lines = []; $cur = '';
  foreach ($words as $w) { $try = $cur === '' ? $w : $cur . ' ' . $w; $b = imagettfbbox($size, 0, $font, $try); if ($b[2] - $b[0] > $maxW && $cur !== '') { $lines[] = $cur; $cur = $w; } else $cur = $try; }
  if ($cur !== '') $lines[] = $cur;
  if (count($lines) > $maxLines) { $lines = array_slice($lines, 0, $maxLines); $lines[$maxLines - 1] = rtrim($lines[$maxLines - 1], ' ,.') . '…'; }
  $step = (int)round($size * $lh * 1.33); $yy = $y;
  foreach ($lines as $ln) { $yy += $step; imagettftext($im, $size, 0, $x, $yy, $color, $font, $ln); }
  return $yy;
}
$left = 64; $textW = $W - $left - 64;
if ($poster) {
  // постер слева, обрезка под 440×630, чуть темнее, чтобы текст читался у стыка
  $src = @imagecreatefromstring((string)file_get_contents($poster));
  if ($src) {
    $pw = imagesx($src); $ph = imagesy($src); $tw = 440; $thh = $H; $scale = max($tw / $pw, $thh / $ph); $sw = (int)($tw / $scale); $sh = (int)($thh / $scale);
    imagecopyresampled($im, $src, 0, 0, (int)(($pw - $sw) / 2), (int)(($ph - $sh) / 2), $tw, $thh, $sw, $sh); imagedestroy($src);
    // рваный край стыка: зубцы чёрным
    mt_srand(3); $pts = [$tw + 30, 0]; for ($y = 0; $y <= $H; $y += 18) { $pts[] = $tw - mt_rand(0, 22); $pts[] = $y; } $pts[] = $tw + 30; $pts[] = $H; imagefilledpolygon($im, $pts, $black);
    // полоса скотча
    $tape = imagecolorallocatealpha($im, 232, 220, 160, 30); imagefilledpolygon($im, [$tw - 70, 40, $tw + 30, 26, $tw + 36, 52, $tw - 64, 66], $tape);
  }
  $left = 440 + 56; $textW = $W - $left - 56;
}
// имя театра + штамп
imagettftext($im, 22, 0, $left, 78, $muted, $OSW5, mb_strtoupper($name) . '  ·  ' . mb_strtoupper((string)($th['venue'] ?? '')));
$y = 96;
if ($play) {
  $size = 76; $t = mb_strtoupper($play['title']);
  while ($size > 40) { $b = imagettfbbox($size, 0, $OSW, $t); if ($b[2] - $b[0] <= $textW * 2.2) break; $size -= 6; }
  $y = drawWrap($im, $t, $OSW, $size, $left, $y, $textW, $white, .98, 3);
  if (!empty($play['genre'])) { $y += 34; imagettftext($im, 20, 0, $left, $y, $muted, $MONO, mb_strtoupper(mb_substr($play['genre'], 0, 60))); }
} else {
  $y = drawWrap($im, mb_strtoupper($name), $OSW, 96, $left, $y, $textW, $white, .95, 2);
  if (!empty($th['tagline'])) { $y = drawWrap($im, $th['tagline'], $MONO, 20, $left, $y + 16, $textW, $muted, 1.2, 2); }
}
$months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
$days = ['вс','пн','вт','ср','чт','пт','сб'];
if ($next) {
  [$yy, $mm, $dd] = array_map('intval', explode('-', $next['date'])); $dow = $days[(int)date('w', mktime(0, 0, 0, $mm, $dd, $yy))];
  $by = $H - 224; imagettftext($im, 18, 0, $left, $by, $muted, $OSW5, $play ? 'БЛИЖАЙШИЙ ПОКАЗ' : 'БЛИЖАЙШИЙ ПОКАЗ · ' . mb_strtoupper((string)($byId[$next['playId'] ?? '']['title'] ?? '')));
  $dateStr = $dd . ' ' . $months[$mm - 1]; imagettftext($im, 58, 0, $left, $by + 74, $acid, $SPRAY, $dateStr);
  $b = imagettfbbox(58, 0, $SPRAY, $dateStr);
  imagettftext($im, 26, 0, $left + ($b[2] - $b[0]) + 26, $by + 68, $white, $OSW5, $dow . (($next['time'] ?? '') ? ' · ' . $next['time'] : ''));
  $badge = $count === null ? '' : ($count === 0 ? 'БИЛЕТОВ НЕТ' : ($count <= 30 ? 'ОСТАЛОСЬ ' . $count . ' ' . ($count % 10 === 1 && $count !== 11 ? 'МЕСТО' : (($count % 10 >= 2 && $count % 10 <= 4 && ($count < 10 || $count > 20)) ? 'МЕСТА' : 'МЕСТ')) : ''));
  if ($badge !== '') {
    $bg = $count === 0 ? $c(85, 85, 85) : ($count <= 5 ? $red : $acid); $fg = $count === 0 || $count <= 5 ? $white : $black;
    $bb = imagettfbbox(24, 0, $OSW, $badge); $bw = $bb[2] - $bb[0] + 36; $bx = $left; $byy = $by + 100;
    imagefilledpolygon($im, [$bx, $byy + 4, $bx + $bw, $byy - 2, $bx + $bw + 3, $byy + 46, $bx + 3, $byy + 52], $bg);
    imagettftext($im, 24, 2, $bx + 18, $byy + 40, $fg, $OSW, $badge);
  }
} else {
  imagettftext($im, 22, 0, $left, $H - 120, $muted, $OSW5, $play ? 'ДАТЫ СКОРО · СЛЕДИТЕ В СОЦСЕТЯХ' : 'АФИША И БИЛЕТЫ НА САЙТЕ');
}
// низ: адрес сайта и стикер RAT
$host = preg_replace('~^https?://~', '', (string)($th['site'] ?? '')) ?: ($_SERVER['HTTP_HOST'] ?? 'rat-theater.rf.gd');
imagettftext($im, 16, 0, $left, $H - 30, $muted, $MONO, $host);
$sx = $W - 150; $sy = $H - 92; imagefilledpolygon($im, [$sx, $sy + 6, $sx + 108, $sy - 4, $sx + 112, $sy + 44, $sx + 4, $sy + 54], $acid);
imagettftext($im, 26, 4, $sx + 14, $sy + 40, $black, $SPRAY, 'RAT');
imagepng($im, $file, 6); imagepng($im); imagedestroy($im);
