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
const MAX_PER_HOUR = 20;         // demandes par adresse IP et par heure

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function respond(bool $ok, string $error = '', int $status = 200): void
{
    http_response_code($status);
    // Le détail technique de l'envoi reste dans le journal du serveur, jamais dans la réponse.
    if (!empty($GLOBALS['via'])) {
        error_log('maisyndic envoi: ' . implode(',', $GLOBALS['via']));
    }
    // Seule indication renvoyée : le mode d'envoi utilisé (serveur OVH ou secours), sans détail.
    $via = $GLOBALS['via'] ?? [];
    $mode = $via === [] ? null : (in_array('mail', $via, true) ? 'secours' : 'ovh');
    // Diagnostic temporaire : étape SMTP en échec (libellé neutre, ex. « pass:535 »).
    if ($mode === 'secours') {
        $mode .= ' (' . ($GLOBALS['smtp_err'] ?? (smtp_config() === null ? 'sans-config' : '?')) . ')';
    }
    echo json_encode($ok ? array_filter(['success' => true, 'envoi' => $mode], fn($v) => $v !== null)
        : ['success' => false, 'error' => $error]);
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
$residence = clean_line($in['residence'] ?? '', 120);

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
        $GLOBALS['smtp_err'] = 'connect:' . $errno;
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
    // $step : libellé neutre enregistré en cas d'échec (jamais le contenu envoyé).
    $cmd = function (string $line, string $expect, string $step) use ($fp, $read): bool {
        fwrite($fp, $line . "\r\n");
        $resp = $read();
        if (strncmp($resp, $expect, strlen($expect)) !== 0) {
            $GLOBALS['smtp_err'] = $step . ':' . substr(trim($resp), 0, 3);
            return false;
        }
        return true;
    };
    $ok = strncmp($read(), '220', 3) === 0
        && $cmd('EHLO maisyndic.lu', '250', 'ehlo')
        && $cmd('AUTH LOGIN', '334', 'auth')
        && $cmd(base64_encode($c['user'] ?? TO_ADDRESS), '334', 'user')
        && $cmd(base64_encode($c['pass']), '235', 'pass')
        && $cmd('MAIL FROM:<' . TO_ADDRESS . '>', '250', 'from')
        && $cmd('RCPT TO:<' . $to . '>', '25', 'rcpt')
        && $cmd('DATA', '354', 'data');
    if ($ok) {
        $body = preg_replace('/^\./m', '..', str_replace(["\r\n", "\r", "\n"], ["\n", "\n", "\r\n"], $data));
        $ok = $cmd($body . "\r\n.", '250', 'body');
    }
    @fwrite($fp, "QUIT\r\n");
    fclose($fp);
    return $ok;
}

$GLOBALS['via'] = [];

/**
 * $attachments : liste de ['name' => 'fichier.pdf', 'data' => contenu binaire].
 */
function send_mail(string $to, string $subject, string $body, string $replyTo, array $attachments = []): bool
{
    $headers = [
        'Date: ' . date('r'),
        'Message-ID: <' . bin2hex(random_bytes(12)) . '@maisyndic.lu>',
        'From: ' . encode_header(FROM_NAME) . ' <' . TO_ADDRESS . '>',
        'Reply-To: ' . $replyTo,
        'MIME-Version: 1.0',
    ];
    if ($attachments) {
        $b = 'ms-' . bin2hex(random_bytes(10));
        $headers[] = 'Content-Type: multipart/mixed; boundary="' . $b . '"';
        $mime = "This is a multi-part message in MIME format.\r\n\r\n--{$b}\r\n"
            . "Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n" . $body . "\r\n";
        foreach ($attachments as $a) {
            $fname = preg_replace('/[^A-Za-z0-9._-]/', '-', $a['name']);
            $mime .= "--{$b}\r\nContent-Type: application/pdf; name=\"{$fname}\"\r\n"
                . "Content-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"{$fname}\"\r\n\r\n"
                . chunk_split(base64_encode($a['data']), 76, "\r\n");
        }
        $body = $mime . "--{$b}--\r\n";
    } else {
        $headers[] = 'Content-Type: text/plain; charset=UTF-8';
        $headers[] = 'Content-Transfer-Encoding: 8bit';
    }
    $c = smtp_config();
    if ($c !== null) {
        $data = 'To: ' . $to . "\r\n" . 'Subject: ' . encode_header($subject) . "\r\n" . implode("\r\n", $headers) . "\r\n\r\n" . $body;
        if (smtp_send($c, $to, $data)) {
            $GLOBALS['via'][] = 'smtp';
            return true;
        }
        $GLOBALS['via'][] = 'smtp-failed(' . ($GLOBALS['smtp_err'] ?? '?') . ')';
    }
    $GLOBALS['via'][] = 'mail';
    return mail($to, encode_header($subject), $body, implode("\r\n", $headers), '-f' . TO_ADDRESS);
}

