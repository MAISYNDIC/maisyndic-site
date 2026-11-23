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
const MAX_PER_HOUR = 5;          // demandes par réseau (adresse IP ; bloc /64 en IPv6) et par heure
const MAX_SITE_PER_HOUR = 30;    // demandes par heure pour tout le site (audit de sécurité du 23/11/2026)
const MAX_REPLIES_PER_DAY = 1;   // réponses automatiques (et copies à l'application) par adresse e-mail et par jour

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function respond(bool $ok, string $error = '', int $status = 200): void
{
    http_response_code($status);
    // Le détail technique de l'envoi reste dans le journal du serveur, jamais dans la réponse.
    if (!empty($GLOBALS['via'])) {
        error_log('maisyndic envoi: ' . implode(',', $GLOBALS['via']));
    }
    echo json_encode($ok ? ['success' => true] : ['success' => false, 'error' => $error]);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(false, 'method', 405);
}

// Fichiers de limitation (empreinte de l'adresse IP et heures des demandes) : effacés après une journée, à chaque
// demande reçue, même refusée (page « Protection des données » ; registre des traitements de mäisyndic, fiche 14).
foreach (glob(dirname(__DIR__) . '/data/rate-*.json') ?: [] as $ancien) {
    if (@filemtime($ancien) < time() - 86400) {
        @unlink($ancien);
    }
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
    // Caractères invisibles (trait d'union conditionnel, espace de largeur nulle…) retirés, et points « ressemblants »
    // ramenés au point : « evil.lu » ne passe plus caché (audit de sécurité du 23/11/2026).
    $v = preg_replace('/\p{Cf}+/u', '', $v) ?? '';
    $v = preg_replace('/\p{Zs}/u', ' ', $v) ?? '';
    $v = str_replace(["\u{2024}", "\u{FF0E}", "\u{3002}", "\u{FE52}"], '.', $v);
    return trim(mb_substr($v, 0, $max));
}

function clean_text($v, int $max = 3000): string
{
    $v = is_scalar($v) ? (string) $v : '';
    $v = str_replace(["\r\n", "\r"], "\n", $v);
    $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/u', '', $v) ?? '';
    return trim(mb_substr($v, 0, $max));
}

/**
 * Lien, adresse web ou e-mail dans un nom, une commune, une résidence ou une qualité : refusés. Ces textes sont repris dans
 * la réponse automatique envoyée depuis contact@ : sans ce contrôle, le formulaire servirait à envoyer un e-mail piégé
 * (« réactivez votre compte sur https://… ») à n'importe quelle adresse (audit de sécurité du 23/11/2026).
 */
function has_link(string $v): bool
{
    return preg_match('#(https?:|www\.|://|@)#iu', $v) === 1;
}

/**
 * Point collé entre une lettre (ou un chiffre) et une lettre : une espace est ajoutée après (« St.Hubert » devient
 * « St. Hubert », « evil.support » devient « evil. support ») : aucun nom de domaine ne peut se former, quelle que soit son
 * extension, et aucun vrai nom n'est refusé.
 */
function sans_lien(string $v): string
{
    return preg_replace('/(?<=[\p{L}\p{N}])\.(?=\p{L})/u', '. ', $v) ?? $v;
}

$name = sans_lien(clean_line($in['name'] ?? '', 80));
$email = clean_line($in['email'] ?? '', 120);
$commune = sans_lien(clean_line($in['commune'] ?? '', 80));
if ($name === '' || $commune === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(false, 'fields', 422);
}
foreach ([$name, $commune, clean_line($in['residence'] ?? '', 120), clean_line($in['role'] ?? '', 80)] as $champ) {
    if (has_link($champ)) {
        respond(false, 'fields', 422);
    }
}
// Téléphone (repris dans le devis PDF joint à la réponse) : seulement des chiffres et la ponctuation d'un numéro.
if (!preg_match('#^[0-9 +()./-]{0,40}$#', clean_line($in['phone'] ?? '', 40))) {
    respond(false, 'fields', 422);
}

/**
 * Compte une demande dans un fichier de limitation, sous verrou (des envois simultanés ne passent plus à travers) : vrai si
 * elle est acceptée (et notée), faux si la limite est atteinte. Un disque qui refuse n'empêche jamais une demande.
 */
function rate_hit(string $file, int $max, int $window): bool
{
    $fh = @fopen($file, 'c+');
    if ($fh === false) {
        return true;
    }
    try {
        flock($fh, LOCK_EX);
        $now = time();
        $hits = array_values(array_filter((array) json_decode((string) stream_get_contents($fh), true), fn($t) => is_int($t) && $t > $now - $window));
        if (count($hits) >= $max) {
            return false;
        }
        $hits[] = $now;
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($hits));
        fflush($fh);
        return true;
    } finally {
        flock($fh, LOCK_UN);
        fclose($fh);
    }
}

/** Réseau de l'adresse IP : l'adresse entière en IPv4, le bloc /64 en IPv6 (un abonné en reçoit tout un). */
function network_of(string $ip): string
{
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false && ($bin = @inet_pton($ip)) !== false) {
        if (strncmp($bin, str_repeat("\0", 10) . "\xFF\xFF", 12) === 0) {
            return (string) inet_ntop(substr($bin, 12)); // adresse IPv4 écrite en IPv6
        }
        return bin2hex(substr($bin, 0, 8)) . '::/64';
    }
    return $ip;
}

