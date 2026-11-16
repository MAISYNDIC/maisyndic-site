<?php
/**
 * mäisyndic — réception des mesures d'audience envoyées par site.js.
 * Rien n'est renvoyé au navigateur (204). Voir lib/stats.php.
 */

declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/stats.php';

header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(204);
    exit;
}

$ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
$origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
$in = json_decode((string) file_get_contents('php://input', false, null, 0, 4096), true);

if (stats_is_bot($ua) || ($origin !== '' && $origin !== STATS_SITE) || !is_array($in)) {
    http_response_code(204);
    exit;
}

$event = (string) ($in['e'] ?? '');
$path = (string) ($in['p'] ?? '');
if ($event === 'lead' || !in_array($event, STATS_EVENTS, true) || !preg_match('#^/[A-Za-z0-9/._-]{0,150}$#', $path)) {
    http_response_code(204);
    exit;
}

$lang = (string) ($in['l'] ?? '');
$lang = in_array($lang, ['fr', 'de', 'en', 'pt'], true) ? $lang : '';
$row = ['e' => $event, 'p' => $path, 'l' => $lang, 'm' => preg_match('/Mobi|Android|iPhone|iPod/i', $ua) ? 1 : 0];

if ($event === 'view') {
    $ref = (string) ($in['r'] ?? '');
    $host = strtolower((string) (parse_url($ref, PHP_URL_HOST) ?: ''));
    $utm = substr(preg_replace('/[^A-Za-z0-9._-]/', '', (string) ($in['u'] ?? '')) ?? '', 0, 40);
    $internal = in_array($host, ['maisyndic.lu', 'www.maisyndic.lu'], true);
    if (!$internal || $utm !== '') {
        // Entrée sur le site : seule une visite qui arrive de l'extérieur compte comme une visite.
        $row['n'] = 1;
        $row['s'] = stats_source($internal ? '' : $host, $utm);
    }
}

stats_record($row);
http_response_code(204);

// Le rapport du lundi part après la réponse, sans ralentir le visiteur.
if (function_exists('fastcgi_finish_request')) {
    fastcgi_finish_request();
}
stats_maybe_send_report();