/**
 * Le devis (langue du demandeur) et le contrat : pré-rempli si une formule a été
 * choisie, sinon contrat type. Textes : quote-data.json (généré par le site).
 */
function build_quote_documents(string $plan, int $lots, string $lang, string $name, string $email,
                               string $phone, string $role, string $commune, string $residence): array
{
    global $Q;
    $Q = json_decode((string) @file_get_contents(__DIR__ . '/quote-data.json'), true);
    if (!is_array($Q)) {
        throw new RuntimeException('quote-data');
    }
    require_once __DIR__ . '/lib/msdocs.php';
    date_default_timezone_set('Europe/Luxembourg');
    $lang = isset($Q['i18n'][$lang]) ? $lang : 'fr';
    $ref = 'MS-' . date('ymd') . '-' . strtoupper(bin2hex(random_bytes(2)));
    $today = new DateTimeImmutable('today');
    $date = $today->format('d/m/Y');
    $valid = $today->modify('+3 months')->format('d/m/Y');

    $chosen = in_array($plan, ['benevole', 'essentiel', 'serenite'], true) ? $plan : '';
    $benevoleOut = false;
    if ($chosen === 'benevole' && $lots > 9) {
        $chosen = '';
        $benevoleOut = true;
    }

    $quote = ms_quote_pdf($Q, [
        'lang' => $lang, 'ref' => $ref, 'date' => $date, 'valid' => $valid,
        'name' => $name, 'email' => $email, 'phone' => $phone, 'role' => $role,
        'commune' => $commune, 'residence' => $residence, 'lots' => $lots,
        'plan' => $chosen, 'contract' => $chosen !== '' ? 'filled' : 'both', 'benevole_out' => $benevoleOut,
        'money' => fn(float $v, int $d) => money($v, $d, $lang),
    ]);

    // Contrats (en français) : celui de la formule choisie ; sans choix, les deux formules
    // de syndic pré-remplies (Essentiel et Sérénité).
    $blank = $Q['meta']['blank'];
    $res = $residence !== '' ? $residence : $blank;
    $plans = $chosen !== '' ? [$chosen] : ['essentiel', 'serenite'];
    $contracts = [];
    foreach ($plans as $p) {
        $k = $p === 'benevole' ? 'benevole' : 'syndic';
        $meta = $Q['meta'][$k];
        $grid = $Q['prices'][$p];
        [$rate] = ms_rate($grid, $lots);
        $monthly = max($rate * $lots, (float) $grid['min']);
        $pname = $Q['i18n']['fr']['plans'][$p]['name'] ?? $p;
        $vals = [
            'residence' => $res, 'commune' => $commune, 'date_ag' => $blank, 'representant' => $blank,
            'debut' => $blank, 'fin' => $blank, 'logements' => (string) $lots, 'caves' => $blank,
            'mois' => money($monthly, 2, 'fr'), 'an' => money($monthly * 12, 2, 'fr'), 'ref' => $ref,
            'date' => $date, 'ref_line' => 'Devis n° ' . $ref . ' du ' . $date,
            'formule_choix' => $pname,
            'taux_sinistre' => $p === 'essentiel' ? 'sinistres, ' : '',
            'sinistre' => $p === 'essentiel' ? 'Au temps passé' : 'Inclus dans le forfait',
        ];
        $repl = ['{residence}' => $res, '{ref}' => $ref, '{date}' => $date, '{formule}' => $pname];
        $vals['titre'] = $residence !== '' ? strtr($meta['title_filled'], $repl)
            : ($k === 'syndic' ? 'Contrat de syndic – mäisyndic' : strtr($meta['title_filled'], $repl));
        $vals['sous_titre'] = strtr($meta['sub_filled'], $repl);
        $contracts[] = ['name' => str_replace('{plan}', $p, $meta['file']),
            'data' => ms_contract_pdf($Q, $k, $vals, 'Page {n} sur {t}', $p)];
    }
    $GLOBALS['contract_count'] = count($contracts);

    return array_merge([['name' => str_replace('{ref}', $ref, $Q['i18n'][$lang]['file']), 'data' => $quote]], $contracts);
}