// Limites (fichiers hors du dossier public, empreintes seulement) : par réseau, pour tout le site.
$dataDir = dirname(__DIR__) . '/data';
if (!is_dir($dataDir)) {
    @mkdir($dataDir, 0700, true);
}
$ipKey = hash('sha256', network_of((string) ($_SERVER['REMOTE_ADDR'] ?? '')) . 'maisyndic');
if (!rate_hit($dataDir . '/rate-' . substr($ipKey, 0, 24) . '.json', MAX_PER_HOUR, 3600)) {
    respond(false, 'rate', 429);
}
// Au-delà du plafond du site, la demande arrive quand même à l'agence, mais sans réponse automatique ni copie à
// l'application : personne ne peut, en saturant le formulaire, faire perdre les vraies demandes.
$sansReponse = !rate_hit($dataDir . '/rate-site.json', MAX_SITE_PER_HOUR, 3600);
if ($sansReponse) {
    error_log('maisyndic: plafond de demandes du site atteint (' . MAX_SITE_PER_HOUR . ' par heure) : demande transmise sans réponse automatique');
}

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
$role = sans_lien(clean_line($in['role'] ?? '', 80));
$message = clean_text($in['message'] ?? '');
$residence = sans_lien(clean_line($in['residence'] ?? '', 120));

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

require_once __DIR__ . '/lib/mailer.php';

$GLOBALS['via'] = [];

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
        // Traduction informative dans la langue du demandeur (la version française fait foi).
        $T = $Q['contracts_i18n'][$lang] ?? null;
        if ($T !== null) {
            $tm = $T['meta'][$k];
            $tp = $Q['i18n'][$lang]['plans'][$p]['name'] ?? $pname;
            $tv = $vals;
            $tv['mois'] = money($monthly, 2, $lang);
            $tv['an'] = money($monthly * 12, 2, $lang);
            $tv['formule_choix'] = $tp;
            $tv['taux_sinistre'] = $p === 'essentiel' ? $T['values']['taux_sinistre_essentiel'] : '';
            $tv['sinistre'] = $p === 'essentiel' ? $T['values']['sinistre_essentiel'] : $T['values']['sinistre_serenite'];
            $tr = ['{residence}' => $res, '{ref}' => $ref, '{date}' => $date, '{formule}' => $tp];
            $tv['titre'] = strtr($tm['title_filled'], $tr);
            $tv['sous_titre'] = strtr($tm['sub_filled'], $tr);
            $tv['ref_line'] = $Q['i18n'][$lang]['ref'] . ' ' . $ref . ' · ' . $date;
            $contracts[] = ['name' => str_replace('{plan}', $p, $tm['file']),
                'data' => ms_contract_pdf($Q, $k, $tv, $Q['i18n'][$lang]['page'], $p, [
                    'syndic' => $T['syndic'], 'benevole' => $T['benevole'], 'meta' => $T['meta'],
                    'tagline' => $Q['i18n'][$lang]['tagline'], 'sign' => $Q['i18n'][$lang]['sign'] ?? 'Signature:',
                ])];
        }
    }
    $GLOBALS['contract_count'] = count($plans);

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

// Statistiques anonymes : une demande reçue et la page d'où elle vient, sans aucune donnée du demandeur.
try {
    require_once __DIR__ . '/lib/stats.php';
    $refPath = (string) (parse_url((string) ($_SERVER['HTTP_REFERER'] ?? ''), PHP_URL_PATH) ?: '');
    stats_record(['e' => 'lead', 'p' => preg_match('#^/[A-Za-z0-9/._-]{0,150}$#', $refPath) ? $refPath : '', 'l' => $lang, 'o' => $objet]);
} catch (Throwable $e) {
    error_log('maisyndic stats: ' . $e->getMessage());
}

// Une seule réponse automatique (et une seule copie à l'application, donc une seule série de rappels) par adresse e-mail et
// par jour : la demande arrive toujours à l'agence, mais on n'écrit pas dix fois à la même personne.
// Même boîte, même compteur : sans majuscules, sans « +étiquette », et sans les points pour Gmail.
[$local, $domaine] = array_pad(explode('@', mb_strtolower($email), 2), 2, '');
$local = preg_replace('/\+.*$/', '', $local) ?? $local;
if (in_array($domaine, ['gmail.com', 'googlemail.com'], true)) {
    $local = str_replace('.', '', $local);
    $domaine = 'gmail.com';
}
$emailKey = hash('sha256', $local . '@' . $domaine . 'maisyndic');
if ($sansReponse || !rate_hit($dataDir . '/rate-dest-' . substr($emailKey, 0, 24) . '.json', MAX_REPLIES_PER_DAY, 86400)) {
    respond(true);
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

// --- 3. Copie de la demande de devis à l'application (suivi par l'équipe et deux rappels au demandeur) ---
if ($objet === 'devis') {
    try {
        require_once __DIR__ . '/lib/devis.php';
        forward_quote_request([
            'nom' => $name, 'email' => $email, 'telephone' => $phone, 'langue' => $lang, 'lots' => $lots,
            'commune' => $commune, 'residence' => $residence, 'formule' => $plan, 'qualite' => $role, 'message' => $message,
        ]);
    } catch (Throwable $e) {
        error_log('maisyndic devis: ' . get_class($e));
    }
}

respond(true);
