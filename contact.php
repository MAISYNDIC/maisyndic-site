<?php
/**
 * mäisyndic — réception du formulaire de devis.
 *
 * 1. Envoie la demande à contact@maisyndic.lu (Répondre à : le demandeur).
 * 2. Envoie au demandeur une réponse automatique depuis contact@maisyndic.lu,
 *    dans sa langue de contact, construite ici à partir de modèles fixes
 *    (le texte n'est jamais fourni par le navigateur : pas de relais de spam).
 *
 * Réponse JSON : {"success": true} ou {"success": false, "error": "..."}.
 */

declare(strict_types=1);

const TO_ADDRESS = 'contact@maisyndic.lu';
const FROM_NAME = 'mäisyndic';
const MAX_PER_HOUR = 5;          // demandes par adresse IP et par heure

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function respond(bool $ok, string $error = '', int $status = 200): void
{
    http_response_code($status);
    echo json_encode($ok ? ['success' => true] : ['success' => false, 'error' => $error]);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(false, 'method', 405);
}

// Les demandes doivent venir du site lui-même.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && !preg_match('#^https?://(www\.)?maisyndic\.lu$#', $origin)) {
    respond(false, 'origin', 403);
}

$raw = file_get_contents('php://input') ?: '';
$in = json_decode($raw, true);
if (!is_array($in)) {
    $in = $_POST;
}

// Piège à robots : champ invisible rempli = on fait semblant d'avoir réussi.
if (!empty($in['_honey'])) {
    respond(true);
}

/** Texte sur une ligne, sans caractères de contrôle, longueur bornée. */
function clean_line($v, int $max = 120): string
{
    $v = is_scalar($v) ? (string) $v : '';
    $v = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $v) ?? '';
    return trim(mb_substr($v, 0, $max));
}

function clean_text($v, int $max = 3000): string
{
    $v = is_scalar($v) ? (string) $v : '';
    $v = str_replace(["\r\n", "\r"], "\n", $v);
    $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/u', '', $v) ?? '';
    return trim(mb_substr($v, 0, $max));
}

$name = clean_line($in['name'] ?? '', 80);
$email = clean_line($in['email'] ?? '', 120);
$commune = clean_line($in['commune'] ?? '', 80);
if ($name === '' || $commune === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(false, 'fields', 422);
}

// Limite simple par adresse IP, stockée hors du dossier public.
$dataDir = dirname(__DIR__) . '/data';
if (!is_dir($dataDir)) {
    @mkdir($dataDir, 0700, true);
}
$ipKey = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . 'maisyndic');
$rateFile = $dataDir . '/rate-' . substr($ipKey, 0, 24) . '.json';
$now = time();
$hits = [];
if (is_file($rateFile)) {
    $hits = array_filter((array) json_decode((string) file_get_contents($rateFile), true), fn($t) => is_int($t) && $t > $now - 3600);
}
if (count($hits) >= MAX_PER_HOUR) {
    respond(false, 'rate', 429);
}
$hits[] = $now;
@file_put_contents($rateFile, json_encode(array_values($hits)), LOCK_EX);

// Modèles de réponse et prix, générés par le site (build.py).
$cfg = json_decode((string) @file_get_contents(__DIR__ . '/contact-data.json'), true);
if (!is_array($cfg)) {
    respond(false, 'config', 500);
}

$labels = $cfg['labels'] ?? [];
$pageLang = clean_line($in['page_lang'] ?? 'fr', 2);
$lang = clean_line($in['langue'] ?? $pageLang, 2);
if (!isset($cfg['langs'][$lang])) {
    $lang = isset($cfg['langs'][$pageLang]) ? $pageLang : 'fr';
}
$objet = clean_line($in['objet'] ?? 'devis', 20);
if (!in_array($objet, ['devis', 'vente', 'location'], true)) {
    $objet = 'devis';
}
$plan = clean_line($in['plan'] ?? '', 20);
$lots = (int) ($in['lots'] ?? 0);
$lots = ($lots >= 1 && $lots <= 2000) ? $lots : 0;
$phone = clean_line($in['phone'] ?? '', 40);
$role = clean_line($in['role'] ?? '', 80);
$message = clean_text($in['message'] ?? '');

/** Montant au format de la langue (sans dépendre de l'extension intl). */
function money(float $v, int $dec, string $lang): string
{
    if ($lang === 'en') {
        return '€' . number_format($v, $dec, '.', ',');
    }
    if ($lang === 'de') {
        return number_format($v, $dec, ',', '.') . ' €';
    }
    return number_format($v, $dec, ',', "\u{202F}") . ' €';
}

function encode_header(string $s): string
{
    return mb_encode_mimeheader($s, 'UTF-8', 'B', "\r\n");
}

/**
 * Envoi par le serveur SMTP authentifié d'OVH (ssl0.ovh.net) quand le mot de passe
 * de la boîte est configuré (fichier ../data/smtp.php, écrit par la mise en ligne
 * à partir du secret GitHub SMTP_PASSWORD). Les e-mails sont alors signés DKIM
 * par OVH et passent les filtres anti-spam. Sinon, repli sur mail().
 */