// --- 1. La demande, pour l'équipe -----------------------------------------
$L = $labels[$pageLang] ?? ($labels['fr'] ?? []);
$planName = $cfg['langs']['fr']['plans'][$plan] ?? ($plan !== '' ? $plan : '—');
$rows = [
    'Demande' => $cfg['objets_fr'][$objet] ?? $objet,
    'Nombre de lots' => $lots ?: '—',
    'Commune' => $commune,
    'Résidence' => ($objet === 'devis' && $residence !== '') ? $residence : '—',
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

// --- Devis PDF et contrat joints (demande de devis uniquement) -----------
$attachments = [];
if ($objet === 'devis' && $lots >= 2) {
    try {
        $attachments = build_quote_documents($plan, $lots, $lang, $name, $email, $phone, $role, $commune, $residence);
    } catch (Throwable $e) {
        $attachments = [];
        $GLOBALS['via'][] = 'pdf-failed';
        error_log('maisyndic pdf: ' . $e->getMessage());
    }
}
if ($attachments) {
    $body .= "\nLe devis et le ou les contrats envoyés au demandeur sont joints à cet e-mail.\n";
}

if (!send_mail(TO_ADDRESS, $subject, $body, $email, $attachments)) {
    respond(false, 'send', 500);
}

// --- 2. La réponse automatique, pour le demandeur -------------------------
$t = $cfg['langs'][$lang];
$estimation = '';
// Grille : prix par logement et par mois selon le palier, minimum mensuel par immeuble.
$grid = $cfg['prices'][$plan] ?? null;
if ($objet === 'devis' && is_array($grid) && $lots >= 2 && !($plan === 'benevole' && $lots > 9)) {
    $rate = 0.0;
    foreach ($grid['tiers'] as $tier) {
        if ($tier[0] === null || $lots <= $tier[0]) {
            $rate = (float) $tier[1];
            break;
        }
    }
    $monthly = max($rate * $lots, (float) $grid['min']);
    $estimation = strtr($t['estimate'], [
        '{formule}' => $t['plans'][$plan] ?? $plan,
        '{total}' => money($monthly * 12, 0, $lang),
        '{mois}' => money($monthly, 2, $lang),
        '{parlot}' => money($rate, 2, $lang),
        '{compris}' => $t['includes'][$plan] ?? '',
    ]);
}
$reply = strtr($t[$objet], [
    '{nom}' => $name,
    '{lots}' => $lots ? (string) $lots : '',
    '{commune}' => $commune,
    '{estimation}' => $estimation,
]);
$replySubject = ($objet === 'devis' && !empty($t['subject_devis'])) ? strtr($t['subject_devis'], ['{commune}' => $commune]) : $t['subject'];
if ($attachments && !empty($Q['i18n'][$lang]['pj_from'])) {
    $pjTo = ($GLOBALS['contract_count'] ?? 1) > 1 ? $Q['i18n'][$lang]['pj_to_both'] : $Q['i18n'][$lang]['pj_to'];
    $reply = str_replace($Q['i18n'][$lang]['pj_from'], $pjTo, $reply);
}
send_mail($email, $replySubject, $reply, TO_ADDRESS, $attachments);

respond(true);
