<?php
// sitemap.xml из данных сайта (Apache перенаправляет sitemap.xml сюда)
header('Content-Type: application/xml; charset=utf-8');
$d = json_decode((string)@file_get_contents(__DIR__ . '/data/data.json'), true) ?: [];
$base = (!empty($_SERVER['HTTPS']) ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'rat-theater.rf.gd');
$urls = ['/', '/golos'];
foreach ($d['plays'] ?? [] as $p) if (!empty($p['id'])) $urls[] = '/play.html?id=' . rawurlencode($p['id']);
echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
foreach ($urls as $u) echo '<url><loc>' . htmlspecialchars($base . $u, ENT_XML1) . '</loc></url>';
echo '</urlset>';
