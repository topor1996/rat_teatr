<?php
// Живой календарь театра (iCalendar): зритель подписывается один раз в Google/Apple Calendar,
// новые даты появляются у него сами. Адрес: /calendar.ics (переписывается на этот файл в .htaccess).
declare(strict_types=1);
$root = __DIR__;
$d = json_decode((string)@file_get_contents($root . '/data/data.json'), true) ?: [];
$th = $d['theatre'] ?? []; $name = ($th['name'] ?? '') ?: 'Театр RAT';
$plays = []; foreach ($d['plays'] ?? [] as $p) if (empty($p['hidden'])) $plays[$p['id']] = $p;
$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$base = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/') . '/';
$esc = fn($s) => str_replace(["\\", ";", ",", "\n"], ["\\\\", "\;", "\\,", "\\n"], (string)$s);
$fold = function (string $line): string { $out = ''; while (strlen($line) > 74) { $cut = mb_strcut($line, 0, 74); $out .= $cut . "\r\n "; $line = substr($line, strlen($cut)); } return $out . $line; };
$tz = new DateTimeZone('Europe/Moscow'); $utc = new DateTimeZone('UTC');
$since = date('Y-m-d', strtotime('-30 days'));
$lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//' . $esc($name) . '//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
  'X-WR-CALNAME:' . $esc($name), 'X-WR-TIMEZONE:Europe/Moscow', 'X-PUBLISHED-TTL:PT6H', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H'];
foreach ($d['events'] ?? [] as $e) {
  if (!empty($e['hidden']) || empty($e['date']) || $e['date'] < $since) continue;
  if (!empty($e['playId']) && !isset($plays[$e['playId']])) continue;
  $p = $plays[$e['playId'] ?? ''] ?? null; $title = $p['title'] ?? (($e['note'] ?? '') ?: 'Спектакль');
  $time = ($e['time'] ?? '') ?: '19:00';
  $start = new DateTime($e['date'] . ' ' . $time, $tz); $mins = 90;
  if ($p && preg_match('~(\d+)\s*час~u', (string)($p['duration'] ?? ''), $m)) { $mins = (int)$m[1] * 60; if (preg_match('~(\d+)\s*мин~u', $p['duration'], $mm)) $mins += (int)$mm[1]; }
  elseif ($p && preg_match('~(\d+)\s*мин~u', (string)($p['duration'] ?? ''), $mm)) $mins = (int)$mm[1];
  $end = (clone $start)->modify('+' . $mins . ' minutes');
  $url = $p ? $base . 'play.html?id=' . rawurlencode($p['id']) . '&utm_source=calendar' : $base . '?utm_source=calendar';
  $ticket = ($e['ticketUrl'] ?? '') ?: ($p['ticketUrl'] ?? '') ?: ($th['ticketsUrl'] ?? '');
  $desc = trim(($p['genre'] ?? '') . ($p ? "\n" . mb_substr($p['description'] ?? '', 0, 300) : '') . ($e['note'] ?? '' ? "\n" . $e['note'] : '') . ($ticket ? "\nБилеты: " . $ticket : '') . "\n" . $url);
  $sold = in_array('soldout', $e['badges'] ?? [], true);
  $lines[] = 'BEGIN:VEVENT';
  $lines[] = 'UID:' . $e['date'] . '-' . str_replace(':', '', $time) . '-' . ($e['playId'] ?? 'show') . '@' . ($_SERVER['HTTP_HOST'] ?? 'rat-theater');
  $lines[] = 'DTSTAMP:' . gmdate('Ymd\THis\Z');
  $lines[] = 'DTSTART:' . $start->setTimezone($utc)->format('Ymd\THis\Z');
  $lines[] = 'DTEND:' . $end->setTimezone($utc)->format('Ymd\THis\Z');
  $lines[] = $fold('SUMMARY:' . $esc(($sold ? '[аншлаг] ' : '') . $title . ' — ' . $name));
  $lines[] = $fold('LOCATION:' . $esc((($e['venue'] ?? '') ?: ($th['venue'] ?? '')) . (($th['address'] ?? '') ? ', ' . $th['address'] : '')));
  $lines[] = $fold('DESCRIPTION:' . $esc($desc));
  $lines[] = 'URL:' . $url;
  $lines[] = 'STATUS:CONFIRMED';
  $lines[] = 'BEGIN:VALARM'; $lines[] = 'TRIGGER:-PT24H'; $lines[] = 'ACTION:DISPLAY'; $lines[] = $fold('DESCRIPTION:' . $esc('Завтра: ' . $title)); $lines[] = 'END:VALARM';
  $lines[] = 'END:VEVENT';
}
$lines[] = 'END:VCALENDAR';
header('Content-Type: text/calendar; charset=utf-8');
header('Content-Disposition: inline; filename="rat-theater.ics"');
header('Cache-Control: public, max-age=1800');
echo implode("\r\n", $lines) . "\r\n";
