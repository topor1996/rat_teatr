<?php
// sitemap.xml из данных сайта, с картинками и видео спектаклей (Apache перенаправляет sitemap.xml сюда)
header('Content-Type: application/xml; charset=utf-8');
$d = json_decode((string)@file_get_contents(__DIR__ . '/data/data.json'), true) ?: [];
$base = (!empty($_SERVER['HTTPS']) ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'rat-theater.rf.gd');
$x = fn($v) => htmlspecialchars((string)$v, ENT_XML1 | ENT_QUOTES, 'UTF-8');
echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">';
echo '<url><loc>' . $x($base . '/') . '</loc></url><url><loc>' . $x($base . '/golos') . '</loc></url>';
foreach ($d['plays'] ?? [] as $p) {
  if (empty($p['id']) || !empty($p['hidden'])) continue;
  echo '<url><loc>' . $x($base . '/play.html?id=' . rawurlencode($p['id'])) . '</loc>';
  if (!empty($p['poster'])) echo '<image:image><image:loc>' . $x($base . '/' . $p['poster']) . '</image:loc><image:title>' . $x($p['title']) . '</image:title></image:image>';
  foreach ($p['media'] ?? [] as $m) {
    if (!empty($m['hidden']) || empty($m['src'])) continue;
    if (($m['type'] ?? '') === 'video') {
      $thumb = $m['poster'] ?: ($p['poster'] ?: 'assets/og-cover.png');
      echo '<video:video><video:thumbnail_loc>' . $x($base . '/' . $thumb) . '</video:thumbnail_loc><video:title>' . $x($m['caption'] ?: 'Видео: ' . $p['title']) . '</video:title><video:description>' . $x($m['alt'] ?: 'Видео со спектакля «' . $p['title'] . '»') . '</video:description><video:content_loc>' . $x($base . '/' . $m['src']) . '</video:content_loc></video:video>';
    } else {
      echo '<image:image><image:loc>' . $x($base . '/' . $m['src']) . '</image:loc>' . ($m['caption'] ? '<image:caption>' . $x($m['caption']) . '</image:caption>' : '') . '</image:image>';
    }
  }
  echo '</url>';
}
echo '</urlset>';