function smtp_config(): ?array
{
    $file = dirname(__DIR__) . '/data/smtp.php';
    if (!is_file($file)) {
        return null;
    }
    $c = include $file;
    return (is_array($c) && !empty($c['pass'])) ? $c : null;
}

function smtp_send(array $c, string $to, string $data): bool
{
    $target = $c['target'] ?? 'ssl://ssl0.ovh.net:465';
    $fp = @stream_socket_client($target, $errno, $errstr, 15);
    if (!$fp) {
        return false;
    }
    stream_set_timeout($fp, 15);
    $read = function () use ($fp): string {
        $out = '';
        while (($line = fgets($fp, 1024)) !== false) {
            $out .= $line;
            if (strlen($line) < 4 || $line[3] === ' ') {
                break;
            }
        }
        return $out;
    };
    $cmd = function (string $line, string $expect) use ($fp, $read): bool {
        fwrite($fp, $line . "\r\n");
        return strncmp($read(), $expect, strlen($expect)) === 0;
    };
    $ok = strncmp($read(), '220', 3) === 0
        && $cmd('EHLO maisyndic.lu', '250')
        && $cmd('AUTH LOGIN', '334')
        && $cmd(base64_encode($c['user'] ?? TO_ADDRESS), '334')
        && $cmd(base64_encode($c['pass']), '235')
        && $cmd('MAIL FROM:<' . TO_ADDRESS . '>', '250')
        && $cmd('RCPT TO:<' . $to . '>', '25')
        && $cmd('DATA', '354');
    if ($ok) {
        $body = preg_replace('/^\./m', '..', str_replace(["\r\n", "\r", "\n"], ["\n", "\n", "\r\n"], $data));
        $ok = $cmd($body . "\r\n.", '250');
    }
    @fwrite($fp, "QUIT\r\n");
    fclose($fp);
    return $ok;
}

function send_mail(string $to, string $subject, string $body, string $replyTo): bool
{
    $headers = [
        'Date: ' . date('r'),
        'Message-ID: <' . bin2hex(random_bytes(12)) . '@maisyndic.lu>',
        'From: ' . encode_header(FROM_NAME) . ' <' . TO_ADDRESS . '>',
        'Reply-To: ' . $replyTo,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
    ];
    $c = smtp_config();
    if ($c !== null) {
        $data = 'To: ' . $to . "\r\n" . 'Subject: ' . encode_header($subject) . "\r\n" . implode("\r\n", $headers) . "\r\n\r\n" . $body;
        if (smtp_send($c, $to, $data)) {
            return true;
        }
    }
    return mail($to, encode_header($subject), $body, implode("\r\n", $headers), '-f' . TO_ADDRESS);
}

// --- 1. La demande, pour l'équipe -----------------------------------------
$L = $labels[$pageLang] ?? ($labels['fr'] ?? []);
$planName = $cfg['langs']['fr']['plans'][$plan] ?? ($plan !== '' ? $plan : '—');
$rows = [
    'Demande' => $cfg['objets_fr'][$objet] ?? $objet,
    'Nombre de lots' => $lots ?: '—',
    'Commune' => $commune,
    'Formule' => $objet === 'devis' ? $planName : '—',
    'Vous êtes' => $role ?: '—',
    'Nom' => $name,
    'E-mail' => $email,
    'Téléphone' => $phone ?: '—',
    'Langue de contact' => $cfg['lang_names'][$lang] ?? $lang,
    'Page du site' => strtoupper($pageLang),
];
$body = "Nouvelle demande reçue sur maisyndic.lu\n\n";
foreach ($rows as $k => $v) {
    $body .= mb_str_pad($k . " :", 22) . $v . "\n";
}
$body .= "\nMessage :\n" . ($message !== '' ? $message : '—') . "\n\n";
$body .= "Répondez directement à cet e-mail pour écrire au demandeur.\n";
$subject = 'Nouvelle demande mäisyndic (' . strtoupper($pageLang) . ') – ' . ($cfg['objets_fr'][$objet] ?? $objet) . ' – ' . $commune;

if (!send_mail(TO_ADDRESS, $subject, $body, $email)) {
    respond(false, 'send', 500);
}

// --- 2. La réponse automatique, pour le demandeur -------------------------
$t = $cfg['langs'][$lang];
$estimation = '';
$price = $cfg['prices'][$plan] ?? null;
if ($objet === 'devis' && $price && $lots >= 2 && !($plan === 'benevole' && $lots > 9)) {
    $estimation = strtr($t['estimate'], [
        '{formule}' => $t['plans'][$plan] ?? $plan,
        '{total}' => money($price * $lots, 0, $lang),
        '{mois}' => money($price * $lots / 12, 2, $lang),
        '{parlot}' => money((float) $price, 0, $lang),
    ]);
}
$reply = strtr($t[$objet], [
    '{nom}' => $name,
    '{lots}' => $lots ? (string) $lots : '',
    '{commune}' => $commune,
    '{estimation}' => $estimation,
]);
send_mail($email, $t['subject'], $reply, TO_ADDRESS);

respond(true);
