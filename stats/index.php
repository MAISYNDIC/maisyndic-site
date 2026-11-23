<?php
/**
 * mäisyndic — tableau de bord des statistiques (réservé au gérant).
 * Connexion sans mot de passe : un lien valable 30 minutes est envoyé à contact@maisyndic.lu,
 * puis un cookie signé garde la session ouverte 90 jours sur ce navigateur.
 */

declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/stats.php';
require_once dirname(__DIR__) . '/lib/mailer.php';

header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
header('Content-Type: text/html; charset=utf-8');

const COOKIE = 'mxstats';
const SESSION_DAYS = 90;
const LINK_MINUTES = 30;
const LINKS_PER_HOUR = 5;

function secret(): string
{
    $f = stats_dir() . '/secret.txt';
    $s = is_file($f) ? trim((string) file_get_contents($f)) : '';
    if (strlen($s) < 64) {
        $s = bin2hex(random_bytes(32));
        file_put_contents($f, $s, LOCK_EX);
        @chmod($f, 0600);
    }
    return $s;
}

function auth_store(): array
{
    $f = stats_dir() . '/auth.json';
    $d = is_file($f) ? json_decode((string) file_get_contents($f), true) : null;
    $d = is_array($d) ? $d : [];
    $now = time();
    $d['tokens'] = array_filter((array) ($d['tokens'] ?? []), fn($exp) => is_int($exp) && $exp > $now);
    $d['sent'] = array_values(array_filter((array) ($d['sent'] ?? []), fn($t) => is_int($t) && $t > $now - 3600));
    return $d;
}

function auth_save(array $d): void
{
    $f = stats_dir() . '/auth.json';
    file_put_contents($f, json_encode($d), LOCK_EX);
    @chmod($f, 0600);
}

/**
 * Lecture et écriture de auth.json sous verrou : des demandes simultanées ne créent plus de liens perdus ni plus d'e-mails
 * que la limite (audit de sécurité du 23/11/2026). Renvoie ce que renvoie $f, qui peut modifier les données.
 */
