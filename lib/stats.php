<?php
/**
 * mäisyndic — mesure d'audience anonyme.
 *
 * Aucune donnée personnelle : ni cookie, ni adresse IP, ni identifiant. Chaque ligne
 * enregistrée contient seulement l'heure, la page, le site d'origine (nom de domaine),
 * la langue de la page, le type d'appareil (téléphone ou non, déduit du navigateur)
 * et l'action (page vue, calculateur utilisé, clic sur le téléphone…).
 * Fichiers : ../data/stats/AAAA-MM.jsonl, hors du dossier public, effacés après 25 mois.
 */

declare(strict_types=1);

date_default_timezone_set('Europe/Luxembourg');

const STATS_EVENTS = ['view', 'calc', 'tel', 'mail', 'google', 'facebook', 'whatsapp', 'lead'];
const STATS_KEEP_MONTHS = 25;
const STATS_SITE = 'https://maisyndic.lu';

function stats_dir(): string
{
    $dir = dirname(__DIR__, 2) . '/data/stats';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    return $dir;
}

/** Robots, aperçus de liens et navigateurs automatisés : ignorés. */
function stats_is_bot(string $ua): bool
{
    return $ua === '' || (bool) preg_match('/bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|curl|wget|python|java\/|httpclient|okhttp|scrapy|phantom|selenium|puppeteer|playwright/i', $ua);
}

/** Nom lisible de la source d'une visite, à partir du domaine d'origine ou du paramètre utm_source. */
function stats_source(string $host, string $utm): string
{
    if ($utm !== '') {
        $u = strtolower($utm);
        $known = ['facebook' => 'Facebook', 'fb' => 'Facebook', 'linkedin' => 'LinkedIn', 'google' => 'Google',
                  'gbp' => 'Fiche Google', 'instagram' => 'Instagram', 'newsletter' => 'E-mail', 'email' => 'E-mail'];
        return $known[$u] ?? ucfirst($u);
    }
    if ($host === '') {
        return 'Accès direct';
    }
    $rules = [
        '/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/' => 'ChatGPT',
        '/(^|\.)perplexity\.ai$/' => 'Perplexity',
        '/(^|\.)claude\.ai$/' => 'Claude',
        '/^gemini\.google\.com$/' => 'Gemini',
        '/(^|\.)copilot\.microsoft\.com$/' => 'Copilot',
        '/(^|\.)google\.[a-z.]+$/' => 'Google',
        '/(^|\.)bing\.com$/' => 'Bing',
        '/(^|\.)duckduckgo\.com$/' => 'DuckDuckGo',
        '/(^|\.)ecosia\.org$/' => 'Ecosia',
        '/(^|\.)qwant\.com$/' => 'Qwant',
        '/(^|\.)yahoo\.[a-z.]+$/' => 'Yahoo',
        '/(^|\.)facebook\.com$|^fb\.me$/' => 'Facebook',
        '/(^|\.)instagram\.com$/' => 'Instagram',
        '/(^|\.)linkedin\.com$|^lnkd\.in$/' => 'LinkedIn',
        '/(^|\.)editus\.lu$/' => 'Editus',
    ];
    foreach ($rules as $re => $name) {
        if (preg_match($re, $host)) {
            return $name;
        }
    }
    return preg_replace('/^www\./', '', $host) ?? $host;
}

/** Ajoute une ligne au fichier du mois. $row : e, p, s, n (entrée sur le site), l, m (téléphone). */
function stats_record(array $row): void
{
    if (!in_array($row['e'] ?? '', STATS_EVENTS, true)) {
        return;
    }
    $file = stats_dir() . '/' . date('Y-m') . '.jsonl';
    if (is_file($file) && filesize($file) > 50 * 1024 * 1024) {
        return; // garde-fou contre un envoi massif
    }
    $line = ['t' => time()] + $row;
    @file_put_contents($file, json_encode($line, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
}

/** Lignes enregistrées entre deux instants (inclus). */
function stats_rows(int $from, int $to): array
{
    $rows = [];
    $m = strtotime(date('Y-m-01', $from));
    while ($m <= $to) {
        $file = stats_dir() . '/' . date('Y-m', $m) . '.jsonl';
        if (is_file($file)) {
            $fh = fopen($file, 'r');
            while ($fh && ($l = fgets($fh)) !== false) {
                $r = json_decode($l, true);
                if (is_array($r) && isset($r['t']) && $r['t'] >= $from && $r['t'] <= $to) {
                    $rows[] = $r;
                }
            }
            if ($fh) {
                fclose($fh);
            }
        }
        $m = strtotime('+1 month', $m);
    }
    return $rows;
}

/** Chiffres d'une période : visites, pages vues, actions, sources, pages, langues, appareils, jours. */
function stats_summary(int $from, int $to): array
{
    $s = ['visits' => 0, 'views' => 0, 'events' => array_fill_keys(STATS_EVENTS, 0), 'sources' => [], 'pages' => [],
          'entries' => [], 'langs' => [], 'mobile' => 0, 'days' => [], 'leads' => []];
    for ($d = strtotime(date('Y-m-d', $from)); $d <= $to; $d = strtotime('+1 day', $d)) {
        $s['days'][date('Y-m-d', $d)] = 0;
    }
    foreach (stats_rows($from, $to) as $r) {
        $e = $r['e'] ?? '';
        if (isset($s['events'][$e])) {
            $s['events'][$e]++;
        }
        $p = (string) ($r['p'] ?? '');
        if ($e === 'lead') {
            $s['leads'][$p] = ($s['leads'][$p] ?? 0) + 1;
        }
        if ($e !== 'view') {
            continue;
        }
        $s['views']++;
        $s['pages'][$p] = ($s['pages'][$p] ?? 0) + 1;
        if (!empty($r['n'])) {
            $s['visits']++;
            $src = (string) ($r['s'] ?? 'Accès direct');
            $s['sources'][$src] = ($s['sources'][$src] ?? 0) + 1;
            $s['entries'][$p] = ($s['entries'][$p] ?? 0) + 1;
            $l = (string) ($r['l'] ?? '?');
            $s['langs'][$l] = ($s['langs'][$l] ?? 0) + 1;
            if (!empty($r['m'])) {
                $s['mobile']++;
            }
            $day = date('Y-m-d', (int) $r['t']);
            if (isset($s['days'][$day])) {
                $s['days'][$day]++;
            }
        }
    }
    foreach (['sources', 'pages', 'entries', 'langs', 'leads'] as $k) {
        arsort($s[$k]);
    }
    return $s;
}

/** Efface les fichiers de plus de 25 mois. */
function stats_purge(): void
{
    $limit = date('Y-m', strtotime('-' . STATS_KEEP_MONTHS . ' months'));
    foreach (glob(stats_dir() . '/*.jsonl') ?: [] as $f) {
        if (basename($f, '.jsonl') < $limit) {
            @unlink($f);
        }
    }
}

/** Libellé lisible d'une adresse de page : /fr/tarifs.html -> FR · tarifs */
function stats_page_label(string $p): string
{
    if (preg_match('#^/(fr|de|en|pt)/(.*)$#', $p, $m)) {
        $name = preg_replace('/\.html$/', '', $m[2]) ?: 'accueil';
        return strtoupper($m[1]) . ' · ' . $name;
    }
    return $p === '/' ? 'accueil (choix de langue)' : $p;
}

function stats_fmt_period(int $from, int $to): string
{
    $mois = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    $a = (int) date('j', $from) . ($from === strtotime(date('Y-m-01', $from)) ? 'er' : '');
    return 'du ' . $a . ' ' . $mois[(int) date('n', $from)] . ' au ' . (int) date('j', $to) . ' ' . $mois[(int) date('n', $to)] . ' ' . date('Y', $to);
}

/**
 * Rapport du lundi : envoyé une fois par semaine, au premier passage d'un visiteur à partir
 * du lundi 7 h (pas besoin de tâche planifiée). Couvre la semaine précédente, du lundi au dimanche.
 */
function stats_maybe_send_report(): void
{
    $now = time();
    $monday = strtotime('monday this week', $now);
    if ($now < $monday + 7 * 3600) {
        return;
    }
    $week = date('o-\WW', $monday);
    $mark = stats_dir() . '/last-report.txt';
    $fh = @fopen($mark, 'c+');
    if (!$fh || !flock($fh, LOCK_EX | LOCK_NB)) {
        return;
    }
    $last = trim((string) stream_get_contents($fh));
    if ($last === '' ) {
        // Premier passage : on note la semaine en cours sans envoyer un rapport vide.
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, $week);
        flock($fh, LOCK_UN);
        fclose($fh);
        return;
    }
    if ($last >= $week) {
        flock($fh, LOCK_UN);
        fclose($fh);
        return;
    }
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, $week);
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);

    $from = strtotime('-7 days', $monday);
    $to = $monday - 1;
    [$subject, $body] = stats_report_text($from, $to);
    require_once __DIR__ . '/mailer.php';
    send_mail(TO_ADDRESS, $subject, $body, TO_ADDRESS);
    stats_purge();
}

function stats_report_text(int $from, int $to): array
{
    $s = stats_summary($from, $to);
    $p = stats_summary($from - 7 * 86400, $from - 1);
    $diff = function (int $a, int $b): string {
        if ($b === 0) {
            return $a > 0 ? ' (nouveau)' : '';
        }
        $pct = (int) round(($a - $b) / $b * 100);
        return ' (' . ($pct >= 0 ? '+' : '') . $pct . ' % par rapport à la semaine précédente)';
    };
    $ev = $s['events'];
    $top = function (array $list, int $n, callable $label): string {
        $out = '';
        foreach (array_slice($list, 0, $n, true) as $k => $v) {
            $out .= '  - ' . $label((string) $k) . ' : ' . $v . "\n";
        }
        return $out !== '' ? $out : "  (aucune)\n";
    };
    $period = stats_fmt_period($from, $to);
    $body = "Bonjour,\n\nVoici les statistiques du site maisyndic.lu " . $period . ".\n\n"
        . 'Visites : ' . $s['visits'] . $diff($s['visits'], $p['visits']) . "\n"
        . 'Pages vues : ' . $s['views'] . "\n"
        . 'Demandes de devis reçues : ' . $ev['lead'] . "\n"
        . 'Calculateur de prix utilisé : ' . $ev['calc'] . " fois\n"
        . 'Clics sur le téléphone : ' . $ev['tel'] . ' · sur l\'e-mail : ' . $ev['mail']
        . ' · vers la fiche Google : ' . $ev['google'] . ' · vers Facebook : ' . $ev['facebook'] . ' · sur WhatsApp : ' . $ev['whatsapp'] . "\n"
        . 'Sur téléphone : ' . ($s['visits'] ? (int) round($s['mobile'] / $s['visits'] * 100) : 0) . " % des visites\n\n"
        . "D'où viennent les visiteurs :\n" . $top($s['sources'], 8, fn($k) => $k)
        . "\nPages les plus vues :\n" . $top($s['pages'], 8, 'stats_page_label')
        . "\nLangues :\n" . $top($s['langs'], 4, fn($k) => strtoupper($k))
        . "\nTout le détail : " . STATS_SITE . "/stats/\n\n"
        . "Ces chiffres sont anonymes : aucun cookie, aucune adresse IP. Les robots sont exclus.\n";
    return ['mäisyndic · statistiques ' . $period, $body];
}