function with_auth(callable $f)
{
    $lock = @fopen(stats_dir() . '/auth.lock', 'c');
    if ($lock !== false) {
        flock($lock, LOCK_EX);
    }
    try {
        $d = auth_store();
        $r = $f($d);
        auth_save($d);
        return $r;
    } finally {
        if ($lock !== false) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}

function signed_in(): bool
{
    $c = (string) ($_COOKIE[COOKIE] ?? '');
    if (!preg_match('/^(\d+)\.([a-f0-9]{64})$/', $c, $m) || (int) $m[1] < time()) {
        return false;
    }
    return hash_equals(hash_hmac('sha256', 'stats|' . $m[1], secret()), $m[2]);
}

function set_session(int $exp): void
{
    $value = $exp > 0 ? $exp . '.' . hash_hmac('sha256', 'stats|' . $exp, secret()) : '';
    setcookie(COOKIE, $value, ['expires' => $exp > 0 ? $exp : 1, 'path' => '/stats/', 'secure' => true,
                               'httponly' => true, 'samesite' => 'Lax']);
}

function base_url(): string
{
    $host = (string) ($_SERVER['HTTP_HOST'] ?? 'maisyndic.lu');
    $local = (bool) preg_match('/^(127\.0\.0\.1|localhost)(:\d+)?$/', $host);
    return $local ? 'http://' . $host . '/stats/' : STATS_SITE . '/stats/';
}

$notice = '';

// 1. Lien reçu par e-mail
if (isset($_GET['k']) && is_string($_GET['k'])) {
    $h = hash('sha256', $_GET['k']);
    $valable = with_auth(function (array &$d) use ($h) {
        if (!isset($d['tokens'][$h])) {
            return false;
        }
        unset($d['tokens'][$h]);
        return true;
    });
    if ($valable) {
        set_session(time() + SESSION_DAYS * 86400);
        header('Location: ' . base_url(), true, 303);
        exit;
    }
    $notice = 'Ce lien n\'est plus valable (il sert une seule fois, pendant ' . LINK_MINUTES . ' minutes). Demandez-en un nouveau.';
}

// 2. Déconnexion
if (isset($_GET['logout'])) {
    set_session(0);
    header('Location: ' . base_url(), true, 303);
    exit;
}

// 3. Demande d'un lien de connexion
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && ($_POST['action'] ?? '') === 'link') {
    // 5 liens par heure en tout, et 2 par réseau : une seule personne ne peut plus bloquer la connexion de l'agence.
    $reseau = substr(hash('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? '') . 'stats'), 0, 16);
    $token = with_auth(function (array &$d) use ($reseau) {
        $now = time();
        $d['par_reseau'] = array_filter((array) ($d['par_reseau'] ?? []), fn($l) => is_array($l) && $l !== []);
        foreach ($d['par_reseau'] as $k => $l) {
            $d['par_reseau'][$k] = array_values(array_filter($l, fn($t) => is_int($t) && $t > $now - 3600));
        }
        if (count($d['sent']) >= LINKS_PER_HOUR || count($d['par_reseau'][$reseau] ?? []) >= 2) {
            return null;
        }
        $token = bin2hex(random_bytes(24));
        $d['tokens'][hash('sha256', $token)] = $now + LINK_MINUTES * 60;
        $d['sent'][] = $now;
        $d['par_reseau'][$reseau][] = $now;
        return $token;
    });
    if ($token !== null) {
        $link = base_url() . '?k=' . $token;
        send_mail(TO_ADDRESS, 'mäisyndic · votre lien vers les statistiques',
            "Bonjour,\n\nVoici votre lien de connexion au tableau de bord des statistiques du site :\n\n" . $link
            . "\n\nIl fonctionne une seule fois, pendant " . LINK_MINUTES . " minutes. Ensuite, ce navigateur reste connecté "
            . SESSION_DAYS . " jours.\n\nSi vous n'avez rien demandé, ignorez simplement cet e-mail.\n", TO_ADDRESS);
    }
    $notice = 'Si tout va bien, un lien de connexion vient d\'être envoyé à ' . TO_ADDRESS . '. Il est valable ' . LINK_MINUTES . ' minutes.';
}

$e = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
$authed = signed_in();
$periods = [7 => '7 jours', 30 => '30 jours', 90 => '3 mois', 365 => '12 mois'];
$p = (int) ($_GET['p'] ?? 30);
$p = isset($periods[$p]) ? $p : 30;

if ($authed) {
    $to = time();
    $from = strtotime('today -' . ($p - 1) . ' days');
    $s = stats_summary($from, $to);
    $prev = stats_summary($from - $p * 86400, $from - 1);
}

function delta(int $a, int $b): string
{
    if ($b === 0) {
        return $a > 0 ? '<span class="up">nouveau</span>' : '';
    }
    $pct = (int) round(($a - $b) / $b * 100);
    return '<span class="' . ($pct >= 0 ? 'up' : 'down') . '">' . ($pct >= 0 ? '+' : '') . $pct . ' %</span>';
}

function bars(array $rows, callable $label, int $limit = 10): string
{
    if (!$rows) {
        return '<p class="empty">Pas encore de données.</p>';
    }
    $max = max($rows) ?: 1;
    $out = '<table class="bars"><tbody>';
    foreach (array_slice($rows, 0, $limit, true) as $k => $v) {
        $w = max(2, (int) round($v / $max * 100));
        $out .= '<tr><th scope="row">' . htmlspecialchars($label((string) $k), ENT_QUOTES, 'UTF-8') . '</th><td><span class="bar" style="width:'
            . $w . '%"></span></td><td class="n">' . $v . '</td></tr>';
    }
    return $out . '</tbody></table>';
}

function chart(array $days, int $p): string
{
    $series = $days;
    if ($p > 90) {
        // Par semaine sur 12 mois
        $series = [];
        foreach ($days as $d => $v) {
            $k = date('o-W', strtotime($d));
            $series[$k] = ($series[$k] ?? 0) + $v;
        }
    }
    $n = count($series);
    $max = max(1, max($series ?: [0]));
    $W = 720;
    $H = 160;
    $bw = $W / max(1, $n);
    $top = 20;
    $svg = '<svg viewBox="0 0 ' . $W . ' ' . ($H + $top + 22) . '" class="chart" role="img" aria-label="Visites par ' . ($p > 90 ? 'semaine' : 'jour') . '">';
    $i = 0;
    $keys = array_keys($series);
    foreach ($series as $k => $v) {
        $h = $v > 0 ? max(2, $v / $max * $H) : 0;
        $x = $i * $bw + $bw * 0.12;
        $svg .= '<rect x="' . round($x, 1) . '" y="' . round($top + $H - $h, 1) . '" width="' . round($bw * 0.76, 1) . '" height="' . round($h, 1) . '" rx="2"><title>'
            . htmlspecialchars((string) $k, ENT_QUOTES) . ' : ' . $v . '</title></rect>';
        $i++;
    }
    $first = $keys[0] ?? '';
    $last = end($keys) ?: '';
    $fmt = fn($k) => $p > 90 ? 'sem. ' . substr((string) $k, 5) : date('d/m', strtotime((string) $k));
    $svg .= '<text x="0" y="' . ($top + $H + 16) . '">' . $fmt($first) . '</text><text x="' . $W . '" y="' . ($top + $H + 16) . '" text-anchor="end">' . $fmt($last) . '</text>';
    $svg .= '<text x="0" y="12" class="max">maximum : ' . $max . ($p > 90 ? ' par semaine' : ' par jour') . '</text>';
    return $svg . '</svg>';
}
?><!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Statistiques · mäisyndic</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<style>
:root { --ink: #0f1b2d; --muted: #5b6676; --line: #e3e7ee; --bg: #f5f7fa; --card: #fff; --accent: #0b5fa5; --up: #137a3f; --down: #b3261e; }
@media (prefers-color-scheme: dark) { :root { --ink: #e8edf4; --muted: #9aa6b5; --line: #2a3443; --bg: #0e141c; --card: #151d28; --accent: #5aa7ec; --up: #5fd08f; --down: #ff8a80; } }
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: var(--bg); }
.wrap { max-width: 1040px; margin: 0 auto; padding: 24px 16px 64px; }
header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 20px; }
h1 { font-size: 1.5rem; margin: 0; letter-spacing: -0.01em; }
h2 { font-size: 1rem; margin: 0 0 12px; }
a { color: var(--accent); }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.tabs a { padding: 6px 12px; border: 1px solid var(--line); border-radius: 999px; text-decoration: none; color: var(--ink); background: var(--card); font-size: .875rem; }
.tabs a[aria-current] { background: var(--accent); border-color: var(--accent); color: #fff; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; }
.kpi b { display: block; font-size: 1.9rem; line-height: 1.1; font-variant-numeric: tabular-nums; }
.kpi span { color: var(--muted); font-size: .875rem; }
.kpi .up, .kpi .down { font-size: .8125rem; margin-left: 4px; }
.up { color: var(--up); } .down { color: var(--down); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; margin-top: 12px; }
.chart { width: 100%; height: auto; display: block; }
.chart rect { fill: var(--accent); }
.chart text { fill: var(--muted); font-size: 12px; }
table.bars { width: 100%; border-collapse: collapse; font-size: .9375rem; }
table.bars th { text-align: left; font-weight: 500; padding: 4px 8px 4px 0; width: 46%; overflow-wrap: anywhere; }
table.bars td { padding: 4px 0; }
table.bars .bar { display: block; height: 10px; border-radius: 5px; background: var(--accent); opacity: .8; }
table.bars .n { text-align: right; width: 3.5em; font-variant-numeric: tabular-nums; padding-left: 8px; }
.empty, .note { color: var(--muted); font-size: .9375rem; }
.notice { background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--accent); padding: 12px 16px; border-radius: 10px; margin-bottom: 16px; }
button { font: inherit; background: var(--accent); color: #fff; border: 0; border-radius: 10px; padding: 12px 18px; cursor: pointer; }
.login { max-width: 460px; margin: 10vh auto 0; }
</style>
</head>
<body>
<div class="wrap">
<?php if (!$authed): ?>
<div class="login card">
<h1>Statistiques du site</h1>
<?php if ($notice): ?><p class="notice" role="status"><?= $e($notice) ?></p><?php endif; ?>
<p>Réservé à l'équipe mäisyndic. Recevez un lien de connexion à l'adresse <?= $e(TO_ADDRESS) ?>.</p>
<form method="post" action="<?= $e(base_url()) ?>"><input type="hidden" name="action" value="link"><button type="submit">Recevoir le lien par e-mail</button></form>
</div>
<?php else: ?>
<header>
<h1>Statistiques de maisyndic.lu</h1>
<nav class="tabs" aria-label="Période"><?php foreach ($periods as $k => $label): ?><a href="?p=<?= $k ?>"<?= $k === $p ? ' aria-current="page"' : '' ?>><?= $e($label) ?></a><?php endforeach; ?></nav>
</header>
<p class="note"><?= $e(ucfirst(stats_fmt_period($from, $to))) ?>, comparé aux <?= $e($periods[$p]) ?> précédents.</p>
<section class="kpis" aria-label="Chiffres clés">
<div class="card kpi"><b><?= $s['visits'] ?></b><span>visites</span> <?= delta($s['visits'], $prev['visits']) ?></div>
<div class="card kpi"><b><?= $s['views'] ?></b><span>pages vues</span> <?= delta($s['views'], $prev['views']) ?></div>
<div class="card kpi"><b><?= $s['events']['lead'] ?></b><span>demandes de devis</span> <?= delta($s['events']['lead'], $prev['events']['lead']) ?></div>
<div class="card kpi"><b><?= $s['events']['calc'] ?></b><span>calculs de prix</span> <?= delta($s['events']['calc'], $prev['events']['calc']) ?></div>
<div class="card kpi"><b><?= $s['events']['tel'] + $s['events']['mail'] + $s['events']['whatsapp'] ?></b><span>clics téléphone, e-mail ou WhatsApp</span></div>
<div class="card kpi"><b><?= $s['visits'] ? (int) round($s['mobile'] / $s['visits'] * 100) : 0 ?> %</b><span>sur téléphone</span></div>
</section>
<section class="card"><h2>Visites par <?= $p > 90 ? 'semaine' : 'jour' ?></h2><?= chart($s['days'], $p) ?></section>
<div class="grid">
<section class="card"><h2>D'où viennent les visiteurs</h2><?= bars($s['sources'], fn($k) => $k) ?></section>
<section class="card"><h2>Pages d'arrivée</h2><?= bars($s['entries'], 'stats_page_label') ?></section>
<section class="card"><h2>Pages les plus vues</h2><?= bars($s['pages'], 'stats_page_label', 12) ?></section>
<section class="card"><h2>Langues</h2><?= bars($s['langs'], fn($k) => ['fr' => 'Français', 'de' => 'Deutsch', 'en' => 'English', 'pt' => 'Português'][$k] ?? $k) ?></section>
<section class="card"><h2>Actions</h2><?= bars(array_filter([
    'Demandes de devis' => $s['events']['lead'], 'Calculateur utilisé' => $s['events']['calc'],
    'Clic sur le téléphone' => $s['events']['tel'], 'Clic sur l\'e-mail' => $s['events']['mail'],
    'Vers la fiche Google' => $s['events']['google'], 'Vers Facebook' => $s['events']['facebook'],
    'Vers WhatsApp' => $s['events']['whatsapp']]), fn($k) => $k) ?></section>
<section class="card"><h2>Demandes de devis par page</h2><?= bars($s['leads'], fn($k) => $k === '' ? 'page inconnue' : stats_page_label($k)) ?></section>
</div>
<p class="note">Mesure anonyme : ni cookie, ni adresse IP. Une visite = une arrivée sur le site depuis l'extérieur ; les robots sont exclus. Ce navigateur n'est pas compté dans les statistiques. Un rapport arrive chaque lundi à <?= $e(TO_ADDRESS) ?>. <a href="?logout=1">Se déconnecter</a></p>
<?php endif; ?>
</div>
<script>try { localStorage.setItem("mx-nostats", "1"); } catch (e) {}</script>
</body>
</html>
